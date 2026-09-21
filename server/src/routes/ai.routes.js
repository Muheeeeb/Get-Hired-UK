import { Router } from 'express';
import crypto from 'node:crypto';
import multer from 'multer';
import { z } from 'zod';
import rateLimit from 'express-rate-limit';
import { prisma } from '../lib/prisma.js';
import { authenticate, authorizeRole } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { defaultClaudeModel, draftCoverLetter, generateDocument, listClaudeModels } from '../lib/ai.js';
import { buildFileKey, deleteFile, readFileBuffer, saveFile, tryReadFileText } from '../lib/storage.js';
import { env } from '../config/env.js';
import { resolveClaudeModel } from '../lib/aiAccess.js';
import { getMasterPrompt } from '../lib/settings.js';
import { extractReferenceAttachments, SUPPORTED_DOCUMENT_EXTENSIONS } from '../lib/documentText.js';
import { buildDocx, buildPdf } from '../lib/documentExport.js';

const router = Router();

// The studio is conversational — a specialist iterating on a draft sends several
// turns a minute, so this is higher than a one-shot generator would need.
const aiLimiter = rateLimit({ windowMs: 60 * 1000, limit: 30, legacyHeaders: false });
export const MAX_AI_PROMPT_CHARS = 50_000;
export const MAX_AI_HISTORY_JSON_CHARS = 800_000;
const MAX_HISTORY_MESSAGE_CHARS = 60_000;
const MAX_HISTORY_CONTEXT_CHARS = 240_000;
export const MAX_SAVED_AI_MESSAGES = 60;
const MAX_SAVED_AI_CHARS = 900_000;

/**
 * The two document modes the studio offers.
 * `cv_cover_letter` replaces the old split CV / cover-letter options: one chat
 * returns both documents for each job description, driven by the admin's saved
 * master prompt. Legacy rows still carry `cv` / `cover_letter` and are folded in.
 */
export const AI_KINDS = ['cv_cover_letter', 'freeform'];
export function normaliseKind(kind) {
  if (kind === 'cv' || kind === 'cover_letter' || kind === 'cv_cover_letter') return 'cv_cover_letter';
  return 'freeform';
}

const refUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024, files: 6 },
  fileFilter(req, file, cb) {
    const lower = file.originalname.toLowerCase();
    const supported = SUPPORTED_DOCUMENT_EXTENSIONS.some((ext) => lower.endsWith(ext));
    cb(supported ? null : new Error('Unsupported file type. Allowed: pdf, doc, docx, txt, md'), supported);
  },
});

/** Saved references travel with the turn that uploaded them, never rendered to the user. */
function messageRefs(message) {
  return Array.isArray(message?.refs) ? message.refs.filter(Boolean) : [];
}

/**
 * Rebuild a stored turn as the exact content blocks it was originally sent as.
 *
 * This matters twice over. A PDF attached on turn 1 has to come back as a native
 * `document` block on turn 2, or a scanned CV (no extractable text) silently
 * vanishes from the conversation and every later draft is written without it.
 * And because prompt caching is a prefix match, a turn that is re-rendered in a
 * different shape than it was sent invalidates the cache from that point on —
 * so replaying it identically is what keeps the 1-hour cache actually hitting.
 */
export async function hydrateHistory(history) {
  return Promise.all(history.map(async (message) => {
    const refs = messageRefs(message);
    if (!refs.length) return { role: message.role, content: message.content };

    const blocks = [];
    for (const ref of refs) {
      const isPdf = String(ref.name || '').toLowerCase().endsWith('.pdf');
      if (isPdf && ref.key) {
        const buffer = await readFileBuffer(ref.key).catch(() => null);
        if (buffer) {
          blocks.push({
            type: 'document',
            source: { type: 'base64', media_type: 'application/pdf', data: buffer.toString('base64') },
            title: ref.name,
          });
          continue;
        }
      }
      // No stored file (a pre-upgrade conversation) or not a PDF: fall back to
      // the extracted text, which is all those turns ever had.
      if (ref.text) {
        blocks.push({ type: 'text', text: `<document name="${ref.name || 'document'}">\n${ref.text}\n</document>` });
      }
    }
    blocks.push({ type: 'text', text: message.content });
    return { role: message.role, content: blocks };
  }));
}

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
    const refs = messageRefs(message);
    const refChars = refs.reduce((sum, ref) => sum + (ref.text?.length || 0), 0);
    const content = message.content.slice(0, Math.min(MAX_HISTORY_MESSAGE_CHARS, MAX_HISTORY_CONTEXT_CHARS - used));
    if (!content) continue;
    kept.push({ role: message.role, content, ...(refs.length ? { refs } : {}) });
    used += content.length + refChars;
  }
  return kept.reverse();
}

