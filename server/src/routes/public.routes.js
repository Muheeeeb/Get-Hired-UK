import { Router } from 'express';
import { z } from 'zod';
import rateLimit from 'express-rate-limit';
import { prisma } from '../lib/prisma.js';
import { validate } from '../middleware/validate.js';
import { sendMail, brandedEmail } from '../lib/mailer.js';
import { startOfMonth } from '../utils/dates.js';

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

// ---------- consultation requests (the landing page CTA) ----------

const leadLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 5,
  legacyHeaders: false,
  message: { error: 'Too many requests — please try again later or email hello@gethired.uk' },
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
      to: 'hello@gethired.uk',
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

export default router;
