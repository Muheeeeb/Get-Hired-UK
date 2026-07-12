import { Router } from 'express';
import bcrypt from 'bcryptjs';
import crypto from 'node:crypto';
import { z } from 'zod';
import rateLimit from 'express-rate-limit';
import { prisma } from '../lib/prisma.js';
import { validate } from '../middleware/validate.js';
import { authenticate } from '../middleware/auth.js';
import {
  signAccessToken,
  issueRefreshToken,
  rotateRefreshToken,
  revokeRefreshToken,
  refreshCookieOptions,
} from '../lib/tokens.js';
import { sendMail, brandedEmail } from '../lib/mailer.js';
import { env } from '../config/env.js';

const router = Router();

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  message: { error: 'Too many login attempts. Please try again in 15 minutes.' },
});

const loginSchema = z.object({
  email: z.string().email().max(254),
  password: z.string().min(1).max(200),
});

router.post('/login', loginLimiter, validate(loginSchema), async (req, res, next) => {
  try {
    const { email, password } = req.body;
    const user = await prisma.user.findUnique({ where: { email: email.toLowerCase() } });
    const valid = user && !user.deletedAt && (await bcrypt.compare(password, user.passwordHash));
    if (!valid) return res.status(401).json({ error: 'Invalid email or password' });
    if (user.approvalStatus === 'pending') {
      return res.status(403).json({
        error: 'Your account is awaiting admin approval. We will email you once it is activated.',
        code: 'PENDING_APPROVAL',
      });
    }
    if (user.approvalStatus === 'rejected') {
      return res.status(403).json({
        error: 'Your sign-up request was not approved. Please contact Career@gethired.world.',
        code: 'REJECTED',
      });
    }
    if (!user.isActive) return res.status(403).json({ error: 'This account has been deactivated' });

    await prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });
    const accessToken = signAccessToken(user);
    const { raw: refreshToken } = await issueRefreshToken(user.id);

    res.cookie('refresh_token', refreshToken, refreshCookieOptions);
    res.json({
      accessToken,
      user: { id: user.id, fullName: user.fullName, email: user.email, role: user.role },
    });
  } catch (err) {
    next(err);
  }
});

// ---------- public client self-registration ----------

const signupLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 5,
  legacyHeaders: false,
  message: { error: 'Too many sign-up attempts — please try again later.' },
});

const signupSchema = z.object({
  fullName: z.string().min(2, 'Please enter your full name').max(120),
  email: z.string().email('Please enter a valid email').max(254),
  password: z.string().min(10, 'Password must be at least 10 characters').max(200),
  phone: z.string().max(40).optional().or(z.literal('')),
  note: z.string().max(2000).optional().or(z.literal('')),
});

/**
 * Client self-registration. Creates a PENDING client account — it cannot sign in
 * until an admin approves it (and provisions their package/domains at that point).
 */
router.post('/signup', signupLimiter, validate(signupSchema), async (req, res, next) => {
  try {
    const { fullName, email, password, phone, note } = req.body;
    const lower = email.toLowerCase();
    const existing = await prisma.user.findUnique({ where: { email: lower } });
    if (existing) {
      // Do not reveal account state; guide them to sign in / reset instead.
      return res.status(409).json({
        error: 'An account with this email already exists. Try signing in or resetting your password.',
      });
    }

    await prisma.user.create({
      data: {
        fullName,
        email: lower,
        passwordHash: await bcrypt.hash(password, 12),
        role: 'client',
        approvalStatus: 'pending',
        phone: phone || null,
        signupNote: note || null,
      },
    });

    // Notify the office; never fail the request if mail transport is down.
    sendMail({
      to: env.officeEmail,
      subject: `New client sign-up awaiting approval — ${fullName}`,
      html: brandedEmail({
        heading: 'New Sign-up Request',
        bodyHtml: `
          <p><strong>${fullName}</strong> &lt;${lower}&gt;${phone ? ` · ${phone}` : ''}</p>
          ${note ? `<p>${String(note).replace(/</g, '&lt;')}</p>` : ''}
          <p>Review and approve in the admin portal → Sign-ups.</p>`,
      }),
      text: `New sign-up: ${fullName} <${lower}> ${phone || ''}`,
    }).catch((err) => console.error('[signup] office notification failed:', err.message));

    res.status(201).json({
      ok: true,
      message: 'Thanks for registering! Your account is awaiting approval — we will email you once it is activated.',
    });
  } catch (err) {
    next(err);
  }
});