/** Keep persisted turns safe, bounded and compatible with older stored JSON. */
export function normalizeSavedMessages(raw) {
  if (!Array.isArray(raw)) return [];
  const newestFirst = raw
    .filter((message) => message && (message.role === 'user' || message.role === 'assistant') && typeof message.content === 'string')
    .slice(-MAX_SAVED_AI_MESSAGES)
    .reverse();
  const kept = [];
  let used = 0;
  for (const message of newestFirst) {
    if (used >= MAX_SAVED_AI_CHARS) break;
    const content = message.content.slice(0, MAX_SAVED_AI_CHARS - used);
    if (!content) continue;
    const refs = Array.isArray(message.refs)
      ? message.refs
          .filter((ref) => ref && typeof ref.text === 'string')
          .slice(0, 6)
          .map((ref) => ({
            name: String(ref.name || 'document').slice(0, 255),
            text: ref.text,
            // The stored copy of the file, so a PDF can be re-attached natively
            // on later turns instead of degrading to extracted text.
            ...(typeof ref.key === 'string' && ref.key ? { key: ref.key } : {}),
          }))
      : [];
    kept.push({
      id: typeof message.id === 'string' ? message.id : crypto.randomUUID(),
      role: message.role,
      content,
      ...(typeof message.note === 'string' && message.note ? { note: message.note.slice(0, 2_000) } : {}),
      ...(Array.isArray(message.files) ? {
        files: message.files.filter((name) => typeof name === 'string').slice(0, 6).map((name) => name.slice(0, 255)),
      } : {}),
      ...(refs.length ? { refs } : {}),
    });
    // Attachment text counts against the same budget — a 100k-character CV is
    // still 100k characters whether it was typed or uploaded.
    used += content.length + refs.reduce((sum, ref) => sum + ref.text.length, 0);
  }
  return kept.reverse();
}

/** Strip the hidden attachment text; the browser only needs the visible turn. */
function publicMessages(messages) {
  return messages.map(({ refs, ...message }) => message);
}

