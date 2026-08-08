import { Router } from 'express';
import multer from 'multer';
import { z } from 'zod';
import sanitizeHtml from 'sanitize-html';
import { prisma } from '../lib/prisma.js';
import { authenticate, authorizeRole } from '../middleware/auth.js';
import { buildFileKey, saveFile, deleteFile } from '../lib/storage.js';

const router = Router();

// Social-media staff (and admins) manage all content here.
router.use(authenticate, authorizeRole(['social', 'admin']));

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 6 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const ok = /\.(png|jpe?g|webp|gif)$/i.test(file.originalname);
    cb(ok ? null : new Error('Cover image must be PNG, JPG, WEBP or GIF'), ok);
  },
});

// The post body is rich HTML from the editor — sanitise it so nothing dangerous
// is ever stored or later rendered on the public site.
function cleanBody(html) {
  return sanitizeHtml(html || '', {
    allowedTags: ['p', 'br', 'strong', 'b', 'em', 'i', 'u', 's', 'h2', 'h3', 'h4',
      'ul', 'ol', 'li', 'blockquote', 'a', 'code', 'pre', 'hr'],
    allowedAttributes: { a: ['href', 'target', 'rel'] },
    allowedSchemes: ['http', 'https', 'mailto'],
    transformTags: {
      a: (tagName, attribs) => ({
        tagName: 'a',
        attribs: { ...attribs, target: '_blank', rel: 'noopener noreferrer' },
      }),
    },
  });
}

function slugify(s) {
  return (s || '')
    .toLowerCase().trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80) || 'post';
}

async function uniqueSlug(base, excludeId = null) {
  let slug = base;
  let n = 1;
  // Cap iterations defensively; collisions are rare.
  while (n < 500) {
    const existing = await prisma.post.findUnique({ where: { slug }, select: { id: true } });
    if (!existing || existing.id === excludeId) return slug;
    n += 1;
    slug = `${base}-${n}`;
  }
  return `${base}-${Math.floor(Date.now())}`;
}

const postSelect = {
  id: true, type: true, title: true, slug: true, category: true, summary: true,
  body: true, coverImageKey: true, status: true, publishedAt: true, createdAt: true, updatedAt: true,
  author: { select: { fullName: true } },
};
function shape(p) {
  const { coverImageKey, author, ...rest } = p;
  return { ...rest, authorName: author?.fullName || null, hasCover: Boolean(coverImageKey) };
}

// ---------- list (portal: all statuses) ----------
router.get('/', async (req, res, next) => {
  try {
    const where = {};
    if (['blog', 'story', 'insight'].includes(req.query.type)) where.type = req.query.type;
    const posts = await prisma.post.findMany({
      where,
      orderBy: [{ updatedAt: 'desc' }],
      select: postSelect,
    });
    res.json({ posts: posts.map(shape) });
  } catch (err) { next(err); }
});

router.get('/:id', async (req, res, next) => {
  try {
    const post = await prisma.post.findUnique({ where: { id: req.params.id }, select: postSelect });
    if (!post) return res.status(404).json({ error: 'Post not found' });
    res.json({ post: shape(post) });
  } catch (err) { next(err); }
});

// What we're willing to store once the HTML has been cleaned. The raw cap is far
// looser: pasting from Word or Google Docs carries a lot of markup (and inline
// base64 images) that sanitising strips away, so the raw paste must not be
// rejected before we've had a chance to clean it down to size.
const MAX_BODY = 400_000;
const MAX_RAW_BODY = 8_000_000;

const bodySchema = z.object({
  type: z.enum(['blog', 'story', 'insight']),
  title: z.string().min(2).max(200),
  category: z.string().max(80).optional().or(z.literal('')),
  summary: z.string().max(500).optional().or(z.literal('')),
  body: z.string().max(MAX_RAW_BODY).optional().or(z.literal('')),
  status: z.enum(['draft', 'published']).optional(),
});

const FIELD_NAMES = {
  type: 'Type', title: 'Title', category: 'Category',
  summary: 'Summary', body: 'Main text', status: 'Status',
};

