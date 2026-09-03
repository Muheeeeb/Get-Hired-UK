import { Router } from 'express';
import multer from 'multer';
import { z } from 'zod';
import rateLimit from 'express-rate-limit';
import { prisma } from '../lib/prisma.js';
import { authenticate, authorizeRole } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { defaultClaudeModel, draftCoverLetter, generateDocument, listClaudeModels } from '../lib/ai.js';
import { tryReadFileText } from '../lib/storage.js';
import { env } from '../config/env.js';
import { resolveClaudeModel } from '../lib/aiAccess.js';

const router = Router();

// The studio is conversational — a specialist iterating on a draft sends several
// turns a minute, so this is higher than a one-shot generator would need.
const aiLimiter = rateLimit({ windowMs: 60 * 1000, limit: 30, legacyHeaders: false });

const refUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
});

const schema = z.object({
  clientId: z.string().uuid(),
  domainId: z.string().uuid().optional(),
  jobTitle: z.string().min(2).max(160),
  company: z.string().min(1).max(160),
  model: z.string().regex(/^claude-[a-zA-Z0-9._-]+$/).max(200).optional(),
});

async function selectedModel(req, requested) {
  return resolveClaudeModel({
    role: req.user.role,
    assignedModel: req.user.aiModel,
    requestedModel: requested,
    defaultModel: await defaultClaudeModel(),
  });
}

/** Available Claude models; employees only receive their admin-approved model. */
router.get('/models', authenticate, authorizeRole(['admin', 'employee']), async (req, res, next) => {
  try {
    const effectiveModel = req.user.aiModel || await defaultClaudeModel();
    if (req.user.role === 'employee') {
      return res.json({
        models: [{ id: effectiveModel, name: effectiveModel }],
        selectedModel: effectiveModel,
        canChoose: false,
        configured: Boolean(env.anthropicApiKey),
      });
    }
    const models = await listClaudeModels();
    res.json({ models, selectedModel: effectiveModel, canChoose: true, configured: Boolean(env.anthropicApiKey) });
  } catch (err) {
    next(err);
  }
});

/** ✨ Draft with AI — admin/employee only; the Anthropic key never reaches the browser. */
router.post(
  '/cover-letter',
  authenticate,
  authorizeRole(['admin', 'employee']),
  aiLimiter,
  validate(schema),
  async (req, res, next) => {
    try {
      const { clientId, domainId, jobTitle, company } = req.body;
      const model = await selectedModel(req, req.body.model);

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
        model,
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
 * Claude model choice is enforced server-side for each employee.
 */
router.post(
  '/generate',
  authenticate,
  authorizeRole(['admin', 'employee']),
  aiLimiter,
  // Several reference files per turn. "file" is kept so a browser still running
  // the previous build doesn't break mid-deploy.
  refUpload.fields([{ name: 'files', maxCount: 6 }, { name: 'file', maxCount: 1 }]),
  async (req, res, next) => {
    try {
      const schema = z.object({
        kind: z.enum(['cv', 'cover_letter', 'freeform']).default('freeform'),
        prompt: z.string().min(3).max(6000),
        clientId: z.string().uuid().optional().or(z.literal('')),
        domainId: z.string().uuid().optional().or(z.literal('')),
        // Prior turns, JSON-encoded (multipart carries strings only).
        history: z.string().max(200000).optional().or(z.literal('')),
        model: z.string().regex(/^claude-[a-zA-Z0-9._-]+$/).max(200).optional().or(z.literal('')),
      });
      const parsed = schema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ error: parsed.error.issues[0]?.message || 'Invalid request' });
      }
      const { kind, prompt, clientId, domainId } = parsed.data;
      const model = await selectedModel(req, parsed.data.model || undefined);

      // Keep only well-formed turns, and only the recent ones so the prompt
      // cannot grow without bound over a long conversation.
      let history = [];
      if (parsed.data.history) {
        try {
          const raw = JSON.parse(parsed.data.history);
          if (Array.isArray(raw)) {
            history = raw
              .filter((m) => m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string')
              .slice(-20)
              .map((m) => ({ role: m.role, content: m.content.slice(0, 12000) }));
          }
        } catch {
          return res.status(400).json({ error: 'Invalid conversation history' });
        }
      }

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

      // Reference files: plain-text formats are read directly, each labelled so
      // the model can tell them apart. Anything else is reported back, not silently dropped.
      const uploaded = [...(req.files?.files || []), ...(req.files?.file || [])];
      const readable = uploaded.filter((f) => /\.(txt|md)$/i.test(f.originalname));
      const skipped = uploaded.filter((f) => !/\.(txt|md)$/i.test(f.originalname));
      // Share the text budget across the files so one big upload can't crowd out the rest.
      const perFile = readable.length ? Math.floor(30000 / readable.length) : 0;
      const referenceText = readable.length
        ? readable
            .map((f) => `--- ${f.originalname} ---\n${f.buffer.toString('utf8').slice(0, perFile)}`)
            .join('\n\n')
        : null;

      const result = await generateDocument({
        kind, prompt, clientName, domainName, masterText, referenceText, history, model,
      });
      res.json({
        ...result,
        usedFiles: readable.map((f) => f.originalname),
        note: skipped.length
          ? `Ignored ${skipped.length} file${skipped.length === 1 ? '' : 's'} (${skipped.map((f) => f.originalname).join(', ')}) — only .txt/.md can be read as text.`
          : undefined,
      });
    } catch (err) {
      next(err);
    }
  }
);

export default router;