function conversationPayload(conversation) {
  return {
    id: conversation.id,
    kind: normaliseKind(conversation.kind),
    model: conversation.model || '',
    hasMasterPrompt: Boolean(conversation.systemPrompt),
    messages: publicMessages(normalizeSavedMessages(conversation.messages)),
    createdAt: conversation.createdAt,
    updatedAt: conversation.updatedAt,
  };
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

/** Saved AI Studio tabs are private to the signed-in admin/employee. */
router.get('/conversations', authenticate, authorizeRole(['admin', 'employee']), async (req, res, next) => {
  try {
    const conversations = await prisma.aiStudioConversation.findMany({
      where: { userId: req.user.id },
      orderBy: { updatedAt: 'desc' },
      take: 5,
    });
    res.json({ conversations: conversations.reverse().map(conversationPayload) });
  } catch (err) {
    next(err);
  }
});

router.delete('/conversations/:id', authenticate, authorizeRole(['admin', 'employee']), async (req, res, next) => {
  try {
    const existing = await prisma.aiStudioConversation.findFirst({
      where: { id: req.params.id, userId: req.user.id },
    });
    if (!existing) return res.status(404).json({ error: 'AI conversation not found' });
    await prisma.aiStudioConversation.delete({ where: { id: existing.id } });
    // Closing a chat takes its stored reference files with it.
    const keys = normalizeSavedMessages(existing.messages)
      .flatMap((message) => messageRefs(message))
      .map((ref) => ref.key)
      .filter(Boolean);
    await Promise.all(keys.map((key) => deleteFile(key)));
    res.status(204).end();
  } catch (err) {
    next(err);
  }
});

/** Available Claude models; employees only receive their admin-approved model. */
router.get('/models', authenticate, authorizeRole(['admin', 'employee']), async (req, res, next) => {
  try {
    const effectiveModel = req.user.aiModel || await defaultClaudeModel();
    const masterPromptReady = Boolean(await getMasterPrompt());
    if (req.user.role === 'employee') {
      return res.json({
        models: [{ id: effectiveModel, name: effectiveModel }],
        selectedModel: effectiveModel,
        canChoose: false,
        configured: Boolean(env.anthropicApiKey),
        masterPromptReady,
      });
    }
    const models = await listClaudeModels();
    res.json({
      models, selectedModel: effectiveModel, canChoose: true,
      configured: Boolean(env.anthropicApiKey), masterPromptReady,
    });
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
 * AI Studio: one conversational turn.
 *
 * "CV & Cover Letter" chats carry the admin's master prompt. It is snapshotted
 * onto the conversation the first time the chat is used, sent as the cached
 * system prompt on every request, and never shown to or typed by the user — so
 * the specialist just pastes job descriptions one after another and each reply
 * costs only what that job description adds.
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
        kind: z.enum(['cv_cover_letter', 'freeform', 'cv', 'cover_letter']).default('freeform'),
        prompt: z.string().min(1).max(MAX_AI_PROMPT_CHARS),
        // Prior turns, JSON-encoded (multipart carries strings only).
        history: z.string().max(MAX_AI_HISTORY_JSON_CHARS).optional().or(z.literal('')),
        model: z.string().regex(/^claude-[a-zA-Z0-9._-]+$/).max(200).optional().or(z.literal('')),
        conversationId: z.string().uuid().optional().or(z.literal('')),
      });
      const parsed = schema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ error: parsed.error.issues[0]?.message || 'Invalid request' });
      }
      const { prompt, conversationId } = parsed.data;
      const kind = normaliseKind(parsed.data.kind);
      const model = await selectedModel(req, parsed.data.model || undefined);

      let savedConversation = null;
      if (conversationId) {
        savedConversation = await prisma.aiStudioConversation.findFirst({
          where: { id: conversationId, userId: req.user.id },
        });
        if (!savedConversation) return res.status(404).json({ error: 'AI conversation not found' });
      } else {
        const savedCount = await prisma.aiStudioConversation.count({ where: { userId: req.user.id } });
        if (savedCount >= 5) {
          return res.status(409).json({ error: 'You can keep up to five AI conversations. Close one before starting another.' });
        }
      }

      // The master prompt is frozen per chat: a mid-chat edit to the setting must
      // not rewrite an open conversation, and a byte-stable prefix is what keeps
      // the hour-long cache valid across job descriptions.
      //
      // It is bound to the CURRENT mode rather than the first turn's, so a chat
      // that has no snapshot yet (a freeform chat switched to CV & Cover Letter,
      // or one started before this feature existed) picks one up instead of
      // quietly running without it, and a chat switched to freeform stops using it.
      const masterPrompt = kind === 'cv_cover_letter'
        ? (savedConversation?.systemPrompt || await getMasterPrompt())
        : '';

      // Keep only well-formed turns, and only the recent ones so the prompt
      // cannot grow without bound over a long conversation.
      let history = [];
      try {
        history = savedConversation
          ? parseConversationHistory(JSON.stringify(normalizeSavedMessages(savedConversation.messages)))
          : parseConversationHistory(parsed.data.history);
      } catch {
        return res.status(400).json({ error: 'Invalid conversation history' });
      }
      // Re-attach stored PDFs so earlier turns are replayed exactly as they were sent.
      history = await hydrateHistory(history);

      // PDFs go to Claude as native document blocks; Word and text files are
      // extracted. Both are kept so follow-ups still see the attachment.
      const uploaded = [...(req.files?.files || []), ...(req.files?.file || [])];
      let extracted;
      try {
        extracted = await extractReferenceAttachments(uploaded);
      } catch (err) {
        return res.status(err.status || 400).json({ error: err.publicMessage || 'A reference file could not be read' });
      }

      const result = await generateDocument({
        prompt,
        masterPrompt,
        attachments: extracted.attachments,
        history,
        model,
      });

      // Keep a copy of every reference so later turns in this chat still have the
      // document itself, not just whatever a text extractor could pull out of it.
      const storedRefs = await Promise.all(extracted.attachments.map(async (file, index) => {
        const source = uploaded[index];
        let key = null;
        if (source?.buffer) {
          try {
            key = buildFileKey(`ai-refs/${req.user.id}`, file.name);
            await saveFile(key, source.buffer, source.mimetype);
          } catch (err) {
            // Storage is not worth failing the generation over — the turn still
            // went to Claude with the document attached.
            console.error('[ai] could not store reference file:', err.message);
            key = null;
          }
        }
        return { name: file.name, text: file.text || '', ...(key ? { key } : {}) };
      }));

      const userMessage = {
        id: crypto.randomUUID(), role: 'user', content: prompt,
        files: uploaded.map((file) => file.originalname).slice(0, 6),
        ...(storedRefs.length ? { refs: storedRefs } : {}),
      };
      // One honest sentence about the attachments, covering both trimmed and
      // unusable files, so a dropped reference is never invisible.
      const skipped = result.skippedFiles || [];
      const usedCount = extracted.usedFiles.length - skipped.length;
      const noteParts = [];
      if (extracted.truncatedFiles.length) {
        noteParts.push(`Read ${usedCount} file${usedCount === 1 ? '' : 's'}; very long content was trimmed to fit the AI context.`);
      }
      if (skipped.length) {
        noteParts.push(`Could not read ${skipped.join(', ')} — too large to send and no extractable text (a scanned PDF needs OCR first).`);
      }
      const note = noteParts.join(' ') || undefined;

      const assistantMessage = {
        id: crypto.randomUUID(), role: 'assistant', content: result.draft,
        ...(note ? { note } : {}),
      };
      const messages = normalizeSavedMessages([
        ...(savedConversation ? normalizeSavedMessages(savedConversation.messages) : []),
        userMessage,
        assistantMessage,
      ]);
      const saved = savedConversation
        ? await prisma.aiStudioConversation.update({
            where: { id: savedConversation.id },
            data: {
              kind, model, messages,
              // Record the snapshot the first time this chat actually uses one.
              ...(masterPrompt && !savedConversation.systemPrompt ? { systemPrompt: masterPrompt } : {}),
            },
          })
        : await prisma.aiStudioConversation.create({
            data: { userId: req.user.id, kind, model, messages, systemPrompt: masterPrompt || null },
          });
      res.json({
        draft: result.draft,
        source: result.source,
        model: result.model,
        conversationId: saved.id,
        hasMasterPrompt: Boolean(masterPrompt),
        messages: publicMessages(messages),
        usedFiles: extracted.usedFiles.filter((name) => !skipped.includes(name)),
        skippedFiles: skipped,
        note,
      });
    } catch (err) {
      next(err);
    }
  }
);

const exportSchema = z.object({
  content: z.string().min(1).max(250_000),
  kind: z.enum(['cv_cover_letter', 'freeform', 'cv', 'cover_letter']).default('freeform'),
  format: z.enum(['pdf', 'docx']),
});

/** Create a formatted, authenticated PDF or Word download from an AI draft. */
router.post('/export', authenticate, authorizeRole(['admin', 'employee']), aiLimiter, async (req, res, next) => {
  try {
    const parsed = exportSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: parsed.error.issues[0]?.message || 'Invalid export request' });
    }
    const { content, format } = parsed.data;
    const kind = normaliseKind(parsed.data.kind);
    const title = kind === 'cv_cover_letter' ? 'CV & Cover Letter — AI Draft' : 'Document — AI Draft';
    const buffer = format === 'pdf' ? await buildPdf(content, title) : await buildDocx(content, title);
    const filename = `${kind === 'cv_cover_letter' ? 'CV-and-Cover-Letter' : 'Document'}-AI-Draft.${format}`;
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
