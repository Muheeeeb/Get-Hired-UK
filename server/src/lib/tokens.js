import jwt from 'jsonwebtoken';
import crypto from 'node:crypto';
import { env } from '../config/env.js';
import { prisma } from './prisma.js';

export function signAccessToken(user) {
  return jwt.sign(
    { sub: user.id, role: user.role, name: user.fullName },
    env.jwtAccessSecret,
    { expiresIn: env.accessTokenTtl }
  );
}

export function verifyAccessToken(token) {
  return jwt.verify(token, env.jwtAccessSecret);
}

function hashToken(raw) {
  return crypto.createHash('sha256').update(raw).digest('hex');
}

/** Issues an opaque refresh token, stores only its hash. */
export async function issueRefreshToken(userId) {
  const raw = crypto.randomBytes(48).toString('base64url');
  const expiresAt = new Date(Date.now() + env.refreshTokenTtlDays * 24 * 60 * 60 * 1000);
  await prisma.refreshToken.create({
    data: { userId, tokenHash: hashToken(raw), expiresAt },
  });
  return { raw, expiresAt };
}

/**
 * Rotation: validates the presented token, revokes it, and issues a new one.
 * Reuse of a revoked token revokes the whole family (all tokens for the user).
 */
export async function rotateRefreshToken(raw) {
  const record = await prisma.refreshToken.findUnique({ where: { tokenHash: hashToken(raw) } });
  if (!record) return null;
  if (record.revokedAt) {
    // Token reuse detected — revoke everything for this user.
    await prisma.refreshToken.updateMany({
      where: { userId: record.userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    return null;
  }
  if (record.expiresAt < new Date()) return null;

  await prisma.refreshToken.update({
    where: { id: record.id },
    data: { revokedAt: new Date() },
  });
  const next = await issueRefreshToken(record.userId);
  return { userId: record.userId, ...next };
}

export async function revokeRefreshToken(raw) {
  if (!raw) return;
  await prisma.refreshToken.updateMany({
    where: { tokenHash: hashToken(raw), revokedAt: null },
    data: { revokedAt: new Date() },
  });
}

/**
 * COOKIE_SAMESITE=none is required when the SPA and API live on different
 * *sites* (e.g. yourapp.vercel.app + an AWS URL). With a shared custom domain
 * (www.gethired.world + api.gethired.world) keep the default "lax".
 * SameSite=None cookies are only accepted over HTTPS, hence secure: true.
 */
const sameSite = process.env.COOKIE_SAMESITE === 'none' ? 'none' : 'lax';

export const refreshCookieOptions = {
  httpOnly: true,
  sameSite,
  secure: env.isProd || sameSite === 'none',
  path: '/auth',
  maxAge: env.refreshTokenTtlDays * 24 * 60 * 60 * 1000,
};

/**
 * Refresh tokens are scoped per role so the three portals can be signed in at
 * the same time in one browser. Each login writes its own cookie
 * (gh_rt_admin / gh_rt_employee / gh_rt_client / gh_rt_social) instead of a
 * single shared "refresh_token" that logins would overwrite. LEGACY_REFRESH_COOKIE
 * is the old single-cookie name, kept only so sessions created before this change
 * survive one more refresh (then get migrated to the role-scoped name).
 */
export const VALID_PORTAL_ROLES = ['admin', 'employee', 'client', 'social'];
export const LEGACY_REFRESH_COOKIE = 'refresh_token';
export function refreshCookieName(role) {
  const r = VALID_PORTAL_ROLES.includes(role) ? role : 'client';
  return `gh_rt_${r}`;
}
