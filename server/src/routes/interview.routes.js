import { Router } from 'express';
import multer from 'multer';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { authenticate, authorizeRole } from '../middleware/auth.js';
import { buildFileKey, saveFile, deleteFile } from '../lib/storage.js';

const router = Router();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
});

/** Interview Prep Hub — readable by every authenticated role. */
router.get('/', authenticate, async (req, res, next) => {
  try {
    const resources = await prisma.interviewResource.findMany({
      orderBy: { createdAt: 'desc' },
      select: {
        id: true, title: true, description: true, tipText: true,
        fileName: true, createdAt: true, fileKey: true,
      },
    });
    // Expose only whether a file exists — actual access goes through /files/:id/signed-url.
    res.json({
      resources: resources.map(({ fileKey, ...r }) => ({ ...r, hasFile: Boolean(fileKey) })),
    });
  } catch (err) {
    next(err);
  }
});

const createSchema = z.object({
  title: z.string().min(2).max(160),
  description: z.string().min(2).max(1000),
  tipText: z.string().max(4000).optional(),
});

/** Admin/employee post guides and tips for clients. */
router.post(
  '/',
  authenticate,
  authorizeRole(['admin', 'employee']),
  upload.single('file'),
  async (req, res, next) => {
    try {
      const parsed = createSchema.safeParse(req.body);
      if (!parsed.success) return res.status(400).json({ error: 'title and description are required' });

      let fileKey = null;
      let fileName = null;
      if (req.file) {
        fileKey = buildFileKey('resources', req.file.originalname);
        await saveFile(fileKey, req.file.buffer, req.file.mimetype);
        fileName = req.file.originalname;
      }

      const resource = await prisma.interviewResource.create({
        data: {
          title: parsed.data.title,
          description: parsed.data.description,
          tipText: parsed.data.tipText || null,
          fileKey,
          fileName,
          createdById: req.user.id,
        },
        select: { id: true, title: true, description: true, tipText: true, fileName: true, createdAt: true },
      });
      res.status(201).json({ resource: { ...resource, hasFile: Boolean(fileKey) } });
    } catch (err) {
      next(err);
    }
  }
);

/** Remove a resource (admin only). */
router.delete('/:id', authenticate, authorizeRole(['admin']), async (req, res, next) => {
  try {
    const resource = await prisma.interviewResource.findUnique({ where: { id: req.params.id } });
    if (!resource) return res.status(404).json({ error: 'Resource not found' });
    await prisma.interviewResource.delete({ where: { id: resource.id } });
    if (resource.fileKey) await deleteFile(resource.fileKey);
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

export default router;
