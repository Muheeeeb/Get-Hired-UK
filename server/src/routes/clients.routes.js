import { Router } from 'express';
import multer from 'multer';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { authenticate, authorizeRole, loadClientScope } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { buildFileKey, saveFile, deleteFile } from '../lib/storage.js';
import { daysUntil, dateOnly, todayISO } from '../utils/dates.js';
import { buildPackageMonths } from '../lib/packageTracking.js';
import { encryptSecret, decryptSecret, credentialsEnabled } from '../lib/secrets.js';

const router = Router();
router.use(authenticate);

const countries = ['United Kingdom', 'Australia', 'Canada', 'New Zealand'];
const profileSchema = z.object({
  dateOfBirth: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  niNumber: z.string().min(2).max(80),
  visaStatus: z.string().min(2).max(120),
  visaExpiryDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  residentialAddress: z.string().min(5).max(2000),
  postcode: z.string().min(2).max(30),
  phone: z.string().min(5).max(40),
  // Optional: accept a string, empty string, null, or missing (the write below
  // coalesces any falsy value to null).
  notes: z.string().max(2000).nullish(),
});

// This endpoint deliberately uses the caller rather than a supplied ID: clients
// can only ever read or update their own sensitive account details.
router.get('/me/profile', authorizeRole(['client']), async (req, res, next) => {
  try {
    const profile = await prisma.clientProfile.findUnique({ where: { userId: req.user.id }, include: { user: { select: { phone: true } } } });
    if (!profile) return res.status(404).json({ error: 'Client profile not found' });
    const complete = Boolean(profile.dateOfBirth && profile.niNumber && profile.visaStatus && profile.visaExpiryDate && profile.residentialAddress && profile.postcode && profile.user.phone);
    res.json({ profile: { ...profile, phone: profile.user.phone }, complete, countries });
  } catch (err) { next(err); }
});

router.put('/me/profile', authorizeRole(['client']), validate(profileSchema), async (req, res, next) => {
  try {
    const { phone, dateOfBirth, visaExpiryDate, ...profileData } = req.body;
    const profile = await prisma.$transaction(async (tx) => {
      await tx.user.update({ where: { id: req.user.id }, data: { phone } });
      return tx.clientProfile.update({
        where: { userId: req.user.id },
        data: { ...profileData, dateOfBirth: dateOnly(dateOfBirth), visaExpiryDate: dateOnly(visaExpiryDate), notes: profileData.notes || null },
      });
    });
    res.json({ profile, complete: true });
  } catch (err) { next(err); }
});

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const ok = /\.(pdf|doc|docx|txt|md|rtf|odt)$/i.test(file.originalname);
    cb(ok ? null : new Error('Unsupported file type. Allowed: pdf, doc, docx, txt, md, rtf, odt'), ok);
  },
});

// All routes below operate on /clients/:id/... and are scoped by loadClientScope:
// admin → all clients, employee → assigned only, client → self only.

// ---------- dashboard (role-shaped payload) ----------

