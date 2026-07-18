import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { env } from '../config/env.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const UPLOADS_DIR = path.resolve(__dirname, '../../uploads');

/**
 * Storage abstraction. Two drivers:
 *  - "s3": AWS S3 / Cloudflare R2 via the AWS SDK, presigned GET urls.
 *  - "local": files under ./uploads, served via HMAC-signed expiring URLs.
 * Only file KEYS are stored in Postgres — never blobs.
 */

function safeKeySegment(name) {
  return name.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 120);
}

export function buildFileKey(prefix, originalName) {
  const id = crypto.randomBytes(8).toString('hex');
  return `${prefix}/${id}-${safeKeySegment(originalName)}`;
}

// ---------- local driver ----------

function localSignature(key, expires, name = '') {
  return crypto
    .createHmac('sha256', env.fileUrlSecret)
    .update(`${key}:${expires}:${name}`)
    .digest('base64url');
}

export function verifyLocalSignature(key, expires, sig, name = '') {
  if (!expires || !sig) return false;
  if (Number(expires) < Math.floor(Date.now() / 1000)) return false;
  const expected = localSignature(key, expires, name);
  const a = Buffer.from(expected);
  const b = Buffer.from(String(sig));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

async function localSave(key, buffer) {
  const filePath = path.join(UPLOADS_DIR, key);
  // Prevent path traversal out of the uploads dir.
  if (!filePath.startsWith(UPLOADS_DIR + path.sep)) throw new Error('Invalid file key');
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, buffer);
}

function localSignedUrl(key, fileName = '', inline = false) {
  const expires = Math.floor(Date.now() / 1000) + env.signedUrlTtlSeconds;
  const sig = localSignature(key, expires, fileName);
  const namePart = fileName ? `&name=${encodeURIComponent(fileName)}` : '';
  const inlinePart = inline ? '&inline=1' : '';
  return `${env.appBaseUrl}/files/local/${encodeURIComponent(key)}?expires=${expires}&sig=${sig}${namePart}${inlinePart}`;
}

export function resolveLocalPath(key) {
  const filePath = path.join(UPLOADS_DIR, key);
  if (!filePath.startsWith(UPLOADS_DIR + path.sep)) return null;
  return filePath;
}

// ---------- s3 driver (lazy-loaded so local dev needs no AWS creds) ----------

let s3Client = null;
async function getS3() {
  if (!s3Client) {
    const { S3Client } = await import('@aws-sdk/client-s3');
    s3Client = new S3Client({
      region: env.aws.region,
      ...(env.aws.endpoint ? { endpoint: env.aws.endpoint } : {}),
    });
  }
  return s3Client;
}

async function s3Save(key, buffer, contentType) {
  const { PutObjectCommand } = await import('@aws-sdk/client-s3');
  const client = await getS3();
  await client.send(
    new PutObjectCommand({ Bucket: env.aws.bucket, Key: key, Body: buffer, ContentType: contentType })
  );
}

const INLINE_TYPES = {
  '.pdf': 'application/pdf',
  '.txt': 'text/plain; charset=utf-8',
  '.md': 'text/plain; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
};

/** Browsers can render these inline — "View" opens them instead of downloading. */
export function inlineContentType(name = '') {
  const ext = path.extname(name).toLowerCase();
  return INLINE_TYPES[ext] || null;
}

async function s3SignedUrl(key, fileName = '', inline = false) {
  const { GetObjectCommand } = await import('@aws-sdk/client-s3');
  const { getSignedUrl } = await import('@aws-sdk/s3-request-presigner');
  const client = await getS3();
  const safeName = fileName.replace(/["\\\r\n]/g, '_');
  const contentType = inline ? inlineContentType(fileName || key) : null;
  const command = new GetObjectCommand({
    Bucket: env.aws.bucket,
    Key: key,
    ...(fileName
      ? {
          ResponseContentDisposition: `${contentType ? 'inline' : 'attachment'}; filename="${safeName}"`,
          ...(contentType ? { ResponseContentType: contentType } : {}),
        }
      : {}),
  });
  return getSignedUrl(client, command, { expiresIn: env.signedUrlTtlSeconds });
}

// ---------- public API ----------

export async function saveFile(key, buffer, contentType) {
  if (env.storageDriver === 's3') return s3Save(key, buffer, contentType);
  return localSave(key, buffer);
}

export async function getSignedFileUrl(key, fileName = '', { inline = false } = {}) {
  if (env.storageDriver === 's3') return s3SignedUrl(key, fileName, inline);
  return localSignedUrl(key, fileName, inline);
}

/** Best-effort object removal — callers must not fail their request on error. */
export async function deleteFile(key) {
  try {
    if (env.storageDriver === 's3') {
      const { DeleteObjectCommand } = await import('@aws-sdk/client-s3');
      const client = await getS3();
      await client.send(new DeleteObjectCommand({ Bucket: env.aws.bucket, Key: key }));
    } else {
      const filePath = resolveLocalPath(key);
      if (filePath) await fs.rm(filePath, { force: true });
    }
  } catch (err) {
    console.error(`[storage] failed to delete ${key}:`, err.message);
  }
}

/** Reads file text for the AI assistant (local driver or seed .txt masters only). */
export async function tryReadFileText(key) {
  try {
    if (env.storageDriver === 's3') return null;
    const filePath = resolveLocalPath(key);
    if (!filePath) return null;
    const ext = path.extname(filePath).toLowerCase();
    if (!['.txt', '.md'].includes(ext)) return null;
    return await fs.readFile(filePath, 'utf8');
  } catch {
    return null;
  }
}
