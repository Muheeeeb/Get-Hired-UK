import { Router } from 'express';
import { prisma } from '../lib/prisma.js';
import { authenticate, authorizeRole } from '../middleware/auth.js';
import { daysUntil, dateOnly, todayISO } from '../utils/dates.js';
import { packagePeriodWhere } from '../lib/packageTracking.js';
import { listPackageMonthsByClient } from '../lib/packageMonths.js';

const router = Router();
router.use(authenticate, authorizeRole(['employee', 'admin']));

/** Employee's assigned clients (admins see all — same page works for both). */
router.get('/clients', async (req, res, next) => {
  try {
    const where =
      req.user.role === 'employee' ? { assignedEmployeeId: req.user.id } : {};
    const today = dateOnly(todayISO());

    const clients = await prisma.clientProfile.findMany({
      where,
      include: {
        user: { select: { id: true, fullName: true, email: true, isActive: true } },
        domains: { select: { id: true, name: true } },
      },
      orderBy: { createdAt: 'asc' },
    });

    // One query for every client's stored month ranges, so the per-client counts
    // below use the admin-edited dates rather than re-deriving them.
    const monthsByClient = await listPackageMonthsByClient(clients.map((c) => c.id));

    const withCounts = await Promise.all(
      clients.map(async (c) => {
        const period = packagePeriodWhere(c, todayISO(), monthsByClient.get(c.id));
        const [monthCount, todayCount] = await Promise.all([
          prisma.jobApplication.count({
            where: { clientId: c.id, applicationDate: period.applicationDate },
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
          packageMonth: period.tracking.current.month,
          packageMonths: period.tracking.totalMonths,
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
