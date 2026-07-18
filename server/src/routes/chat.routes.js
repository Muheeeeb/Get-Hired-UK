import { Router } from 'express';
import multer from 'multer';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { authenticate, authorizeRole } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { buildFileKey, saveFile } from '../lib/storage.js';
import { sendMail, brandedEmail } from '../lib/mailer.js';
import { env } from '../config/env.js';

const router = Router();
router.use(authenticate);

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const ok = /\.(pdf|doc|docx|txt|md|rtf|odt|png|jpe?g|webp)$/i.test(file.originalname);
    cb(ok ? null : new Error('Unsupported file type'), ok);
  },
});

/**
 * Access rules:
 *  - admin: every conversation (the Admin Lead audits all chats)
 *  - client: only their own conversations
 *  - employee: conversations assigned to them, or ones they created
 * Reply rules add one restriction: once a conversation is ASSIGNED to an
 * employee, only that employee and admins may reply.
 */
function canAccess(user, convo) {
  if (user.role === 'admin') return true;
  if (user.role === 'client') return convo.clientUserId === user.id;
  return convo.assignedEmployeeId === user.id || convo.createdById === user.id;
}

function canReply(user, convo) {
  if (!canAccess(user, convo)) return false;
  if (user.role === 'employee' && convo.assignedEmployeeId && convo.assignedEmployeeId !== user.id) {
    return false;
  }
  return true;
}

async function loadConversation(req, res, next) {
  const convo = await prisma.conversation.findUnique({ where: { id: req.params.id } });
  if (!convo) return res.status(404).json({ error: 'Conversation not found' });
  if (!canAccess(req.user, convo)) return res.status(403).json({ error: 'Forbidden' });
  req.conversation = convo;
  next();
}

// ---------- list ----------

router.get('/conversations', async (req, res, next) => {
  try {
    const { user } = req;
    const where =
      user.role === 'admin'
        ? {}
        : user.role === 'client'
          ? { clientUserId: user.id }
          : { OR: [{ assignedEmployeeId: user.id }, { createdById: user.id }] };

    const conversations = await prisma.conversation.findMany({
      where,
      orderBy: { lastMessageAt: 'desc' },
      take: 100,
      include: {
        createdBy: { select: { id: true, fullName: true, role: true } },
        clientUser: { select: { id: true, fullName: true } },
        assignedEmployee: { select: { id: true, fullName: true } },
        messages: { orderBy: { createdAt: 'desc' }, take: 1, select: { body: true, fileName: true, createdAt: true, senderId: true } },
      },
    });

    const reads = await prisma.conversationRead.findMany({
      where: { userId: user.id, conversationId: { in: conversations.map((c) => c.id) } },
    });
    const readMap = new Map(reads.map((r) => [r.conversationId, r.lastReadAt]));

    const withUnread = await Promise.all(
      conversations.map(async (c) => {
        const lastRead = readMap.get(c.id) || new Date(0);
        const unread = await prisma.message.count({
          where: { conversationId: c.id, createdAt: { gt: lastRead }, senderId: { not: user.id } },
        });
        return {
          id: c.id,
          subject: c.subject,
          status: c.status,
          createdBy: c.createdBy,
          clientUser: c.clientUser,
          assignedEmployee: c.assignedEmployee,
          lastMessageAt: c.lastMessageAt,
          lastMessage: c.messages[0] || null,
          unread,
          canReply: canReply(user, c),
        };
      })
    );

    res.json({ conversations: withUnread });
  } catch (err) {
    next(err);
  }
});

