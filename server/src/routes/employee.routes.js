import { Router } from 'express';
import { prisma } from '../lib/prisma.js';
import { authenticate, authorizeRole } from '../middleware/auth.js';
import { startOfMonth, daysUntil, dateOnly, todayISO } from '../utils/dates.js';

const router = Router();
router.use(authenticate, authorizeRole(['employee', 'admin']));

/** Employee's assigned clients (admins see all — same page works for both). */
router.get('/clients', async (req, res, next) => {
  try {
    const where =
      req.user.role === 'employee' ? { assignedEmployeeId: req.user.id } : {};
    const monthStart = startOfMonth();
    const today = dateOnly(todayISO());

    const clients = await prisma.clientProfile.findMany({
      where,
      include: {
        user: { select: { id: true, fullName: true, email: true, isActive: true } },
        domains: { select: { id: true, name: true } },
      },
      orderBy: { createdAt: 'asc' },
    });

    const withCounts = await Promise.all(
      clients.map(async (c) => {
        const [monthCount, todayCount] = await Promise.all([
          prisma.jobApplication.count({
            where: { clientId: c.id, applicationDate: { gte: monthStart } },
          }),
          prisma.jobApplication.count({
            where: { clientId: c.id, applicationDate: { gte: today } },
          }),
        ]);
        return {
          id: c.id,
          fullName: c.user.fullName,
          email: c.user.email,
          isActive: c.user.isActive,
          packageType: c.packageType,
          linkedinStatus: c.linkedinStatus,
          monthlyJobTarget: c.monthlyJobTarget,
          domains: c.domains,
          monthApplied: monthCount,
          todayApplied: todayCount,
          daysRemaining: daysUntil(c.expiryDate),
        };
      })
    );

    res.json({ clients: withCounts });
  } catch (err) {
    next(err);
  }
});

export default router;
