import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { authenticate, authorizeRole, requireLead } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { todayISO, dateOnly, startOfWeek, startOfMonth, daysUntil, isoDaysFromNow } from '../utils/dates.js';
import { runDailyPulse } from '../jobs/dailyPulse.js';
import { sendMail, brandedEmail } from '../lib/mailer.js';
import { env } from '../config/env.js';
import { activitySummary } from '../lib/sessions.js';
import { PACKAGE_CHOICES } from '../config/packages.js';
import { deleteFile } from '../lib/storage.js';
import { buildPackageExtension, packagePeriodWhere } from '../lib/packageTracking.js';

/**
 * Permanently remove a user from the database so their email can be reused.
 *
 * The tricky part: many rows have REQUIRED links back to this user (jobs they
 * logged, documents they uploaded, chat messages they sent). Deleting the row
 * outright would either fail on the foreign key or destroy clients' history.
 * So we REASSIGN those authored records to a surviving admin (fallbackId),
 * keeping the audit trail intact, and only fully delete data that belongs to
 * the user themselves (a client's own profile, documents and conversations).
 * Runs in one transaction; storage files are cleaned up best-effort afterward.
 */
async function hardDeleteUser(targetId, fallbackId) {
  // Collect the client's own file keys up front (deleted with their profile).
  const profile = await prisma.clientProfile.findUnique({ where: { userId: targetId } });
  const fileKeys = [];
  if (profile) {
    const [masters, tailored, sessions, attachments] = await Promise.all([
      prisma.masterDocument.findMany({ where: { domain: { clientId: profile.id } }, select: { fileKey: true } }),
      prisma.tailoredDocument.findMany({ where: { jobApplication: { clientId: profile.id } }, select: { fileKey: true } }),
      prisma.interviewSession.findMany({ where: { clientId: profile.id }, select: { fileKey: true } }),
      prisma.message.findMany({ where: { conversation: { clientUserId: targetId }, fileKey: { not: null } }, select: { fileKey: true } }),
    ]);
    for (const row of [...masters, ...tailored, ...sessions, ...attachments]) {
      if (row.fileKey) fileKeys.push(row.fileKey);
    }
  }

  await prisma.$transaction(async (tx) => {
    // Reassign authored records to the surviving admin (preserves history).
    await tx.jobApplication.updateMany({ where: { employeeId: targetId }, data: { employeeId: fallbackId } });
    await tx.masterDocument.updateMany({ where: { uploadedById: targetId }, data: { uploadedById: fallbackId } });
    await tx.tailoredDocument.updateMany({ where: { uploadedById: targetId }, data: { uploadedById: fallbackId } });
    await tx.interviewResource.updateMany({ where: { createdById: targetId }, data: { createdById: fallbackId } });

    // Release optional links.
    await tx.clientProfile.updateMany({ where: { assignedEmployeeId: targetId }, data: { assignedEmployeeId: null } });
    await tx.interviewSession.updateMany({ where: { assignedEmployeeId: targetId }, data: { assignedEmployeeId: null } });
    await tx.conversation.updateMany({ where: { assignedEmployeeId: targetId }, data: { assignedEmployeeId: null } });

    if (profile) {
      // The client's own conversations go entirely (cascades messages + reads).
      await tx.conversation.deleteMany({ where: { clientUserId: targetId } });
      // Their profile cascades: domains, master docs, jobs (+tailored), pulse logs, sessions.
      await tx.clientProfile.delete({ where: { id: profile.id } });
    }

    // Any remaining authored chat/sessions elsewhere → reassign, then unlink.
    await tx.message.updateMany({ where: { senderId: targetId }, data: { senderId: fallbackId } });
    await tx.conversation.updateMany({ where: { createdById: targetId }, data: { createdById: fallbackId } });
    await tx.interviewSession.updateMany({ where: { createdById: targetId }, data: { createdById: fallbackId } });
    await tx.conversation.updateMany({ where: { clientUserId: targetId }, data: { clientUserId: null } });
    await tx.conversationRead.deleteMany({ where: { userId: targetId } });

    // Tokens and sessions cascade automatically with the user row.
    await tx.user.delete({ where: { id: targetId } });
  });

  for (const key of fileKeys) await deleteFile(key);
}

const domainsSchema = z
  .array(z.string().min(2, 'Domain too short').max(2000, 'Domain too long (max 2000 chars)'))
  .min(1, 'At least 1 domain required')
  .max(10, 'At most 10 domains allowed');

const router = Router();
router.use(authenticate, authorizeRole(['admin']));

const passwordSchema = z.string().min(10, 'Password must be at least 10 characters').max(200);

