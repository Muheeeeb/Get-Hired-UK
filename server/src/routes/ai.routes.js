import { Router } from 'express';
import { z } from 'zod';
import rateLimit from 'express-rate-limit';
import { prisma } from '../lib/prisma.js';
import { authenticate, authorizeRole } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { draftCoverLetter } from '../lib/ai.js';
import { tryReadFileText } from '../lib/storage.js';

const router = Router();

const aiLimiter = rateLimit({ windowMs: 60 * 1000, limit: 10, legacyHeaders: false });

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

export default router;
