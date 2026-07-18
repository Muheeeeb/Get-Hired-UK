import { Router } from 'express';
import multer from 'multer';
import { z } from 'zod';
import rateLimit from 'express-rate-limit';
import { prisma } from '../lib/prisma.js';
import { authenticate, authorizeRole } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { draftCoverLetter, generateDocument } from '../lib/ai.js';
import { tryReadFileText } from '../lib/storage.js';

const router = Router();

const aiLimiter = rateLimit({ windowMs: 60 * 1000, limit: 10, legacyHeaders: false });

const refUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
});

const schema = z.object({
  clientId: z.string().uuid(),
  domainId: z.string().uuid().optional(),
  jobTitle: z.string().min(2).max(160),
  company: z.string().min(1).max(160),
});

/** ✨ Draft with AI — admin/employee only; the OpenAI key never reaches the browser. */
router.post(
  '/cover-letter',
  authenticate,
  authorizeRole(['admin', 'employee']),
  aiLimiter,
  validate(schema),
  async (req, res, next) => {
    try {
      const { clientId, domainId, jobTitle, company } = req.body;

      const profile = await prisma.clientProfile.findUnique({
        where: { id: clientId },
        include: { user: { select: { fullName: true } } },
      });
      if (!profile) return res.status(404).json({ error: 'Client not found' });
      if (req.user.role === 'employee' && profile.assignedEmployeeId !== req.user.id) {
        return res.status(403).json({ error: 'Forbidden' });
      }

      // Pull the master CV for the chosen domain (or the client's first domain).
      const domain = await prisma.domain.findFirst({
        where: { clientId, ...(domainId ? { id: domainId } : {}) },
        include: { masterDocuments: { where: { type: 'master_cv' } } },
      });
      const masterCv = domain?.masterDocuments[0];
      const masterCvText = masterCv ? await tryReadFileText(masterCv.fileKey) : null;

      const result = await draftCoverLetter({
        clientName: profile.user.fullName,
        jobTitle,
        company,
        domainName: domain?.name,
        masterCvText,
      });

      res.json(result);
    } catch (err) {
      next(err);
    }
  }
);

/**
 * AI Studio: generate CVs / cover letters / freeform documents from a prompt,
 * optionally grounded in a client's master CV and an uploaded reference file.
 * Modular by design — the provider is env-configured (any OpenAI-compatible API).
 */
router.post(
  '/generate',
  authenticate,
  authorizeRole(['admin', 'employee']),
  aiLimiter,
  refUpload.single('file'),
  async (req, res, next) => {
    try {
      const schema = z.object({
        kind: z.enum(['cv', 'cover_letter', 'freeform']).default('freeform'),
        prompt: z.string().min(3).max(6000),
        clientId: z.string().uuid().optional().or(z.literal('')),
        domainId: z.string().uuid().optional().or(z.literal('')),
      });
      const parsed = schema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ error: parsed.error.issues[0]?.message || 'Invalid request' });
      }
      const { kind, prompt, clientId, domainId } = parsed.data;

      let clientName;
      let domainName;
      let masterText = null;
      if (clientId) {
        const profile = await prisma.clientProfile.findUnique({
          where: { id: clientId },
          include: { user: { select: { fullName: true } } },
        });
        if (!profile) return res.status(404).json({ error: 'Client not found' });
        if (req.user.role === 'employee' && profile.assignedEmployeeId !== req.user.id) {
          return res.status(403).json({ error: 'Forbidden' });
        }
        clientName = profile.user.fullName;
        const domain = await prisma.domain.findFirst({
          where: { clientId, ...(domainId ? { id: domainId } : {}) },
          include: { masterDocuments: { where: { type: 'master_cv' } } },
        });
        domainName = domain?.name;
        const masterCv = domain?.masterDocuments[0];
        masterText = masterCv ? await tryReadFileText(masterCv.fileKey) : null;
      }

      // Reference file: plain-text formats are read directly.
      let referenceText = null;
      if (req.file && /\.(txt|md)$/i.test(req.file.originalname)) {
        referenceText = req.file.buffer.toString('utf8').slice(0, 20000);
      }

      const result = await generateDocument({
        kind, prompt, clientName, domainName, masterText, referenceText,
      });
      res.json({
        ...result,
        note:
          req.file && !referenceText
            ? 'Reference file ignored: only .txt/.md files can be read as text.'
            : undefined,
      });
    } catch (err) {
      next(err);
    }
  }
);

export default router;
