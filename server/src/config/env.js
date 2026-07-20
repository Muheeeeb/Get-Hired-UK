import dotenv from 'dotenv';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

function required(name) {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required env var: ${name}`);
  return value;
}

export const env = {
  nodeEnv: process.env.NODE_ENV || 'development',
  isProd: process.env.NODE_ENV === 'production',
  port: Number(process.env.PORT || 4000),
  clientOrigin: process.env.CLIENT_ORIGIN || 'http://localhost:5173',
  // The FIRST origin, used to build user-facing links in emails. CLIENT_ORIGIN
  // may be a comma-separated allowlist for CORS, so never build URLs from the
  // raw value — that produces broken links like "https://a.com,https://b.com/x".
  get primaryClientOrigin() {
    return (process.env.CLIENT_ORIGIN || 'http://localhost:5173').split(',')[0].trim();
  },
  appBaseUrl: process.env.APP_BASE_URL || 'http://localhost:4000',

  databaseUrl: required('DATABASE_URL'),

  jwtAccessSecret: required('JWT_ACCESS_SECRET'),
  jwtRefreshSecret: required('JWT_REFRESH_SECRET'),
  accessTokenTtl: process.env.ACCESS_TOKEN_TTL || '15m',
  refreshTokenTtlDays: Number(process.env.REFRESH_TOKEN_TTL_DAYS || 7),

  storageDriver: process.env.STORAGE_DRIVER || 'local',
  fileUrlSecret: required('FILE_URL_SECRET'),
  signedUrlTtlSeconds: Number(process.env.SIGNED_URL_TTL_SECONDS || 300),
  aws: {
    region: process.env.AWS_REGION,
    bucket: process.env.AWS_S3_BUCKET,
    endpoint: process.env.S3_ENDPOINT || undefined,
  },

  smtp: {
    host: process.env.SMTP_HOST || '',
    port: Number(process.env.SMTP_PORT || 587),
    user: process.env.SMTP_USER || '',
    pass: process.env.SMTP_PASS || '',
    from: process.env.MAIL_FROM || 'Get Hired UK <pulse@gethired.world>',
  },
  // Inbox that receives new sign-up + consultation notifications.
  officeEmail: process.env.OFFICE_EMAIL || 'Career@gethired.world',
  pulse: {
    cron: process.env.PULSE_CRON || '0 18 * * *',
    timezone: process.env.PULSE_TIMEZONE || 'Europe/London',
    sendZero: process.env.PULSE_SEND_ZERO !== 'false',
  },

  // Any OpenAI-compatible provider works (OpenAI, Groq, Together, Fireworks, …).
  aiApiKey: process.env.AI_API_KEY || process.env.OPENAI_API_KEY || '',
  aiBaseUrl: process.env.AI_BASE_URL || undefined,
  aiModel: process.env.AI_MODEL || process.env.OPENAI_MODEL || 'gpt-4o-mini',
  mockAi: process.env.MOCK_AI === 'true',
};
