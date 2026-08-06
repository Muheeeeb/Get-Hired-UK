import { Router } from 'express';
import { z } from 'zod';
import rateLimit from 'express-rate-limit';
import { prisma } from '../lib/prisma.js';
import { validate } from '../middleware/validate.js';
import { sendMail, brandedEmail } from '../lib/mailer.js';
import { env } from '../config/env.js';
import { startOfMonth } from '../utils/dates.js';
import { PACKAGES } from '../config/packages.js';
import { readFileBuffer, inlineContentType } from '../lib/storage.js';

const router = Router();

// Aggregate, non-sensitive counters for the public landing page. Cached 60s.
let cache = { at: 0, data: null };

router.get('/stats', async (req, res, next) => {
  try {
    if (cache.data && Date.now() - cache.at < 60_000) return res.json(cache.data);
    const [totalApplications, monthApplications, activeClients, companies] = await Promise.all([
      prisma.jobApplication.count(),
      prisma.jobApplication.count({ where: { applicationDate: { gte: startOfMonth() } } }),
      prisma.clientProfile.count({ where: { user: { isActive: true, deletedAt: null } } }),
      prisma.jobApplication.findMany({ distinct: ['company'], select: { company: true } }),
    ]);
    cache = {
      at: Date.now(),
      data: { totalApplications, monthApplications, activeClients, employers: companies.length },
    };
    res.json(cache.data);
  } catch (err) {
    next(err);
  }
});

/** Package definitions — single source of truth for the landing page & portals. */
router.get('/packages', (req, res) => {
  res.json({ packages: PACKAGES });
});

// ---------- consultation requests (the landing page CTA) ----------

const leadLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 5,
  legacyHeaders: false,
  message: { error: 'Too many requests — please try again later or email Career@gethired.world' },
});

const leadSchema = z.object({
  fullName: z.string().min(2, 'Please tell us your name').max(120),
  email: z.string().email('Please enter a valid email').max(254),
  phone: z.string().max(40).optional().or(z.literal('')),
  interest: z.string().max(160).optional().or(z.literal('')),
  message: z.string().max(2000).optional().or(z.literal('')),
});

router.post('/consultations', leadLimiter, validate(leadSchema), async (req, res, next) => {
  try {
    const { fullName, email, phone, interest, message } = req.body;
    const lead = await prisma.consultationRequest.create({
      data: {
        fullName,
        email: email.toLowerCase(),
        phone: phone || null,
        interest: interest || null,
        message: message || null,
      },
      select: { id: true, createdAt: true },
    });

    // Notify the office; never fail the request if mail transport is down.
    sendMail({
      to: env.officeEmail,
      subject: `New consultation request — ${fullName}`,
      html: brandedEmail({
        heading: 'New Consultation Request',
        bodyHtml: `
          <p><strong>${fullName}</strong> &lt;${email}&gt;${phone ? ` · ${phone}` : ''}</p>
          ${interest ? `<p>Interested in: <strong>${interest}</strong></p>` : ''}
          ${message ? `<p>${String(message).replace(/</g, '&lt;')}</p>` : ''}
          <p>Manage this lead in the admin portal → Leads.</p>`,
      }),
      text: `${fullName} <${email}> ${phone || ''} ${interest || ''} ${message || ''}`,
    }).catch((err) => console.error('[lead] office notification failed:', err.message));

    res.status(201).json({ ok: true, id: lead.id });
  } catch (err) {
    next(err);
  }
});

// ---------- newsletter / email capture ----------

const newsletterLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 20,
  legacyHeaders: false,
  message: { error: 'Too many requests — please try again later.' },
});

const newsletterSchema = z.object({
  email: z.string().email('Please enter a valid email').max(254),
  source: z.string().max(40).optional().or(z.literal('')),
});

router.post('/newsletter', newsletterLimiter, validate(newsletterSchema), async (req, res, next) => {
  try {
    const email = req.body.email.toLowerCase();
    // Upsert keeps it idempotent — a repeat sign-up is a no-op, never an error.
    await prisma.newsletterSubscriber.upsert({
      where: { email },
      create: { email, source: req.body.source || null },
      update: {},
    });
    res.status(201).json({ ok: true });
  } catch (err) {
    next(err);
  }
});

// ---------- published content (blog / success stories / insights) ----------

const TYPES = ['blog', 'story', 'insight'];

/** List published posts, optionally by type. Never returns drafts or bodies. */
router.get('/posts', async (req, res, next) => {
  try {
    const where = { status: 'published' };
    if (TYPES.includes(req.query.type)) where.type = req.query.type;
    const take = Math.min(Number(req.query.limit) || 50, 100);
    const posts = await prisma.post.findMany({
      where,
      orderBy: [{ publishedAt: 'desc' }],
      take,
      select: {
        id: true, type: true, title: true, slug: true, category: true, summary: true,
        publishedAt: true, coverImageKey: true, author: { select: { fullName: true } },
      },
    });
    res.json({
      posts: posts.map(({ coverImageKey, author, ...p }) => ({
        ...p,
        authorName: author?.fullName || null,
        coverUrl: coverImageKey ? `${env.appBaseUrl}/public/post-image/${p.id}` : null,
      })),
    });
  } catch (err) {
    next(err);
  }
});

/** A single published post by slug — includes the (sanitised) body. */
router.get('/posts/:slug', async (req, res, next) => {
  try {
    const post = await prisma.post.findFirst({
      where: { slug: req.params.slug, status: 'published' },
      select: {
        id: true, type: true, title: true, slug: true, category: true, summary: true,
        body: true, publishedAt: true, coverImageKey: true, author: { select: { fullName: true } },
      },
    });
    if (!post) return res.status(404).json({ error: 'Not found' });
    const { coverImageKey, author, ...rest } = post;
    res.json({
      post: {
        ...rest,
        authorName: author?.fullName || null,
        coverUrl: coverImageKey ? `${env.appBaseUrl}/public/post-image/${post.id}` : null,
      },
    });
  } catch (err) {
    next(err);
  }
});

/** Dynamic sitemap of published posts (referenced from robots.txt). */
router.get('/sitemap.xml', async (req, res, next) => {
  try {
    const base = env.primaryClientOrigin.replace(/\/$/, '');
    const posts = await prisma.post.findMany({
      where: { status: 'published' },
      select: { slug: true, updatedAt: true },
      orderBy: { publishedAt: 'desc' },
      take: 1000,
    });
    const urls = posts
      .map((p) => `<url><loc>${base}/post.html?slug=${encodeURIComponent(p.slug)}</loc><lastmod>${p.updatedAt.toISOString().slice(0, 10)}</lastmod></url>`)
      .join('');
    res.setHeader('Content-Type', 'application/xml');
    res.setHeader('Cache-Control', 'public, max-age=3600');
    res.end(`<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${urls}</urlset>`);
  } catch (err) {
    next(err);
  }
});

/** Stream a published post's cover image (persists — signed URLs would expire). */
router.get('/post-image/:id', async (req, res, next) => {
  try {
    const post = await prisma.post.findUnique({
      where: { id: req.params.id },
      select: { coverImageKey: true, status: true },
    });
    if (!post || post.status !== 'published' || !post.coverImageKey) return res.status(404).end();
    const buf = await readFileBuffer(post.coverImageKey);
    if (!buf) return res.status(404).end();
    res.setHeader('Content-Type', inlineContentType(post.coverImageKey) || 'image/jpeg');
    res.setHeader('Cache-Control', 'public, max-age=3600');
    res.end(buf);
  } catch (err) {
    next(err);
  }
});

export default router;
