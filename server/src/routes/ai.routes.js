import { Router } from 'express';
import crypto from 'node:crypto';
import path from 'node:path';
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
 * Raw PDF bytes replayed from earlier turns. Deliberately a FIXED budget rather
 * than "whatever the current turn leaves spare": if it depended on the size of
 * this turn's upload, an older message would change shape from one request to
 * the next, and prompt caching is a prefix match — the cache would go cold at
 * the first changed message. Combined with the per-turn upload cap in ai.js
 * (10 MB) this keeps a request under ~24 MB encoded, inside the 32 MB limit.
 */
export const MAX_HISTORY_PDF_BYTES = 8 * 1024 * 1024;

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
/** Where this user's own AI Studio uploads live. Nothing else is readable. */
export function aiRefPrefix(userId) {
  return `ai-refs/${userId}/`;
}

/**
 * Re-attaching a file means the server reads it off storage, so the key must
 * never come from the caller: `refs` are stripped from browser-supplied history
 * (see `/generate`) and, belt and braces, only keys under this user's own
 * AI Studio folder are ever opened. Without both checks a specialist could put
 * any storage key in `history` and have the server hand them a client's
 * documents that the file routes would have refused them.
 */
function ownedRefKey(ref, userId) {
  if (typeof ref.key !== 'string' || !ref.key) return null;
  // Normalise FIRST. `ai-refs/<me>/../../masters/<someone-else>/cv.pdf` starts
  // with the right prefix but walks straight out of it, and the local driver
  // normalises before its own containment check — so a bare `startsWith` is not
  // a boundary. Compare the resolved path instead.
  const normalised = path.posix.normalize(ref.key);
  if (normalised.startsWith('..') || normalised.startsWith('/')) return null;
  return normalised.startsWith(aiRefPrefix(userId)) ? normalised : null;
}

