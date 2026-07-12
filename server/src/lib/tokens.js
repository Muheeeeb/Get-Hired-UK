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
 * (www.gethired.uk + api.gethired.uk) keep the default "lax".
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