// ---------- employees ----------

router.post(
  '/employees',
  validate(
    z.object({
      fullName: z.string().min(2).max(120),
      email: z.string().email().max(254),
      password: passwordSchema,
      designation: z.string().max(120).optional().or(z.literal('')),
    })
  ),
  async (req, res, next) => {
    try {
      const { fullName, email, password, designation } = req.body;
      const existing = await prisma.user.findUnique({ where: { email: email.toLowerCase() } });
      if (existing) return res.status(409).json({ error: 'An account with this email already exists' });
      const user = await prisma.user.create({
        data: {
          fullName,
          email: email.toLowerCase(),
          passwordHash: await bcrypt.hash(password, 12),
          role: 'employee',
          designation: designation || null,
        },
        select: { id: true, fullName: true, email: true, role: true, isActive: true, designation: true, createdAt: true },
      });
      res.status(201).json({ employee: user });
    } catch (err) {
      next(err);
    }
  }
);

/** Full employee profile: clients, per-client job counts, activity/working time. */
router.get('/employees/:id', async (req, res, next) => {
  try {
    const employee = await prisma.user.findFirst({
      where: { id: req.params.id, role: 'employee', deletedAt: null },
      select: {
        id: true, fullName: true, email: true, isActive: true, designation: true,
        aiModel: true, lastLoginAt: true, createdAt: true,
      },
    });
    if (!employee) return res.status(404).json({ error: 'Employee not found' });

    const monthStart = startOfMonth();
    const today = dateOnly(todayISO());
    const weekStart = startOfWeek();

    const clients = await prisma.clientProfile.findMany({
      where: { assignedEmployeeId: employee.id },
      include: { user: { select: { fullName: true, email: true, isActive: true } } },
    });
    const perClient = await Promise.all(
      clients.map(async (c) => {
        const packagePeriod = packagePeriodWhere(c, todayISO());
        const [monthCount, todayCount] = await Promise.all([
          prisma.jobApplication.count({ where: { clientId: c.id, employeeId: employee.id, applicationDate: packagePeriod.applicationDate } }),
          prisma.jobApplication.count({ where: { clientId: c.id, employeeId: employee.id, applicationDate: { gte: today } } }),
        ]);
        return {
          clientId: c.id,
          fullName: c.user.fullName,
          isActive: c.user.isActive,
          packageType: c.packageType,
          monthlyJobTarget: c.monthlyJobTarget,
          monthApplied: monthCount,
          packageMonth: packagePeriod.tracking.current.month,
          packageMonths: packagePeriod.tracking.totalMonths,
          todayApplied: todayCount,
          targetMet: monthCount >= c.monthlyJobTarget,
          percent: c.monthlyJobTarget ? Math.round((monthCount / c.monthlyJobTarget) * 100) : null,
          daysRemaining: daysUntil(c.expiryDate),
        };
      })
    );

    const [jobsToday, jobsWeek, jobsMonth] = await Promise.all([
      prisma.jobApplication.count({ where: { employeeId: employee.id, applicationDate: { gte: today } } }),
      prisma.jobApplication.count({ where: { employeeId: employee.id, applicationDate: { gte: weekStart } } }),
      prisma.jobApplication.count({ where: { employeeId: employee.id, applicationDate: { gte: monthStart } } }),
    ]);

    const activity = await activitySummary([employee.id], {
      weekStart: new Date(Date.now() - 7 * 86400000),
      dayStart: today,
    });
    const recentSessions = await prisma.userSession.findMany({
      where: { userId: employee.id },
      orderBy: { loginAt: 'desc' },
      take: 10,
    });

    res.json({
      employee,
      clients: perClient,
      totals: { jobsToday, jobsWeek, jobsMonth },
      activity: activity[employee.id],
      recentSessions,
    });
  } catch (err) {
    next(err);
  }
});

/** Edit employee profile fields (designation, name). */
router.put(
  '/employees/:id',
  validate(
    z.object({
      fullName: z.string().min(2).max(120).optional(),
      designation: z.string().max(120).optional().or(z.literal('')),
      aiModel: z.string().regex(/^claude-[a-zA-Z0-9._-]+$/).max(200).nullable().optional(),
    })
  ),
  async (req, res, next) => {
    try {
      const employee = await prisma.user.findFirst({
        where: { id: req.params.id, role: 'employee', deletedAt: null },
      });
      if (!employee) return res.status(404).json({ error: 'Employee not found' });
      const updated = await prisma.user.update({
        where: { id: employee.id },
        data: {
          ...(req.body.fullName ? { fullName: req.body.fullName } : {}),
          ...(req.body.designation !== undefined ? { designation: req.body.designation || null } : {}),
          ...(req.body.aiModel !== undefined ? { aiModel: req.body.aiModel || null } : {}),
        },
        select: { id: true, fullName: true, designation: true, aiModel: true },
      });
      res.json({ employee: updated });
    } catch (err) {
      next(err);
    }
  }
);

