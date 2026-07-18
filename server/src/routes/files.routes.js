import { Router } from 'express';
import { prisma } from '../lib/prisma.js';
import { authenticate } from '../middleware/auth.js';
import {
  getSignedFileUrl,
  verifyLocalSignature,
  resolveLocalPath,
  inlineContentType,
} from '../lib/storage.js';

// "View" opens PDFs/images/text inline in the browser; other types download.
const wantInline = (fileName) => Boolean(inlineContentType(fileName));

const router = Router();

/**
 * GET /files/:docId/signed-url
 *
 * THE PRIVACY RULE lives here. Resolution order: master doc → tailored doc →
 * interview resource. For every kind we check role + row-level scope BEFORE
 * issuing any URL. A client requesting a tailored document gets 403 — always,
 * even with a valid, guessed document id.
 */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

router.get('/:docId/signed-url', authenticate, async (req, res, next) => {
  try {
    const { docId } = req.params;
    const { user } = req;
    if (!UUID_RE.test(docId)) return res.status(404).json({ error: 'Document not found' });

    // 1. Master documents — visible to admin, assigned employee, and the client themself.
    const master = await prisma.masterDocument.findUnique({
      where: { id: docId },
      include: { domain: { include: { client: true } } },
    });
    if (master) {
      const c = master.domain.client;
      const allowed =
        user.role === 'admin' ||
        (user.role === 'employee' && c.assignedEmployeeId === user.id) ||
        (user.role === 'client' && c.userId === user.id);
      if (!allowed) return res.status(403).json({ error: 'Forbidden' });
      const url = await getSignedFileUrl(master.fileKey, master.fileName, { inline: wantInline(master.fileName) });
      return res.json({ url, fileName: master.fileName, kind: 'master' });
    }

    // 2. Tailored documents — HARD BLOCK for clients, no exceptions.
    const tailored = await prisma.tailoredDocument.findUnique({
      where: { id: docId },
      include: { jobApplication: { include: { client: true } } },
    });
    if (tailored) {
      if (user.role === 'client') {
        // 403 immediately; no URL is ever issued to a client token for tailored docs.
        return res.status(403).json({ error: 'Forbidden' });
      }
      const c = tailored.jobApplication.client;
      const allowed =
        user.role === 'admin' ||
        (user.role === 'employee' && c.assignedEmployeeId === user.id);
      if (!allowed) return res.status(403).json({ error: 'Forbidden' });
      const url = await getSignedFileUrl(tailored.fileKey, tailored.fileName, { inline: wantInline(tailored.fileName) });
      return res.json({ url, fileName: tailored.fileName, kind: 'tailored' });
    }

    // 3. Interview resources — visible to any authenticated role.
    const resource = await prisma.interviewResource.findUnique({ where: { id: docId } });
    if (resource && resource.fileKey) {
      const fileName = resource.fileName || resource.title;
      const url = await getSignedFileUrl(resource.fileKey, fileName, { inline: wantInline(fileName) });
      return res.json({ url, fileName, kind: 'resource' });
    }

    // 4. Chat attachments — same access rules as the conversation itself.
    const message = await prisma.message.findUnique({
      where: { id: docId },
      include: { conversation: true },
    });
    if (message && message.fileKey) {
      const convo = message.conversation;
      const allowed =
        user.role === 'admin' ||
        (user.role === 'client' && convo.clientUserId === user.id) ||
        (user.role === 'employee' &&
          (convo.assignedEmployeeId === user.id || convo.createdById === user.id));
      if (!allowed) return res.status(403).json({ error: 'Forbidden' });
      const url = await getSignedFileUrl(message.fileKey, message.fileName, { inline: wantInline(message.fileName) });
      return res.json({ url, fileName: message.fileName, kind: 'chat' });
    }

    // 5. Interview-prep session materials — admin, the client, or the involved employee.
    const session = await prisma.interviewSession.findUnique({
      where: { id: docId },
      include: { client: true },
    });
    if (session && session.fileKey) {
      const allowed =
        user.role === 'admin' ||
        (user.role === 'client' && session.client.userId === user.id) ||
        (user.role === 'employee' &&
          (session.assignedEmployeeId === user.id || session.client.assignedEmployeeId === user.id));
      if (!allowed) return res.status(403).json({ error: 'Forbidden' });
      const url = await getSignedFileUrl(session.fileKey, session.fileName, { inline: wantInline(session.fileName) });
      return res.json({ url, fileName: session.fileName, kind: 'session' });
    }

    return res.status(404).json({ error: 'Document not found' });
  } catch (err) {
    next(err);
  }
});

/**
 * Local-driver file delivery. The URL itself carries an HMAC signature with a
 * short expiry (issued only after the role checks above), mirroring S3
 * presigned URL semantics.
 */
router.get('/local/:key', async (req, res) => {
  // Express has already percent-decoded the param once — do not decode again.
  const key = req.params.key;
  const { expires, sig, name, inline } = req.query;
  // The display name is part of the HMAC payload, so it can't be tampered with.
  if (!verifyLocalSignature(key, expires, sig, name || '')) {
    return res.status(403).json({ error: 'Invalid or expired file URL' });
  }
  const filePath = resolveLocalPath(key);
  if (!filePath) return res.status(400).json({ error: 'Invalid file key' });
  const downloadName = name || key.split('/').pop().replace(/^[0-9a-f]{16}-/, '');

  // "View": render inline in the browser when the type supports it (PDF, images, text).
  const contentType = inline ? inlineContentType(downloadName) : null;
  if (contentType) {
    res.setHeader('Content-Type', contentType);
    res.setHeader(
      'Content-Disposition',
      `inline; filename="${downloadName.replace(/["\\\r\n]/g, '_')}"`
    );
    return res.sendFile(filePath, (err) => {
      if (err && !res.headersSent) res.status(404).json({ error: 'File not found' });
    });
  }

  res.download(filePath, downloadName, (err) => {
    if (err && !res.headersSent) res.status(404).json({ error: 'File not found' });
  });
});

export default router;