/** Total unread across conversations — powers the sidebar badge. */
router.get('/unread-count', async (req, res, next) => {
  try {
    const { user } = req;
    const where =
      user.role === 'admin'
        ? {}
        : user.role === 'client'
          ? { clientUserId: user.id }
          : { OR: [{ assignedEmployeeId: user.id }, { createdById: user.id }] };
    const convos = await prisma.conversation.findMany({ where, select: { id: true } });
    if (!convos.length) return res.json({ unread: 0 });
    const reads = await prisma.conversationRead.findMany({
      where: { userId: user.id, conversationId: { in: convos.map((c) => c.id) } },
    });
    const readMap = new Map(reads.map((r) => [r.conversationId, r.lastReadAt]));
    let unread = 0;
    for (const c of convos) {
      unread += await prisma.message.count({
        where: {
          conversationId: c.id,
          createdAt: { gt: readMap.get(c.id) || new Date(0) },
          senderId: { not: user.id },
        },
      });
    }
    res.json({ unread });
  } catch (err) {
    next(err);
  }
});

// ---------- create ----------

const createSchema = z.object({
  subject: z.string().min(2).max(200),
  message: z.string().min(1).max(5000),
  clientUserId: z.string().uuid().optional(),
});

router.post('/conversations', validate(createSchema), async (req, res, next) => {
  try {
    const { user } = req;
    let clientUserId = null;
    if (user.role === 'client') {
      clientUserId = user.id;
    } else if (req.body.clientUserId) {
      const client = await prisma.user.findFirst({
        where: { id: req.body.clientUserId, role: 'client', deletedAt: null },
      });
      if (!client) return res.status(400).json({ error: 'Client not found' });
      if (user.role === 'employee') {
        const profile = await prisma.clientProfile.findUnique({ where: { userId: client.id } });
        if (profile?.assignedEmployeeId !== user.id) {
          return res.status(403).json({ error: 'You can only start chats with your assigned clients' });
        }
      }
      clientUserId = client.id;
    }

    const convo = await prisma.conversation.create({
      data: {
        subject: req.body.subject,
        createdById: user.id,
        clientUserId,
        messages: { create: { senderId: user.id, body: req.body.message } },
      },
    });
    await prisma.conversationRead.upsert({
      where: { conversationId_userId: { conversationId: convo.id, userId: user.id } },
      create: { conversationId: convo.id, userId: user.id },
      update: { lastReadAt: new Date() },
    });

    // Client-initiated chats notify the office.
    if (user.role === 'client') {
      sendMail({
        to: env.officeEmail,
        subject: `New chat from ${user.fullName}: ${req.body.subject}`,
        html: brandedEmail({
          heading: 'New client message',
          bodyHtml: `<p><strong>${user.fullName}</strong> started a conversation:</p><p>“${String(req.body.message).replace(/</g, '&lt;')}”</p><p>Reply in the admin portal → Chat.</p>`,
        }),
        text: `${user.fullName}: ${req.body.message}`,
      }).catch(() => {});
    }

    res.status(201).json({ conversation: convo });
  } catch (err) {
    next(err);
  }
});

/** Client "Renew" button → opens (or reuses) a renewal conversation with the team. */
router.post('/renewal', authorizeRole(['client']), async (req, res, next) => {
  try {
    const { user } = req;
    let convo = await prisma.conversation.findFirst({
      where: { clientUserId: user.id, subject: 'Package renewal', status: 'open' },
    });
    if (!convo) {
      convo = await prisma.conversation.create({
        data: {
          subject: 'Package renewal',
          createdById: user.id,
          clientUserId: user.id,
          messages: {
            create: {
              senderId: user.id,
              body: "Hi — I'd like to discuss renewing my package.",
            },
          },
        },
      });
      sendMail({
        to: env.officeEmail,
        subject: `Renewal request — ${user.fullName}`,
        html: brandedEmail({
          heading: 'Renewal request',
          bodyHtml: `<p><strong>${user.fullName}</strong> clicked Renew and wants to discuss their package. Reply in the admin portal → Chat.</p>`,
        }),
        text: `Renewal request from ${user.fullName}`,
      }).catch(() => {});
    }
    res.status(201).json({ conversation: convo });
  } catch (err) {
    next(err);
  }
});

// ---------- thread ----------