export async function hydrateHistory(history, userId, { maxPdfBytes = MAX_HISTORY_PDF_BYTES } = {}) {
  // Oldest turns claim the budget first, on purpose. The usual shape of a chat
  // is one CV attached at the start followed by many job descriptions, so the
  // earliest attachment is the one every later draft depends on — and keeping
  // the front of the conversation stable is also what keeps the cached prefix
  // valid. Newest-first would drop that CV as soon as the budget filled and
  // change message 0 from under the cache.
  let budget = maxPdfBytes;
  const degraded = [];
  const hydrated = [];
  for (const message of history) {
    const refs = messageRefs(message);
    if (!refs.length) {
      // Block form, not a bare string: a fresh turn is sent as blocks, so
      // replaying it as a string would change the bytes of the cached prefix.
      hydrated.push({ role: message.role, content: [{ type: 'text', text: message.content }] });
      continue;
    }

    const blocks = [];
    for (const ref of refs) {
      const key = ownedRefKey(ref, userId);
      const isPdf = String(ref.name || '').toLowerCase().endsWith('.pdf');
      let overBudget = false;

      let unavailable = false;
      if (isPdf && key) {
        const buffer = budget > 0 ? await readFileBuffer(key).catch(() => null) : null;
        if (buffer && buffer.length <= budget) {
          budget -= buffer.length;
          blocks.push({
            type: 'document',
            source: { type: 'base64', media_type: 'application/pdf', data: buffer.toString('base64') },
            title: ref.name,
          });
          continue;
        }
        if (budget <= 0 || buffer) {
          // The file is legitimately this chat's, it just no longer fits.
          overBudget = true;
        } else {
          // The record points at a file that is no longer in storage. Never let
          // that pass silently: a later draft written without the CV, with no
          // explanation, is the exact failure re-attachment exists to prevent.
          unavailable = true;
          console.warn(`[ai] reference file missing from storage: ${key}`);
        }
      }

      if (ref.text) {
        // Not a PDF, no stored file (a pre-upgrade conversation), or out of
        // budget: the extracted text is all those turns ever had anyway.
        blocks.push({ type: 'text', text: `<document name="${ref.name || 'document'}">\n${ref.text}\n</document>` });
      } else if (overBudget || unavailable) {
        // A scanned PDF with nothing extractable, pushed out by the budget or no
        // longer in storage. Say so in the conversation rather than letting it
        // disappear without a word.
        degraded.push(ref.name);
        blocks.push({
          type: 'text',
          text: `<document name="${ref.name || 'document'}">(This attachment is no longer included${
            overBudget ? ' — the conversation has too many attached files' : ''
          }. Re-upload it if it is still needed.)</document>`,
        });
      }
      // A non-owned key contributes nothing at all: it was never legitimately
      // part of this conversation.
    }
    blocks.push({ type: 'text', text: message.content });
    hydrated.push({ role: message.role, content: blocks });
  }
  hydrated.degraded = degraded;
  return hydrated;
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

function conversationPayload(conversation, savedMasterPrompt = '') {
  const kind = normaliseKind(conversation.kind);
  return {
    id: conversation.id,
    kind,
    model: conversation.model || '',
    // What the NEXT turn will actually do, not merely what was snapshotted.
    // A chat with no snapshot yet (started before this feature existed) still
    // picks up the saved prompt, and a freeform chat runs none whatever the
    // column holds — the banner has to say the same thing the server does.
    hasMasterPrompt: kind === 'cv_cover_letter'
      && Boolean(conversation.systemPrompt || savedMasterPrompt),
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
    const [conversations, savedMasterPrompt] = await Promise.all([
      prisma.aiStudioConversation.findMany({
        where: { userId: req.user.id },
        orderBy: { updatedAt: 'desc' },
        take: 5,
      }),
      getMasterPrompt(),
    ]);
    res.json({
      conversations: conversations.reverse().map((c) => conversationPayload(c, savedMasterPrompt)),
    });
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
          // A brand-new chat's history comes from the browser, so it is untrusted:
          // drop any attachment references it claims. Only turns the server wrote
          // may name a stored file.
          : parseConversationHistory(parsed.data.history).map(({ refs, ...turn }) => turn);
      } catch {
        return res.status(400).json({ error: 'Invalid conversation history' });
      }
      // PDFs go to Claude as native document blocks; Word and text files are
      // extracted. Both are kept so follow-ups still see the attachment.
      const uploaded = [...(req.files?.files || []), ...(req.files?.file || [])];
      let extracted;
      try {
        extracted = await extractReferenceAttachments(uploaded);
      } catch (err) {
        return res.status(err.status || 400).json({ error: err.publicMessage || 'A reference file could not be read' });
      }

      history = await hydrateHistory(history, req.user.id);
      const degradedRefs = history.degraded || [];

      const result = await generateDocument({
        prompt,
        masterPrompt,
        attachments: extracted.attachments,
        history,
        model,
      });

      // Keep a copy of every reference so later turns in this chat still have the
      // document itself, not just whatever a text extractor could pull out of it.
      // Use the buffer carried on the attachment itself. Indexing back into
      // `uploaded` was wrong: extraction skips a non-PDF once the character
      // budget is spent, so the two arrays diverge and a file could be stored
      // under another file's name.
      const storedRefs = await Promise.all(extracted.attachments.map(async (file) => {
        let key = null;
        if (file.pdf) {
          try {
            key = buildFileKey(aiRefPrefix(req.user.id).slice(0, -1), file.name);
            await saveFile(key, file.pdf, 'application/pdf');
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
      if (degradedRefs.length) {
        noteParts.push(`${degradedRefs.join(', ')} could no longer be included — this chat has too many attached files. Start a new chat, or re-upload what is still needed.`);
      }
      const note = noteParts.join(' ') || undefined;

      const assistantMessage = {
        id: crypto.randomUUID(), role: 'assistant', content: result.draft,
        ...(note ? { note } : {}),
      };
      const previousMessages = savedConversation ? normalizeSavedMessages(savedConversation.messages) : [];
      const messages = normalizeSavedMessages([...previousMessages, userMessage, assistantMessage]);

      // Turns trimmed out of the saved window take their stored files with them,
      // otherwise every long chat leaks blobs that nothing can ever reference.
      // Deleted after the write below, never before — a failed save must not
      // leave the surviving record pointing at files that are already gone.
      const droppedKeys = previousMessages
        .flatMap((m) => messageRefs(m))
        .map((ref) => ref.key)
        .filter(Boolean);
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
      // Delete only what the PERSISTED record no longer mentions. Deriving this
      // from the row we just wrote — rather than from what we intended to write —
      // means a lost update or a retry can never strip a file that a surviving
      // message still points at, which would make the attachment vanish from the
      // chat exactly as an unreadable file does.
      const survivingKeys = new Set(
        normalizeSavedMessages(saved.messages)
          .flatMap((m) => messageRefs(m))
          .map((ref) => ref.key)
          .filter(Boolean)
      );
      await Promise.all(
        droppedKeys.filter((key) => !survivingKeys.has(key)).map((key) => deleteFile(key))
      );

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
