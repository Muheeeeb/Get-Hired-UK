import crypto from 'node:crypto';
import { env } from '../config/env.js';

/**
 * Reversible encryption for third-party logins (email, LinkedIn, Indeed, NHS Jobs)
 * that the team uses to apply on a client's behalf.
 *
 * These CANNOT be hashed like account passwords — someone has to sign in as the
 * client, so the plaintext must be recoverable. AES-256-GCM is used so the stored
 * value is both unreadable and tamper-evident: decryption fails if the ciphertext
 * was altered. The key lives only in the environment, never in the database, so a
 * stolen dump or backup is useless on its own.
 *
 * Fails closed: with no key configured, storing a secret throws rather than
 * silently writing plaintext.
 */

const ALGO = 'aes-256-gcm';

function key() {
  const raw = env.credentialsEncKey;
  if (!raw) {
    const err = new Error(
      'Credential storage is not configured (set CREDENTIALS_ENC_KEY in server/.env)'
    );
    err.status = 503;
    throw err;
  }
  // Accept base64 or hex; must decode to exactly 32 bytes for AES-256.
  const buf = /^[0-9a-f]{64}$/i.test(raw) ? Buffer.from(raw, 'hex') : Buffer.from(raw, 'base64');
  if (buf.length !== 32) {
    const err = new Error('CREDENTIALS_ENC_KEY must decode to 32 bytes (use: openssl rand -base64 32)');
    err.status = 500;
    throw err;
  }
  return buf;
}

/** True when the server can store/read credentials at all. */
export function credentialsEnabled() {
  try { key(); return true; } catch { return false; }
}

/** Returns "v1.<iv>.<authTag>.<ciphertext>", all base64url. */
export function encryptSecret(plain) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(ALGO, key(), iv);
  const enc = Buffer.concat([cipher.update(String(plain), 'utf8'), cipher.final()]);
  return ['v1', iv.toString('base64url'), cipher.getAuthTag().toString('base64url'), enc.toString('base64url')].join('.');
}

export function decryptSecret(stored) {
  const [version, iv, tag, data] = String(stored).split('.');
  if (version !== 'v1' || !iv || !tag || !data) throw new Error('Malformed stored credential');
  const decipher = crypto.createDecipheriv(ALGO, key(), Buffer.from(iv, 'base64url'));
  decipher.setAuthTag(Buffer.from(tag, 'base64url'));
  return Buffer.concat([decipher.update(Buffer.from(data, 'base64url')), decipher.final()]).toString('utf8');
}