router.post('/refresh', async (req, res, next) => {
  try {
    const raw = req.cookies?.refresh_token;
    if (!raw) return res.status(401).json({ error: 'No refresh token' });

    const rotated = await rotateRefreshToken(raw);
    if (!rotated) {
      res.clearCookie('refresh_token', { ...refreshCookieOptions, maxAge: undefined });
      return res.status(401).json({ error: 'Invalid refresh token' });
    }

    const user = await prisma.user.findUnique({ where: { id: rotated.userId } });
    if (!user || !user.isActive || user.deletedAt) {
      return res.status(401).json({ error: 'Account is not active' });
    }

    res.cookie('refresh_token', rotated.raw, refreshCookieOptions);
    res.json({
      accessToken: signAccessToken(user),
      user: { id: user.id, fullName: user.fullName, email: user.email, role: user.role },
    });
  } catch (err) {
    next(err);
  }
});

router.post('/logout', async (req, res, next) => {
  try {
    await revokeRefreshToken(req.cookies?.refresh_token);
    res.clearCookie('refresh_token', { ...refreshCookieOptions, maxAge: undefined });
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

router.get('/me', authenticate, (req, res) => {
  const { id, fullName, email, role } = req.user;
  res.json({ user: { id, fullName, email, role } });
});

router.post(
  '/change-password',
  authenticate,
  validate(
    z.object({
      currentPassword: z.string().min(1).max(200),
      newPassword: z.string().min(10, 'Password must be at least 10 characters').max(200),
    })
  ),
  async (req, res, next) => {
    try {
      const ok = await bcrypt.compare(req.body.currentPassword, req.user.passwordHash);
      if (!ok) return res.status(400).json({ error: 'Current password is incorrect' });
      const passwordHash = await bcrypt.hash(req.body.newPassword, 12);
      await prisma.$transaction([
        prisma.user.update({ where: { id: req.user.id }, data: { passwordHash } }),
        // Sign out every other session.
        prisma.refreshToken.updateMany({
          where: { userId: req.user.id, revokedAt: null },
          data: { revokedAt: new Date() },
        }),
      ]);
      const { raw: refreshToken } = await issueRefreshToken(req.user.id);
      res.cookie('refresh_token', refreshToken, refreshCookieOptions);
      res.json({ ok: true });
    } catch (err) {
      next(err);
    }
  }
);

const forgotLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 5, legacyHeaders: false });

router.post(
  '/forgot-password',
  forgotLimiter,
  validate(z.object({ email: z.string().email() })),
  async (req, res, next) => {
    try {
      const user = await prisma.user.findUnique({
        where: { email: req.body.email.toLowerCase() },
      });
      // Always 200 — never reveal whether the account exists.
      if (user && user.isActive && !user.deletedAt) {
        const raw = crypto.randomBytes(32).toString('base64url');
        await prisma.passwordResetToken.create({
          data: {
            userId: user.id,
            tokenHash: crypto.createHash('sha256').update(raw).digest('hex'),
            expiresAt: new Date(Date.now() + 30 * 60 * 1000),
          },
        });
        const url = `${env.clientOrigin}/reset-password?token=${raw}`;
        await sendMail({
          to: user.email,
          subject: 'Reset your Get Hired UK password',
          html: brandedEmail({
            heading: 'Password Reset',
            bodyHtml: `<p>Hi ${user.fullName},</p><p>We received a request to reset your password. This link expires in 30 minutes.</p>`,
            ctaLabel: 'Reset Password',
            ctaUrl: url,
          }),
          text: `Reset your password: ${url}`,
        });
      }
      res.json({ ok: true, message: 'If that account exists, a reset link has been sent.' });
    } catch (err) {
      next(err);
    }
  }
);

router.post(
  '/reset-password',
  validate(
    z.object({
      token: z.string().min(20),
      password: z.string().min(10, 'Password must be at least 10 characters').max(200),
    })
  ),
  async (req, res, next) => {
    try {
      const tokenHash = crypto.createHash('sha256').update(req.body.token).digest('hex');
      const record = await prisma.passwordResetToken.findUnique({ where: { tokenHash } });
      if (!record || record.usedAt || record.expiresAt < new Date()) {
        return res.status(400).json({ error: 'Invalid or expired reset link' });
      }
      const passwordHash = await bcrypt.hash(req.body.password, 12);
      await prisma.$transaction([
        prisma.user.update({ where: { id: record.userId }, data: { passwordHash } }),
        prisma.passwordResetToken.update({
          where: { id: record.id },
          data: { usedAt: new Date() },
        }),
        // Force re-login everywhere after a password change.
        prisma.refreshToken.updateMany({
          where: { userId: record.userId, revokedAt: null },
          data: { revokedAt: new Date() },
        }),
      ]);
      res.json({ ok: true });
    } catch (err) {
      next(err);
    }
  }
);

export default router;