router.get('/employees', async (req, res, next) => {
  try {
    const employees = await prisma.user.findMany({
      where: { role: 'employee', deletedAt: null },
      select: {
        id: true, fullName: true, email: true, isActive: true, lastLoginAt: true, createdAt: true,
        _count: { select: { assignedClients: true } },
      },
      orderBy: { createdAt: 'asc' },
    });
    res.json({ employees });
  } catch (err) {
    next(err);
  }
});

router.put(
  '/employees/:id/status',
  validate(z.object({ isActive: z.boolean() })),
  async (req, res, next) => {
    try {
      const employee = await prisma.user.findFirst({
        where: { id: req.params.id, role: 'employee', deletedAt: null },
      });
      if (!employee) return res.status(404).json({ error: 'Employee not found' });
      const updated = await prisma.user.update({
        where: { id: employee.id },
        data: { isActive: req.body.isActive },
        select: { id: true, isActive: true },
      });
      res.json({ employee: updated });
    } catch (err) {
      next(err);
    }
  }
);

/** Permanently delete an employee (frees their email for reuse). */
router.delete('/employees/:id', async (req, res, next) => {
  try {
    const employee = await prisma.user.findFirst({
      where: { id: req.params.id, role: 'employee', deletedAt: null },
    });
    if (!employee) return res.status(404).json({ error: 'Employee not found' });
    await hardDeleteUser(employee.id, req.user.id);
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

// ---------- social media staff (Social Media Marketing Portal) ----------

router.post(
  '/social-users',
  validate(z.object({
    fullName: z.string().min(2).max(120),
    email: z.string().email().max(254),
    password: passwordSchema,
  })),
  async (req, res, next) => {
    try {
      const { fullName, email, password } = req.body;
      const existing = await prisma.user.findUnique({ where: { email: email.toLowerCase() } });
      if (existing) return res.status(409).json({ error: 'An account with this email already exists' });
      const user = await prisma.user.create({
        data: { fullName, email: email.toLowerCase(), passwordHash: await bcrypt.hash(password, 12), role: 'social' },
        select: { id: true, fullName: true, email: true, role: true, isActive: true, createdAt: true },
      });
      res.status(201).json({ user });
    } catch (err) {
      next(err);
    }
  }
);

router.get('/social-users', async (req, res, next) => {
  try {
    const users = await prisma.user.findMany({
      where: { role: 'social', deletedAt: null },
      select: {
        id: true, fullName: true, email: true, isActive: true, lastLoginAt: true, createdAt: true,
        _count: { select: { posts: true } },
      },
      orderBy: { createdAt: 'asc' },
    });
    res.json({ users });
  } catch (err) {
    next(err);
  }
});

router.put(
  '/social-users/:id/status',
  validate(z.object({ isActive: z.boolean() })),
  async (req, res, next) => {
    try {
      const user = await prisma.user.findFirst({ where: { id: req.params.id, role: 'social', deletedAt: null } });
      if (!user) return res.status(404).json({ error: 'Account not found' });
      const updated = await prisma.user.update({
        where: { id: user.id }, data: { isActive: req.body.isActive }, select: { id: true, isActive: true },
      });
      res.json({ user: updated });
    } catch (err) {
      next(err);
    }
  }
);

/** Delete a social account; their posts are reassigned to the deleting admin so
 *  published content survives. */
router.delete('/social-users/:id', async (req, res, next) => {
  try {
    const user = await prisma.user.findFirst({ where: { id: req.params.id, role: 'social', deletedAt: null } });
    if (!user) return res.status(404).json({ error: 'Account not found' });
    await prisma.post.updateMany({ where: { authorId: user.id }, data: { authorId: req.user.id } });
    await hardDeleteUser(user.id, req.user.id);
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

// ---------- clients ----------

const createClientSchema = z.object({
  fullName: z.string().min(2).max(120),
  email: z.string().email().max(254),
  password: passwordSchema,
  packageType: z.string().min(2).max(120),
  expiryDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Expected YYYY-MM-DD'),
  monthlyJobTarget: z.number().int().min(1).max(2000).default(40),
  assignedEmployeeId: z.string().uuid().optional(),
  domains: domainsSchema.optional(),
});

router.post('/clients', validate(createClientSchema), async (req, res, next) => {
  try {
    const { fullName, email, password, packageType, expiryDate, monthlyJobTarget, assignedEmployeeId, domains } = req.body;
    const existing = await prisma.user.findUnique({ where: { email: email.toLowerCase() } });
    if (existing) return res.status(409).json({ error: 'An account with this email already exists' });

    if (assignedEmployeeId) {
      const emp = await prisma.user.findFirst({
        where: { id: assignedEmployeeId, role: 'employee', isActive: true, deletedAt: null },
      });
      if (!emp) return res.status(400).json({ error: 'Assigned employee not found or inactive' });
    }

    const profile = await prisma.$transaction(async (tx) => {
      const user = await tx.user.create({
        data: {
          fullName,
          email: email.toLowerCase(),
          passwordHash: await bcrypt.hash(password, 12),
          role: 'client',
          // Admin-created accounts don't need email verification — the admin
          // is vouching for the address.
          emailVerifiedAt: new Date(),
        },
      });
      return tx.clientProfile.create({
        data: {
          userId: user.id,
          packageType,
          expiryDate: dateOnly(expiryDate),
          monthlyJobTarget,
          assignedEmployeeId: assignedEmployeeId || null,
          ...(domains ? { domains: { create: domains.map((name) => ({ name })) } } : {}),
        },
        include: { user: { select: { id: true, fullName: true, email: true } }, domains: true },
      });
    });

    res.status(201).json({ client: profile });
  } catch (err) {
    next(err);
  }
});

// ---------- client sign-up requests (self-registration approvals) ----------

router.get('/signups', async (req, res, next) => {
  try {
    const status = ['pending', 'approved', 'rejected'].includes(req.query.status)
      ? req.query.status
      : 'pending';
    const signups = await prisma.user.findMany({
      where: { role: 'client', approvalStatus: status, deletedAt: null },
      select: {
        id: true, fullName: true, email: true, phone: true, signupNote: true,
        approvalStatus: true, emailVerifiedAt: true, createdAt: true,
      },
      orderBy: { createdAt: 'desc' },
    });
    const pendingCount = await prisma.user.count({
      where: { role: 'client', approvalStatus: 'pending', deletedAt: null },
    });
    res.json({ signups, pendingCount });
  } catch (err) {
    next(err);
  }
});

// All provisioning fields are OPTIONAL — the admin can approve immediately and
// set package/domains later from the client edit page.
const approveSchema = z.object({
  packageType: z.string().min(2).max(120).optional().or(z.literal('')),
  expiryDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Expected YYYY-MM-DD').optional().or(z.literal('')),
  monthlyJobTarget: z.number().int().min(1).max(2000).optional(),
  assignedEmployeeId: z.string().uuid().optional().or(z.literal('')),
  domains: domainsSchema.optional(),
});

/** Approve a pending sign-up; provisioning fields are optional (editable later). */
router.put('/signups/:id/approve', validate(approveSchema), async (req, res, next) => {
  try {
    const {
      packageType: rawPackage,
      expiryDate: rawExpiry,
      monthlyJobTarget = 40,
      assignedEmployeeId: rawEmployee,
      domains,
    } = req.body;
    const packageType = rawPackage || 'To be agreed';
    const expiryDate = rawExpiry || isoDaysFromNow(30);
    const assignedEmployeeId = rawEmployee || undefined;
    const user = await prisma.user.findFirst({
      where: { id: req.params.id, role: 'client', approvalStatus: 'pending', deletedAt: null },
      include: { clientProfile: true },
    });
    if (!user) return res.status(404).json({ error: 'Pending sign-up not found' });

    if (assignedEmployeeId) {
      const emp = await prisma.user.findFirst({
        where: { id: assignedEmployeeId, role: 'employee', isActive: true, deletedAt: null },
      });
      if (!emp) return res.status(400).json({ error: 'Assigned employee not found or inactive' });
    }

    await prisma.$transaction(async (tx) => {
      if (!user.clientProfile) {
        await tx.clientProfile.create({
          data: {
            userId: user.id,
            packageType,
            expiryDate: dateOnly(expiryDate),
            monthlyJobTarget,
            assignedEmployeeId: assignedEmployeeId || null,
            country: user.designation || null,
            ...(domains ? { domains: { create: domains.map((name) => ({ name })) } } : {}),
          },
        });
      }
      await tx.user.update({
        where: { id: user.id },
        data: { approvalStatus: 'approved', isActive: true },
      });
    });

    const portalUrl = `${env.primaryClientOrigin}/login`;
    sendMail({
      to: user.email,
      subject: 'Your Get Hired Global account is approved 🎉',
      html: brandedEmail({
        heading: 'You’re all set',
        bodyHtml: `
          <p>Hi ${user.fullName.split(' ')[0]},</p>
          <p>Your account has been approved. Here's your account summary:</p>
          <p style="background:#F7F6F2;border-radius:10px;padding:12px 16px;">
            <strong>Package:</strong> ${packageType}<br />
            <strong>Valid until:</strong> ${expiryDate}<br />
            ${domains?.length ? `<strong>Career domains:</strong> ${domains.join(', ')}<br />` : ''}
          </p>
          <p><strong>Next steps:</strong> sign in to your portal to see your dashboard,
          your master documents as they're prepared, and every application we file for you.</p>`,
        ctaLabel: 'Sign in to your portal',
        ctaUrl: portalUrl,
      }),
      text: `Your Get Hired Global account is approved. Sign in: ${portalUrl}`,
    }).catch((err) => console.error('[approve] email failed:', err.message));

    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

router.put('/signups/:id/reject', async (req, res, next) => {
  try {
    const user = await prisma.user.findFirst({
      where: { id: req.params.id, role: 'client', approvalStatus: 'pending', deletedAt: null },
    });
    if (!user) return res.status(404).json({ error: 'Pending sign-up not found' });
    await prisma.user.update({
      where: { id: user.id },
      data: { approvalStatus: 'rejected', isActive: false },
    });
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

router.get('/clients', async (req, res, next) => {
  try {
    const clients = await prisma.clientProfile.findMany({
      include: {
        user: { select: { id: true, fullName: true, email: true, isActive: true } },
        assignedEmployee: { select: { id: true, fullName: true } },
        domains: true,
        _count: { select: { jobApplications: true } },
      },
      orderBy: { createdAt: 'asc' },
    });
    res.json({
      clients: clients.map((c) => ({ ...c, daysRemaining: daysUntil(c.expiryDate) })),
    });
  } catch (err) {
    next(err);
  }
});

router.put(
  '/clients/:id/assign',
  validate(z.object({ employeeId: z.string().uuid().nullable() })),
  async (req, res, next) => {
    try {
      const profile = await prisma.clientProfile.findUnique({ where: { id: req.params.id } });
      if (!profile) return res.status(404).json({ error: 'Client not found' });
      if (req.body.employeeId) {
        const emp = await prisma.user.findFirst({
          where: { id: req.body.employeeId, role: 'employee', isActive: true, deletedAt: null },
        });
        if (!emp) return res.status(400).json({ error: 'Employee not found or inactive' });
      }
      const updated = await prisma.clientProfile.update({
        where: { id: profile.id },
        data: { assignedEmployeeId: req.body.employeeId },
        include: { assignedEmployee: { select: { id: true, fullName: true } } },
      });
      res.json({ client: updated });
    } catch (err) {
      next(err);
    }
  }
);

router.put(
  '/clients/:id/domains',
  validate(z.object({ domains: domainsSchema })),
  async (req, res, next) => {
    try {
      const profile = await prisma.clientProfile.findUnique({
        where: { id: req.params.id },
        include: { domains: { include: { masterDocuments: { select: { fileKey: true } } } } },
      });
      if (!profile) return res.status(404).json({ error: 'Client not found' });

      const incoming = req.body.domains;
      // Keep domains whose name persists (preserving their master docs); drop removed; add new.
      const keep = profile.domains.filter((d) => incoming.includes(d.name));
      const toDelete = profile.domains.filter((d) => !incoming.includes(d.name));
      const toAdd = incoming.filter((name) => !profile.domains.some((d) => d.name === name));

      await prisma.$transaction([
        ...toDelete.map((d) => prisma.domain.delete({ where: { id: d.id } })),
        ...toAdd.map((name) =>
          prisma.domain.create({ data: { clientId: profile.id, name } })
        ),
      ]);

      // Rows are gone (cascade) — now clean up the orphaned master files in storage.
      const { deleteFile } = await import('../lib/storage.js');
      await Promise.all(
        toDelete.flatMap((d) => d.masterDocuments.map((m) => deleteFile(m.fileKey)))
      );

      const domains = await prisma.domain.findMany({ where: { clientId: profile.id } });
      res.json({ domains, kept: keep.length, removed: toDelete.length, added: toAdd.length });
    } catch (err) {
      next(err);
    }
  }
);

router.put(
  '/clients/:id/package',
  validate(
    z.object({
      packageType: z.string().min(2).max(80).optional(),
      packageStartedAt: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
      expiryDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
      monthlyJobTarget: z.number().int().min(1).max(500).optional(),
    })
  ),
  async (req, res, next) => {
    try {
      const profile = await prisma.clientProfile.findUnique({ where: { id: req.params.id } });
      if (!profile) return res.status(404).json({ error: 'Client not found' });
      const packageStartedAt = req.body.packageStartedAt
        ? dateOnly(req.body.packageStartedAt)
        : profile.packageStartedAt;
      const expiryDate = req.body.expiryDate
        ? dateOnly(req.body.expiryDate)
        : profile.expiryDate;
      if (expiryDate < packageStartedAt) {
        return res.status(400).json({ error: 'Package end date cannot be before the start date' });
      }
      const updated = await prisma.clientProfile.update({
        where: { id: profile.id },
        data: {
          ...(req.body.packageType ? { packageType: req.body.packageType } : {}),
          ...(req.body.packageStartedAt ? { packageStartedAt } : {}),
          ...(req.body.expiryDate ? { expiryDate } : {}),
          ...(req.body.monthlyJobTarget ? { monthlyJobTarget: req.body.monthlyJobTarget } : {}),
        },
      });
      res.json({ client: updated });
    } catch (err) {
      next(err);
    }
  }
);

router.post(
  '/clients/:id/extend',
  validate(z.object({ months: z.number().int().min(1).max(24) })),
  async (req, res, next) => {
    try {
      const profile = await prisma.clientProfile.findUnique({ where: { id: req.params.id } });
      if (!profile) return res.status(404).json({ error: 'Client not found' });
      const extension = buildPackageExtension(profile, req.body.months);
      const expiryDate = dateOnly(extension.expiryDate);
      const updated = await prisma.clientProfile.update({
        where: { id: profile.id },
        data: { expiryDate },
      });
      res.json({
        client: updated,
        monthsAdded: req.body.months,
        previousExpiryDate: extension.previousExpiryDate,
        expiryDate: extension.expiryDate,
        packageMonths: extension.packageMonths,
      });
    } catch (err) {
      next(err);
    }
  }
);

router.put(
  '/clients/:id/status',
  validate(z.object({ isActive: z.boolean() })),
  async (req, res, next) => {
    try {
      const profile = await prisma.clientProfile.findUnique({ where: { id: req.params.id } });
      if (!profile) return res.status(404).json({ error: 'Client not found' });
      await prisma.$transaction([
        prisma.user.update({
          where: { id: profile.userId },
          data: { isActive: req.body.isActive },
        }),
        // Deactivation kills their sessions immediately.
        ...(req.body.isActive
          ? []
          : [
              prisma.refreshToken.updateMany({
                where: { userId: profile.userId, revokedAt: null },
                data: { revokedAt: new Date() },
              }),
            ]),
      ]);
      res.json({ ok: true, isActive: req.body.isActive });
    } catch (err) {
      next(err);
    }
  }
);

/** Permanently delete a client and ALL their data (frees their email for reuse). */
router.delete('/clients/:id', async (req, res, next) => {
  try {
    const profile = await prisma.clientProfile.findUnique({ where: { id: req.params.id } });
    if (!profile) return res.status(404).json({ error: 'Client not found' });
    await hardDeleteUser(profile.userId, req.user.id);
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

// ---------- leaderboard ----------

router.get('/leaderboard', async (req, res, next) => {
  try {
    const isoRe = /^\d{4}-\d{2}-\d{2}$/;
    const period = ['today', 'week', 'month'].includes(req.query.period) ? req.query.period : 'today';

    // Optional historical range: ?from=YYYY-MM-DD&to=YYYY-MM-DD overrides period.
    let from;
    let to = null;
    let effectivePeriod = period;
    if (isoRe.test(req.query.from || '')) {
      from = dateOnly(req.query.from);
      to = isoRe.test(req.query.to || '') ? dateOnly(req.query.to) : dateOnly(todayISO());
      effectivePeriod = 'range';
    } else {
      from = period === 'today' ? dateOnly(todayISO()) : period === 'week' ? startOfWeek() : startOfMonth();
    }

    const employees = await prisma.user.findMany({
      where: { role: 'employee', deletedAt: null },
      select: {
        id: true, fullName: true, isActive: true,
        assignedClients: { select: { monthlyJobTarget: true } },
      },
    });

    const counts = await prisma.jobApplication.groupBy({
      by: ['employeeId'],
      where: { applicationDate: to ? { gte: from, lte: to } : { gte: from } },
      _count: { id: true },
    });
    const countMap = new Map(counts.map((c) => [c.employeeId, c._count.id]));

    // Prorate each employee's monthly target down to the selected window.
    const rangeDays = to ? Math.max(1, Math.round((to - from) / 86400000) + 1) : null;
    const divisor =
      effectivePeriod === 'today' ? 22
      : effectivePeriod === 'week' ? 4.33
      : effectivePeriod === 'range' ? Math.max(1, 30 / rangeDays)
      : 1;

    const rows = employees
      .map((e) => {
        const monthlyTarget = e.assignedClients.reduce((sum, c) => sum + c.monthlyJobTarget, 0);
        const target = Math.max(1, Math.round(monthlyTarget / divisor));
        const count = countMap.get(e.id) || 0;
        const ratio = monthlyTarget === 0 ? null : count / target;
        return {
          employeeId: e.id,
          fullName: e.fullName,
          isActive: e.isActive,
          clientCount: e.assignedClients.length,
          jobsLogged: count,
          target: monthlyTarget === 0 ? 0 : target,
          status:
            monthlyTarget === 0 ? 'unassigned' : ratio >= 1 ? 'on_target' : ratio >= 0.6 ? 'at_risk' : 'below',
        };
      })
      .sort((a, b) => b.jobsLogged - a.jobsLogged);

    res.json({ period, leaderboard: rows });
  } catch (err) {
    next(err);
  }
});

// ---------- consultation leads ----------

router.get('/consultations', async (req, res, next) => {
  try {
    const leads = await prisma.consultationRequest.findMany({
      orderBy: { createdAt: 'desc' },
    });
    res.json({ leads });
  } catch (err) {
    next(err);
  }
});

router.put(
  '/consultations/:id/status',
  validate(z.object({ status: z.enum(['new', 'contacted', 'closed']) })),
  async (req, res, next) => {
    try {
      const lead = await prisma.consultationRequest.findUnique({ where: { id: req.params.id } });
      if (!lead) return res.status(404).json({ error: 'Lead not found' });
      const updated = await prisma.consultationRequest.update({
        where: { id: lead.id },
        data: { status: req.body.status },
      });
      res.json({ lead: updated });
    } catch (err) {
      next(err);
    }
  }
);

// ---------- newsletter subscribers (private — admins only) ----------

router.get('/newsletter', async (req, res, next) => {
  try {
    const subscribers = await prisma.newsletterSubscriber.findMany({
      orderBy: { createdAt: 'desc' },
    });
    res.json({ subscribers });
  } catch (err) {
    next(err);
  }
});

// ---------- overview ----------

router.get('/overview', async (req, res, next) => {
  try {
    const today = dateOnly(todayISO());
    const in7days = new Date(today.getTime() + 7 * 86400000);

    const [activeClients, activeEmployees, jobsToday, jobsThisMonth, expiringSoon, newLeads, pendingSignups] =
      await Promise.all([
        prisma.clientProfile.count({ where: { user: { isActive: true, deletedAt: null } } }),
        prisma.user.count({ where: { role: 'employee', isActive: true, deletedAt: null } }),
        prisma.jobApplication.count({ where: { applicationDate: { gte: today } } }),
        prisma.jobApplication.count({ where: { applicationDate: { gte: startOfMonth() } } }),
        prisma.clientProfile.findMany({
          where: {
            expiryDate: { gte: today, lte: in7days },
            user: { isActive: true, deletedAt: null },
          },
          include: { user: { select: { fullName: true, email: true } } },
        }),
        prisma.consultationRequest.count({ where: { status: 'new' } }),
        prisma.user.count({ where: { role: 'client', approvalStatus: 'pending', deletedAt: null } }),
      ]);

    res.json({
      kpis: { activeClients, activeEmployees, jobsToday, jobsThisMonth, expiringSoonCount: expiringSoon.length, newLeads, pendingSignups },
      expiringSoon: expiringSoon.map((c) => ({
        id: c.id,
        fullName: c.user.fullName,
        packageType: c.packageType,
        expiryDate: c.expiryDate,
        daysRemaining: daysUntil(c.expiryDate),
      })),
    });
  } catch (err) {
    next(err);
  }
});

// ---------- package choices (single source of truth for dropdowns) ----------

router.get('/package-choices', (req, res) => {
  res.json({ choices: PACKAGE_CHOICES });
});

// ---------- multi-admin management (Admin Lead only) ----------

router.get('/admins', requireLead, async (req, res, next) => {
  try {
    const admins = await prisma.user.findMany({
      where: { role: 'admin', deletedAt: null },
      select: {
        id: true, fullName: true, email: true, isActive: true, isLead: true,
        designation: true, lastLoginAt: true, createdAt: true,
      },
      orderBy: { createdAt: 'asc' },
    });
    const activity = await activitySummary(admins.map((a) => a.id), {
      weekStart: new Date(Date.now() - 7 * 86400000),
      dayStart: dateOnly(todayISO()),
    });
    res.json({ admins: admins.map((a) => ({ ...a, activity: activity[a.id] })) });
  } catch (err) {
    next(err);
  }
});

router.post(
  '/admins',
  requireLead,
  validate(
    z.object({
      fullName: z.string().min(2).max(120),
      email: z.string().email().max(254),
      password: passwordSchema,
      designation: z.string().max(120).optional().or(z.literal('')),
    })
  ),
  async (req, res, next) => {
    try {
      const existing = await prisma.user.findUnique({ where: { email: req.body.email.toLowerCase() } });
      if (existing) return res.status(409).json({ error: 'An account with this email already exists' });
      const admin = await prisma.user.create({
        data: {
          fullName: req.body.fullName,
          email: req.body.email.toLowerCase(),
          passwordHash: await bcrypt.hash(req.body.password, 12),
          role: 'admin',
          isLead: false,
          designation: req.body.designation || null,
        },
        select: { id: true, fullName: true, email: true, isActive: true, isLead: true },
      });
      res.status(201).json({ admin });
    } catch (err) {
      next(err);
    }
  }
);

router.put(
  '/admins/:id/status',
  requireLead,
  validate(z.object({ isActive: z.boolean() })),
  async (req, res, next) => {
    try {
      const target = await prisma.user.findFirst({
        where: { id: req.params.id, role: 'admin', deletedAt: null },
      });
      if (!target) return res.status(404).json({ error: 'Admin not found' });
      if (target.isLead) return res.status(400).json({ error: 'The Admin Lead account cannot be deactivated' });
      if (target.id === req.user.id) return res.status(400).json({ error: 'You cannot deactivate your own account' });
      await prisma.$transaction([
        prisma.user.update({ where: { id: target.id }, data: { isActive: req.body.isActive } }),
        ...(req.body.isActive
          ? []
          : [
              prisma.refreshToken.updateMany({
                where: { userId: target.id, revokedAt: null },
                data: { revokedAt: new Date() },
              }),
            ]),
      ]);
      res.json({ ok: true });
    } catch (err) {
      next(err);
    }
  }
);

router.put(
  '/admins/:id/password',
  requireLead,
  validate(z.object({ password: passwordSchema })),
  async (req, res, next) => {
    try {
      const target = await prisma.user.findFirst({
        where: { id: req.params.id, role: 'admin', deletedAt: null },
      });
      if (!target) return res.status(404).json({ error: 'Admin not found' });
      if (target.isLead && target.id !== req.user.id) {
        return res.status(400).json({ error: "The Admin Lead's password can only be changed by themselves" });
      }
      await prisma.$transaction([
        prisma.user.update({
          where: { id: target.id },
          data: { passwordHash: await bcrypt.hash(req.body.password, 12) },
        }),
        prisma.refreshToken.updateMany({
          where: { userId: target.id, revokedAt: null },
          data: { revokedAt: new Date() },
        }),
      ]);
      res.json({ ok: true });
    } catch (err) {
      next(err);
    }
  }
);

/** Permanently delete an admin (Lead only; frees the email for reuse). */
router.delete('/admins/:id', requireLead, async (req, res, next) => {
  try {
    const target = await prisma.user.findFirst({
      where: { id: req.params.id, role: 'admin', deletedAt: null },
    });
    if (!target) return res.status(404).json({ error: 'Admin not found' });
    if (target.isLead) return res.status(400).json({ error: 'The Admin Lead account cannot be deleted' });
    if (target.id === req.user.id) return res.status(400).json({ error: 'You cannot delete your own account' });
    await hardDeleteUser(target.id, req.user.id);
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

/** Team activity: login status + working time of admins and employees (Lead only). */
router.get('/activity', requireLead, async (req, res, next) => {
  try {
    const team = await prisma.user.findMany({
      where: { role: { in: ['admin', 'employee'] }, deletedAt: null },
      select: { id: true, fullName: true, role: true, designation: true, isActive: true, isLead: true, lastLoginAt: true },
      orderBy: [{ role: 'asc' }, { createdAt: 'asc' }],
    });
    const activity = await activitySummary(team.map((t) => t.id), {
      weekStart: new Date(Date.now() - 7 * 86400000),
      dayStart: dateOnly(todayISO()),
    });
    res.json({ team: team.map((t) => ({ ...t, activity: activity[t.id] })) });
  } catch (err) {
    next(err);
  }
});

// Manual trigger for the Daily Pulse (also runs nightly via cron).
router.post('/daily-pulse/run', async (req, res, next) => {
  try {
    const result = await runDailyPulse();
    res.json(result);
  } catch (err) {
    next(err);
  }
});

export default router;