router.get('/conversations/:id', loadConversation, async (req, res, next) => {
  try {
    const messages = await prisma.message.findMany({
      where: { conversationId: req.conversation.id },
      orderBy: { createdAt: 'asc' },
      take: 500,
      include: { sender: { select: { id: true, fullName: true, role: true } } },
    });
    await prisma.conversationRead.upsert({
      where: { conversationId_userId: { conversationId: req.conversation.id, userId: req.user.id } },
      create: { conversationId: req.conversation.id, userId: req.user.id },
      update: { lastReadAt: new Date() },
    });
    const convo = await prisma.conversation.findUnique({
      where: { id: req.conversation.id },
      include: {
        createdBy: { select: { id: true, fullName: true, role: true } },
        clientUser: { select: { id: true, fullName: true } },
        assignedEmployee: { select: { id: true, fullName: true } },
      },
    });
    res.json({
      conversation: { ...convo, canReply: canReply(req.user, req.conversation) },
      messages: messages.map((m) => ({
        id: m.id,
        body: m.body,
        fileName: m.fileName,
        hasFile: Boolean(m.fileKey),
        createdAt: m.createdAt,
        sender: m.sender,
        mine: m.senderId === req.user.id,
      })),
    });
  } catch (err) {
    next(err);
  }
});

router.post('/conversations/:id/messages', loadConversation, upload.single('file'), async (req, res, next) => {
  try {
    if (!canReply(req.user, req.conversation)) {
      return res.status(403).json({ error: 'This conversation is assigned to someone else' });
    }
    const body = (req.body.body || '').trim();
    if (!body && !req.file) return res.status(400).json({ error: 'Message or file required' });
    if (body.length > 5000) return res.status(400).json({ error: 'Message too long' });

    let fileKey = null;
    let fileName = null;
    if (req.file) {
      fileKey = buildFileKey(`chat/${req.conversation.id}`, req.file.originalname);
      await saveFile(fileKey, req.file.buffer, req.file.mimetype);
      fileName = req.file.originalname;
    }

    const message = await prisma.message.create({
      data: {
        conversationId: req.conversation.id,
        senderId: req.user.id,
        body: body || null,
        fileKey,
        fileName,
      },
    });
    await prisma.conversation.update({
      where: { id: req.conversation.id },
      data: { lastMessageAt: new Date(), status: 'open' },
    });
    await prisma.conversationRead.upsert({
      where: { conversationId_userId: { conversationId: req.conversation.id, userId: req.user.id } },
      create: { conversationId: req.conversation.id, userId: req.user.id },
      update: { lastReadAt: new Date() },
    });

    res.status(201).json({ message: { id: message.id, createdAt: message.createdAt } });
  } catch (err) {
    next(err);
  }
});

/** Assign to an employee (admins). Once assigned, only assignee + admins reply. */
router.put(
  '/conversations/:id/assign',
  authorizeRole(['admin']),
  loadConversation,
  validate(z.object({ employeeId: z.string().uuid().nullable() })),
  async (req, res, next) => {
    try {
      if (req.body.employeeId) {
        const emp = await prisma.user.findFirst({
          where: { id: req.body.employeeId, role: 'employee', isActive: true, deletedAt: null },
        });
        if (!emp) return res.status(400).json({ error: 'Employee not found or inactive' });
      }
      const updated = await prisma.conversation.update({
        where: { id: req.conversation.id },
        data: { assignedEmployeeId: req.body.employeeId },
        include: { assignedEmployee: { select: { id: true, fullName: true } } },
      });
      res.json({ conversation: updated });
    } catch (err) {
      next(err);
    }
  }
);

router.put('/conversations/:id/status', authorizeRole(['admin']), loadConversation,
  validate(z.object({ status: z.enum(['open', 'closed']) })),
  async (req, res, next) => {
    try {
      await prisma.conversation.update({
        where: { id: req.conversation.id },
        data: { status: req.body.status },
      });
      res.json({ ok: true });
    } catch (err) {
      next(err);
    }
  }
);

export default router;