router.get('/:id/dashboard', loadClientScope, async (req, res, next) => {
  try {
    const profile = req.clientProfile;
    const [packageJobs, domains, resourceCount, recentJobs] = await Promise.all([
      prisma.jobApplication.findMany({
        where: { clientId: profile.id },
        select: { applicationDate: true },
      }),
      prisma.domain.findMany({
        where: { clientId: profile.id },
        include: {
          masterDocuments: {
            select: { id: true, type: true, fileName: true, uploadedAt: true },
          },
        },
        orderBy: { createdAt: 'asc' },
      }),
      prisma.interviewResource.count(),
      prisma.jobApplication.findMany({
        where: { clientId: profile.id },
        orderBy: [{ applicationDate: 'desc' }, { createdAt: 'desc' }],
        take: 5,
        select: { id: true, jobTitle: true, company: true, applicationDate: true, jobUrl: true },
      }),
    ]);

    const daysRemaining = daysUntil(profile.expiryDate);
    const packageTracking = buildPackageMonths({
      packageStartedAt: profile.packageStartedAt,
      expiryDate: profile.expiryDate,
      monthlyJobTarget: profile.monthlyJobTarget,
      applicationDates: packageJobs.map((job) => job.applicationDate),
      today: todayISO(),
    });

    const payload = {
      client: {
        id: profile.id,
        fullName: profile.user.fullName,
        packageType: profile.packageType,
        linkedinStatus: profile.linkedinStatus,
        monthlyJobTarget: profile.monthlyJobTarget,
        ...(req.user.role !== 'client' ? {
          country: profile.country, dateOfBirth: profile.dateOfBirth, niNumber: profile.niNumber,
          visaStatus: profile.visaStatus, visaExpiryDate: profile.visaExpiryDate,
          residentialAddress: profile.residentialAddress, postcode: profile.postcode,
          phone: profile.user.phone, notes: profile.notes,
        } : {}),
      },
      momentum: {
        applied: packageTracking.current.applications,
        target: profile.monthlyJobTarget,
        percent: packageTracking.current.percent,
        month: packageTracking.current.month,
        startDate: packageTracking.current.startDate,
        endDate: packageTracking.current.endDate,
      },
      monthlyBreakdown: packageTracking.months,
      packageMonths: packageTracking.totalMonths,
      expiry: {
        // Days-remaining is computed here, server-side — never from the browser clock.
        daysRemaining,
        expiringSoon: daysRemaining >= 0 && daysRemaining <= 7,
        expired: daysRemaining < 0,
        expiryDate: profile.expiryDate,
      },
      domains,
      resourceCount,
      recentJobs,
    };

    if (req.user.role !== 'client') {
      payload.client.email = profile.user.email;
      payload.assignedEmployeeId = profile.assignedEmployeeId;
      payload.clientActive = profile.user.isActive;
    }

    res.json(payload);
  } catch (err) {
    next(err);
  }
});

// ---------- master documents (visible to all three roles) ----------

router.get('/:id/master-docs', loadClientScope, async (req, res, next) => {
  try {
    const domains = await prisma.domain.findMany({
      where: { clientId: req.clientProfile.id },
      include: {
        masterDocuments: {
          select: { id: true, type: true, fileName: true, uploadedAt: true },
        },
      },
      orderBy: { createdAt: 'asc' },
    });
    res.json({ domains });
  } catch (err) {
    next(err);
  }
});

const masterDocSchema = z.object({
  domainId: z.string().uuid(),
  type: z.enum(['master_cv', 'master_cover_letter']),
});

router.post(
  '/:id/master-docs',
  authorizeRole(['admin', 'employee']),
  loadClientScope,
  upload.single('file'),
  async (req, res, next) => {
    try {
      const parsed = masterDocSchema.safeParse(req.body);
      if (!parsed.success) return res.status(400).json({ error: 'domainId and type are required' });
      if (!req.file) return res.status(400).json({ error: 'A file is required' });

      const domain = await prisma.domain.findFirst({
        where: { id: parsed.data.domainId, clientId: req.clientProfile.id },
      });
      if (!domain) return res.status(404).json({ error: 'Domain not found for this client' });

      const fileKey = buildFileKey(`masters/${req.clientProfile.id}`, req.file.originalname);
      await saveFile(fileKey, req.file.buffer, req.file.mimetype);

      // If we're replacing an existing master, remember its old file for cleanup.
      const previous = await prisma.masterDocument.findUnique({
        where: { domainId_type: { domainId: domain.id, type: parsed.data.type } },
        select: { fileKey: true },
      });

      // One master CV + one master cover letter per domain (upsert replaces).
      const doc = await prisma.masterDocument.upsert({
        where: { domainId_type: { domainId: domain.id, type: parsed.data.type } },
        create: {
          domainId: domain.id,
          type: parsed.data.type,
          fileKey,
          fileName: req.file.originalname,
          uploadedById: req.user.id,
        },
        update: { fileKey, fileName: req.file.originalname, uploadedById: req.user.id, uploadedAt: new Date() },
        select: { id: true, type: true, fileName: true, uploadedAt: true, domainId: true },
      });

      if (previous && previous.fileKey !== fileKey) await deleteFile(previous.fileKey);

      res.status(201).json({ document: doc });
    } catch (err) {
      next(err);
    }
  }
);

// ---------- job applications ----------

