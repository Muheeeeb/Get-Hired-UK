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
import { extractReferenceFiles, SUPPORTED_DOCUMENT_EXTENSIONS } from '../lib/documentText.js';
import { buildDocx, buildPdf } from '../lib/documentExport.js';

const router = Router();

// The studio is conversational — a specialist iterating on a draft sends several
// turns a minute, so this is higher than a one-shot generator would need.
const aiLimiter = rateLimit({ windowMs: 60 * 1000, limit: 30, legacyHeaders: false });
export const MAX_AI_PROMPT_CHARS = 50_000;
export const MAX_AI_HISTORY_JSON_CHARS = 800_000;
const MAX_HISTORY_MESSAGE_CHARS = 60_000;
const MAX_HISTORY_CONTEXT_CHARS = 240_000;

const refUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024, files: 6 },
  fileFilter(req, file, cb) {
    const lower = file.originalname.toLowerCase();
    const supported = SUPPORTED_DOCUMENT_EXTENSIONS.some((ext) => lower.endsWith(ext));
    cb(supported ? null : new Error('Unsupported file type. Allowed: pdf, doc, docx, txt, md'), supported);
  },
});

export function parseConversationHistory(encoded) {
  if (!encoded) return [];
  const raw = JSON.parse(encoded);
  if (!Array.isArray(raw)) throw new Error('Conversation history must be an array');

  const newestFirst = raw
    .filter((message) => message && (message.role === 'user' || message.role === 'assistant') && typeof message.content === 'string')
    .slice(-30)
    .reverse();
  const kept = [];
  let used = 0;
  for (const message of newestFirst) {
    if (used >= MAX_HISTORY_CONTEXT_CHARS) break;
    const content = message.content.slice(0, Math.min(MAX_HISTORY_MESSAGE_CHARS, MAX_HISTORY_CONTEXT_CHARS - used));
    if (!content) continue;
    kept.push({ role: message.role, content });
    used += content.length;
  }
  return kept.reverse();
}

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
        prompt: z.string().min(3).max(MAX_AI_PROMPT_CHARS),
        clientId: z.string().uuid().optional().or(z.literal('')),
        domainId: z.string().uuid().optional().or(z.literal('')),
        // Prior turns, JSON-encoded (multipart carries strings only).
        history: z.string().max(MAX_AI_HISTORY_JSON_CHARS).optional().or(z.literal('')),
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
      try {
        history = parseConversationHistory(parsed.data.history);
      } catch {
        return res.status(400).json({ error: 'Invalid conversation history' });
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

      // PDFs, Word files, and plain text are extracted in memory and labelled so
      // the model can distinguish multiple references.
      const uploaded = [...(req.files?.files || []), ...(req.files?.file || [])];
      let extracted;
      try {
        extracted = await extractReferenceFiles(uploaded);
      } catch (err) {
        return res.status(err.status || 400).json({ error: err.publicMessage || 'A reference file could not be read' });
      }

      const result = await generateDocument({
        kind, prompt, clientName, domainName, masterText,
        referenceText: extracted.referenceText, history, model,
      });
      res.json({
        ...result,
        usedFiles: extracted.usedFiles,
        note: extracted.truncatedFiles.length
          ? `Read ${extracted.usedFiles.length} file${extracted.usedFiles.length === 1 ? '' : 's'}; very long content was trimmed to fit the AI context.`
          : undefined,
      });
    } catch (err) {
      next(err);
    }
  }
);

const exportSchema = z.object({
  content: z.string().min(1).max(250_000),
  kind: z.enum(['cv', 'cover_letter', 'freeform']).default('freeform'),
  format: z.enum(['pdf', 'docx']),
});

/** Create a formatted, authenticated PDF or Word download from an AI draft. */
router.post('/export', authenticate, authorizeRole(['admin', 'employee']), aiLimiter, async (req, res, next) => {
  try {
    const parsed = exportSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: parsed.error.issues[0]?.message || 'Invalid export request' });
    }
    const { content, kind, format } = parsed.data;
    const title = kind === 'cv' ? 'CV — AI Draft' : kind === 'cover_letter' ? 'Cover Letter — AI Draft' : 'Document — AI Draft';
    const buffer = format === 'pdf' ? await buildPdf(content, title) : await buildDocx(content, title);
    const filename = `${kind === 'cover_letter' ? 'Cover-Letter' : kind === 'cv' ? 'CV' : 'Document'}-AI-Draft.${format}`;
    res.set({
      'Content-Type': format === 'pdf'
        ? 'application/pdf'
        : 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Content-Length': String(buffer.length),
      'Cache-Control': 'private, no-store',
    });
    res.send(buffer);
  } catch (err) {
    next(err);
  }
});

export default router;