/**
 * Say what actually failed. This used to answer every validation error with
 * "Title and type are required", which sent people hunting for a problem in
 * fields that were filled in correctly.
 */
function describeIssue(issues) {
  const i = issues[0];
  if (!i) return 'Please check the form and try again.';
  const name = FIELD_NAMES[i.path?.[0]] || i.path?.[0] || 'Field';
  switch (i.code) {
    case 'too_big':
      return `${name} is too long — maximum ${Number(i.maximum).toLocaleString('en-GB')} characters.`;
    case 'too_small':
      return `${name} must be at least ${i.minimum} character${i.minimum === 1 ? '' : 's'}.`;
    case 'invalid_type':
    case 'invalid_enum_value':
    case 'invalid_union':
      return `${name} is required.`;
    default:
      return `${name}: ${i.message}`;
  }
}

// ---------- create ----------
router.post('/', upload.single('cover'), async (req, res, next) => {
  try {
    const parsed = bodySchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: describeIssue(parsed.error.issues), details: parsed.error.issues });
    const d = parsed.data;

    // Clean first, then size-check: what matters is the length of what we store.
    const cleanedBody = cleanBody(d.body);
    if (cleanedBody.length > MAX_BODY) {
      return res.status(400).json({ error: `Main text is too long — maximum ${MAX_BODY.toLocaleString('en-GB')} characters.` });
    }

    let coverImageKey = null;
    if (req.file) {
      coverImageKey = buildFileKey('posts', req.file.originalname);
      await saveFile(coverImageKey, req.file.buffer, req.file.mimetype);
    }

    const status = d.status || 'draft';
    const post = await prisma.post.create({
      data: {
        type: d.type,
        title: d.title,
        slug: await uniqueSlug(slugify(d.title)),
        category: d.category || null,
        summary: d.summary || null,
        body: cleanedBody,
        coverImageKey,
        status,
        publishedAt: status === 'published' ? new Date() : null,
        authorId: req.user.id,
      },
      select: postSelect,
    });
    res.status(201).json({ post: shape(post) });
  } catch (err) { next(err); }
});

// ---------- update ----------
router.put('/:id', upload.single('cover'), async (req, res, next) => {
  try {
    const parsed = bodySchema.partial().safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: describeIssue(parsed.error.issues), details: parsed.error.issues });
    const d = parsed.data;

    const current = await prisma.post.findUnique({ where: { id: req.params.id } });
    if (!current) return res.status(404).json({ error: 'Post not found' });

    const data = {};
    if (d.type) data.type = d.type;
    if (d.title !== undefined) { data.title = d.title; data.slug = await uniqueSlug(slugify(d.title), current.id); }
    if (d.category !== undefined) data.category = d.category || null;
    if (d.summary !== undefined) data.summary = d.summary || null;
    if (d.body !== undefined) {
      const cleaned = cleanBody(d.body);
      if (cleaned.length > MAX_BODY) {
        return res.status(400).json({ error: `Main text is too long — maximum ${MAX_BODY.toLocaleString('en-GB')} characters.` });
      }
      data.body = cleaned;
    }
    if (d.status && d.status !== current.status) {
      data.status = d.status;
      // Stamp publishedAt the first time it goes live; keep it stable afterwards.
      data.publishedAt = d.status === 'published' ? (current.publishedAt || new Date()) : null;
    }

    if (req.file) {
      const newKey = buildFileKey('posts', req.file.originalname);
      await saveFile(newKey, req.file.buffer, req.file.mimetype);
      data.coverImageKey = newKey;
      if (current.coverImageKey) await deleteFile(current.coverImageKey);
    }

    const post = await prisma.post.update({ where: { id: current.id }, data, select: postSelect });
    res.json({ post: shape(post) });
  } catch (err) { next(err); }
});

// ---------- delete ----------
router.delete('/:id', async (req, res, next) => {
  try {
    const post = await prisma.post.findUnique({ where: { id: req.params.id } });
    if (!post) return res.status(404).json({ error: 'Post not found' });
    await prisma.post.delete({ where: { id: post.id } });
    if (post.coverImageKey) await deleteFile(post.coverImageKey);
    res.json({ ok: true });
  } catch (err) { next(err); }
});

export default router;