router.get('/:id/jobs', loadClientScope, async (req, res, next) => {
  try {
    const jobs = await prisma.jobApplication.findMany({
      where: { clientId: req.clientProfile.id },
      orderBy: [{ applicationDate: 'desc' }, { createdAt: 'desc' }],
      select: {
        id: true,
        jobTitle: true,
        company: true,
        applicationDate: true,
        jobUrl: true,
        // Tailored documents are included for admin/employee ONLY — stripped below for clients.
        tailoredDocuments: {
          select: { id: true, type: true, fileName: true, uploadedAt: true },
        },
        employee: { select: { id: true, fullName: true } },
      },
    });

    if (req.user.role === 'client') {
      // THE PRIVACY RULE: clients get safe columns only. No tailored docs, ever.
      return res.json({
        jobs: jobs.map(({ id, jobTitle, company, applicationDate, jobUrl }) => ({
          id, jobTitle, company, applicationDate, jobUrl,
        })),
      });
    }

    // Flag duplicate job URLs for the team view (allowed, but highlighted red).
    const urlCounts = new Map();
    for (const j of jobs) urlCounts.set(j.jobUrl, (urlCounts.get(j.jobUrl) || 0) + 1);
    res.json({
      jobs: jobs.map((j) => ({ ...j, duplicateUrl: urlCounts.get(j.jobUrl) > 1 })),
    });
  } catch (err) {
    next(err);
  }
});

const logJobSchema = z.object({
  jobTitle: z.string().min(2).max(160),
  company: z.string().min(1).max(160),
  applicationDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Expected YYYY-MM-DD'),
  jobUrl: z.string().url().max(2000),
});

router.post(
  '/:id/jobs',
  authorizeRole(['admin', 'employee']),
  loadClientScope,
  validate(logJobSchema),
  async (req, res, next) => {
    try {
      const job = await prisma.jobApplication.create({
        data: {
          clientId: req.clientProfile.id,
          employeeId: req.user.id,
          jobTitle: req.body.jobTitle,
          company: req.body.company,
          applicationDate: dateOnly(req.body.applicationDate),
          jobUrl: req.body.jobUrl,
        },
      });
      res.status(201).json({ job });
    } catch (err) {
      next(err);
    }
  }
);

// ---------- LinkedIn status ----------

router.put(
  '/:id/linkedin-status',
  authorizeRole(['admin', 'employee']),
  loadClientScope,
  validate(z.object({ status: z.enum(['not_started', 'in_progress', 'complete']) })),
  async (req, res, next) => {
    try {
      const updated = await prisma.clientProfile.update({
        where: { id: req.clientProfile.id },
        data: { linkedinStatus: req.body.status },
        select: { id: true, linkedinStatus: true },
      });
      res.json({ client: updated });
    } catch (err) {
      next(err);
    }
  }
);

// ---------- job-board logins ----------
//
// Clients store the logins we apply with (email, LinkedIn, Indeed, NHS Jobs).
// Passwords are ENCRYPTED, never hashed — we have to sign in as the client — and
// are never included in any listing. Reading one back is a separate, audited call.

const SERVICES = ['email', 'linkedin', 'indeed', 'nhs_jobs'];

const credentialsSchema = z.object({
  credentials: z.array(
    z.object({
      service: z.enum(SERVICES),
      username: z.string().max(254).optional().or(z.literal('')),
      password: z.string().max(400).optional().or(z.literal('')),
      remove: z.boolean().optional(),
    })
  ).max(SERVICES.length),
});

/** Masked view — what exists, never the secret itself. */
function maskCredential(c) {
  return { service: c.service, username: c.username, hasPassword: true, updatedAt: c.updatedAt };
}

async function listCredentials(clientId) {
  const rows = await prisma.clientCredential.findMany({
    where: { clientId },
    orderBy: { service: 'asc' },
  });
  return rows.map(maskCredential);
}

/**
 * Save/update/remove logins. Deliberately forgiving: this section is optional, so
 * an incomplete entry is skipped and reported rather than failing the whole save.
 * An empty password on an existing entry keeps the stored one (lets the UI submit
 * its masked state without wiping the secret).
 */
