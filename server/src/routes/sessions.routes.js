import { Router } from 'express';
import multer from 'multer';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { authenticate, authorizeRole } from '../middleware/auth.js';
import { buildFileKey, saveFile, deleteFile } from '../lib/storage.js';
import { sendMail, brandedEmail } from '../lib/mailer.js';
import { env } from '../config/env.js';

const router = Router();
router.use(authenticate);

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
});

const createSchema = z.object({
  clientId: z.string().uuid(),
  title: z.string().min(2).max(200),
  scheduledAt: z.string().datetime({ offset: true }).or(z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/)),
  joinLink: z.string().url().max(2000).optional().or(z.literal('')),
  notes: z.string().max(4000).optional().or(z.literal('')),
  assignedEmployeeId: z.string().uuid().optional().or(z.literal('')),
});

/** Schedule an interview-prep session (admin). */
router.post('/', authorizeRole(['admin']), upload.single('file'), async (req, res, next) => {
  try {
    const parsed = createSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({
        error: parsed.error.issues[0]?.message || 'Invalid session details',
      });
    }
    const { clientId, title, scheduledAt, joinLink, notes, assignedEmployeeId } = parsed.data;

    const client = await prisma.clientProfile.findUnique({
      where: { id: clientId },
      include: { user: { select: { fullName: true, email: true } } },
    });
    if (!client) return res.status(404).json({ error: 'Client not found' });

    let fileKey = null;
    let fileName = null;
    if (req.file) {
      fileKey = buildFileKey(`sessions/${clientId}`, req.file.originalname);
      await saveFile(fileKey, req.file.buffer, req.file.mimetype);
      fileName = req.file.originalname;
    }

    const session = await prisma.interviewSession.create({
      data: {
        clientId,
        title,
        scheduledAt: new Date(scheduledAt),
        joinLink: joinLink || null,
        notes: notes || null,
        assignedEmployeeId: assignedEmployeeId || null,
        fileKey,
        fileName,
        createdById: req.user.id,
      },
    });

    // Tell the client their session is booked.
    sendMail({
      to: client.user.email,
      subject: `Interview prep session scheduled — ${title}`,
      html: brandedEmail({
        heading: 'Session scheduled',
        bodyHtml: `<p>Hi ${client.user.fullName.split(' ')[0]},</p>
          <p>An interview preparation session has been scheduled for you:</p>
          <p style="background:#F7F6F2;border-radius:10px;padding:12px 16px;">
            <strong>${title}</strong><br />
            ${new Date(scheduledAt).toLocaleString('en-GB', { timeZone: 'Europe/London', dateStyle: 'full', timeStyle: 'short' })}
            ${joinLink ? `<br /><a href="${joinLink}">Join link</a>` : ''}
          </p>
          <p>Details and any prep materials are on your dashboard.</p>`,
        ctaLabel: 'Open my dashboard',
        ctaUrl: env.primaryClientOrigin,
      }),
      text: `Interview prep session: ${title} at ${scheduledAt}`,
    }).catch(() => {});

    res.status(201).json({ session });
  } catch (err) {
    next(err);
  }
});

/** Role-scoped listing: admin → all; employee → their clients or assigned to them; client → own. */
router.get('/', async (req, res, next) => {
  try {
    const { user } = req;
    let where = {};
    if (user.role === 'client') {
      const profile = await prisma.clientProfile.findUnique({ where: { userId: user.id } });
      if (!profile) return res.json({ sessions: [] });
      where = { clientId: profile.id };
    } else if (user.role === 'employee') {
      where = {
        OR: [
          { assignedEmployeeId: user.id },
          { client: { assignedEmployeeId: user.id } },
        ],
      };
    }
    const sessions = await prisma.interviewSession.findMany({
      where,
      orderBy: { scheduledAt: 'asc' },
      take: 100,
      include: {
        client: { include: { user: { select: { fullName: true } } } },
        assignedEmployee: { select: { id: true, fullName: true } },
      },
    });
    res.json({
      sessions: sessions.map((s) => ({
        id: s.id,
        title: s.title,
        scheduledAt: s.scheduledAt,
        joinLink: s.joinLink,
        notes: s.notes,
        fileName: s.fileName,
        hasFile: Boolean(s.fileKey),
        clientId: s.clientId,
        clientName: s.client.user.fullName,
        assignedEmployee: s.assignedEmployee,
        upcoming: s.scheduledAt > new Date(),
      })),
    });
  } catch (err) {
    next(err);
  }
});

router.delete('/:id', authorizeRole(['admin']), async (req, res, next) => {
  try {
    const session = await prisma.interviewSession.findUnique({ where: { id: req.params.id } });
    if (!session) return res.status(404).json({ error: 'Session not found' });
    await prisma.interviewSession.delete({ where: { id: session.id } });
    if (session.fileKey) await deleteFile(session.fileKey);
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

export default router;
