import { Router } from 'express';
import multer from 'multer';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { authenticate, authorizeRole, loadClientScope } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { buildFileKey, saveFile, deleteFile } from '../lib/storage.js';
import { startOfMonth, daysUntil, dateOnly } from '../utils/dates.js';

const router = Router();
router.use(authenticate);

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
    const monthStart = startOfMonth();

    const [monthCount, domains, resourceCount, recentJobs] = await Promise.all([
      prisma.jobApplication.count({
        where: { clientId: profile.id, applicationDate: { gte: monthStart } },
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

    const payload = {
      client: {
        id: profile.id,
        fullName: profile.user.fullName,
        packageType: profile.packageType,
        linkedinStatus: profile.linkedinStatus,
        monthlyJobTarget: profile.monthlyJobTarget,
      },
      momentum: {
        applied: monthCount,
        target: profile.monthlyJobTarget,
        percent: Math.min(100, Math.round((monthCount / profile.monthlyJobTarget) * 100)),
      },
      expiry: {
        // Days-remaining is computed here, server-side — never from the browser clock.
        daysRemaining,
        expiringSoon: daysRemaining <= 7,
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

    res.json({ jobs });
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

export default router;