async function saveCredentials(clientId, body, userId) {
  const parsed = credentialsSchema.safeParse(body);
  if (!parsed.success) return { error: 'Invalid credentials payload' };
  if (!parsed.data.credentials.length) return { skipped: [] };
  if (!credentialsEnabled()) {
    return { error: 'Credential storage is not configured on the server (CREDENTIALS_ENC_KEY)' };
  }

  const skipped = [];
  for (const entry of parsed.data.credentials) {
    const existing = await prisma.clientCredential.findUnique({
      where: { clientId_service: { clientId, service: entry.service } },
    });

    if (entry.remove) {
      if (existing) await prisma.clientCredential.delete({ where: { id: existing.id } });
      continue;
    }

    const username = (entry.username || '').trim();
    const password = entry.password || '';
    if (!username && !password) continue; // left blank — nothing to do

    if (existing) {
      await prisma.clientCredential.update({
        where: { id: existing.id },
        data: {
          ...(username ? { username } : {}),
          ...(password ? { secretEnc: encryptSecret(password) } : {}),
          updatedById: userId,
        },
      });
    } else if (username && password) {
      await prisma.clientCredential.create({
        data: { clientId, service: entry.service, username, secretEnc: encryptSecret(password), updatedById: userId },
      });
    } else {
      // Half-filled and nothing stored yet — report it, but never block the save.
      skipped.push(entry.service);
    }
  }
  return { skipped };
}

/** The signed-in client's own logins. */
router.get('/me/credentials', authorizeRole(['client']), async (req, res, next) => {
  try {
    const profile = await prisma.clientProfile.findUnique({ where: { userId: req.user.id }, select: { id: true } });
    if (!profile) return res.status(404).json({ error: 'Client profile not found' });
    res.json({ credentials: await listCredentials(profile.id), services: SERVICES });
  } catch (err) { next(err); }
});

router.put('/me/credentials', authorizeRole(['client']), async (req, res, next) => {
  try {
    const profile = await prisma.clientProfile.findUnique({ where: { userId: req.user.id }, select: { id: true } });
    if (!profile) return res.status(404).json({ error: 'Client profile not found' });
    const result = await saveCredentials(profile.id, req.body, req.user.id);
    if (result.error) return res.status(400).json({ error: result.error });
    res.json({ credentials: await listCredentials(profile.id), skipped: result.skipped });
  } catch (err) { next(err); }
});

/** Admin view of a client's logins — masked. Employees cannot access credentials. */
router.get('/:id/credentials', authorizeRole(['admin']), loadClientScope, async (req, res, next) => {
  try {
    res.json({ credentials: await listCredentials(req.clientProfile.id), services: SERVICES });
  } catch (err) { next(err); }
});

/** An admin can also enter them on a client's behalf (e.g. sent by email). */
router.put('/:id/credentials', authorizeRole(['admin']), loadClientScope, async (req, res, next) => {
  try {
    const result = await saveCredentials(req.clientProfile.id, req.body, req.user.id);
    if (result.error) return res.status(400).json({ error: result.error });
    res.json({ credentials: await listCredentials(req.clientProfile.id), skipped: result.skipped });
  } catch (err) { next(err); }
});

/**
 * Reveal one password so an admin can apply as the client. Every reveal is
 * written to the access log first so it is always attributable.
 */
router.post('/:id/credentials/:service/reveal', authorizeRole(['admin']), loadClientScope, async (req, res, next) => {
  try {
    const { service } = req.params;
    if (!SERVICES.includes(service)) return res.status(400).json({ error: 'Unknown service' });
    const row = await prisma.clientCredential.findUnique({
      where: { clientId_service: { clientId: req.clientProfile.id, service } },
    });
    if (!row) return res.status(404).json({ error: 'No login stored for this service' });

    await prisma.credentialAccessLog.create({
      data: { clientId: req.clientProfile.id, service, userId: req.user.id },
    });
    res.json({ service, username: row.username, password: decryptSecret(row.secretEnc) });
  } catch (err) { next(err); }
});

/** Who has revealed this client's logins (admin only). */
router.get('/:id/credentials/log', authorizeRole(['admin']), loadClientScope, async (req, res, next) => {
  try {
    const entries = await prisma.credentialAccessLog.findMany({
      where: { clientId: req.clientProfile.id },
      orderBy: { createdAt: 'desc' },
      take: 100,
      include: { user: { select: { fullName: true, role: true } } },
    });
    res.json({
      entries: entries.map((e) => ({
        id: e.id, service: e.service, at: e.createdAt,
        by: e.user.fullName, role: e.user.role,
      })),
    });
  } catch (err) { next(err); }
});

export default router;
