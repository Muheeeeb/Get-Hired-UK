import { Router } from 'express';
import multer from 'multer';
import { prisma } from '../lib/prisma.js';
import { authenticate, authorizeRole } from '../middleware/auth.js';
import { buildFileKey, saveFile, deleteFile } from '../lib/storage.js';

const router = Router();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const ok = /\.(pdf|doc|docx|txt|md|rtf|odt)$/i.test(file.originalname);
    cb(ok ? null : new Error('Unsupported file type. Allowed: pdf, doc, docx, txt, md, rtf, odt'), ok);
  },
});

/**
 * Upload a tailored CV / cover letter for a specific job application.
 * Admin + Employee ONLY — clients can never touch tailored documents.
 */
router.post(
  '/:jobId/tailored-docs',
  authenticate,
  authorizeRole(['admin', 'employee']),
  upload.single('file'),
  async (req, res, next) => {
    try {
      const { type } = req.body;
      if (!['tailored_cv', 'tailored_cover_letter'].includes(type)) {
        return res.status(400).json({ error: 'type must be tailored_cv or tailored_cover_letter' });
      }
      if (!req.file) return res.status(400).json({ error: 'A file is required' });

      const job = await prisma.jobApplication.findUnique({
        where: { id: req.params.jobId },
        include: { client: true },
      });
      if (!job) return res.status(404).json({ error: 'Job application not found' });

      // Row-level scope: employees may only upload for their assigned clients.
      if (req.user.role === 'employee' && job.client.assignedEmployeeId !== req.user.id) {
        return res.status(403).json({ error: 'Forbidden' });
      }

      const fileKey = buildFileKey(`tailored/${job.clientId}/${job.id}`, req.file.originalname);
      await saveFile(fileKey, req.file.buffer, req.file.mimetype);

      const doc = await prisma.tailoredDocument.create({
        data: {
          jobApplicationId: job.id,
          type,
          fileKey,
          fileName: req.file.originalname,
          uploadedById: req.user.id,
        },
        select: { id: true, type: true, fileName: true, uploadedAt: true },
      });

      res.status(201).json({ document: doc });
    } catch (err) {
      next(err);
    }
  }
);

/** Delete a mistaken job entry (and its tailored documents, via cascade). */
router.delete(
  '/:jobId',
  authenticate,
  authorizeRole(['admin', 'employee']),
  async (req, res, next) => {
    try {
      const job = await prisma.jobApplication.findUnique({
        where: { id: req.params.jobId },
        include: { client: true, tailoredDocuments: { select: { fileKey: true } } },
      });
      if (!job) return res.status(404).json({ error: 'Job application not found' });
      if (req.user.role === 'employee' && job.client.assignedEmployeeId !== req.user.id) {
        return res.status(403).json({ error: 'Forbidden' });
      }
      await prisma.jobApplication.delete({ where: { id: job.id } });
      // Best-effort storage cleanup after the rows are gone.
      await Promise.all(job.tailoredDocuments.map((d) => deleteFile(d.fileKey)));
      res.json({ ok: true });
    } catch (err) {
      next(err);
    }
  }
);

export default router;
