import { env } from '../config/env.js';

export function notFound(req, res) {
  res.status(404).json({ error: 'Not found' });
}

// eslint-disable-next-line no-unused-vars
export function errorHandler(err, req, res, next) {
  if (err.type === 'entity.too.large' || err.code === 'LIMIT_FILE_SIZE') {
    return res.status(413).json({ error: 'File too large (max 10 MB)' });
  }
  if (err.message?.startsWith('Unsupported file type')) {
    return res.status(400).json({ error: err.message });
  }
  // Prisma: malformed id (P2023) or missing record (P2025) → clean 404, no internals.
  if (err.code === 'P2023' || err.code === 'P2025') {
    return res.status(404).json({ error: 'Not found' });
  }
  console.error(`[error] ${req.method} ${req.originalUrl}:`, err.message);
  if (!env.isProd) console.error(err.stack);
  res.status(err.status || 500).json({
    error: env.isProd ? 'Internal server error' : err.message,
  });
}
