import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import cookieParser from 'cookie-parser';
import { env } from './config/env.js';
import authRoutes from './routes/auth.routes.js';
import adminRoutes from './routes/admin.routes.js';
import employeeRoutes from './routes/employee.routes.js';
import clientsRoutes from './routes/clients.routes.js';
import jobsRoutes from './routes/jobs.routes.js';
import filesRoutes from './routes/files.routes.js';
import aiRoutes from './routes/ai.routes.js';
import interviewRoutes from './routes/interview.routes.js';
import publicRoutes from './routes/public.routes.js';
import { notFound, errorHandler } from './middleware/errorHandler.js';

export function createApp() {
  const app = express();

  app.set('trust proxy', 1);
  app.use(helmet());
  // CLIENT_ORIGIN may list several allowed origins, comma-separated
  // (e.g. "https://www.gethired.world,https://gethired.world").
  const allowedOrigins = env.clientOrigin
    .split(',')
    .map((o) => o.trim())
    .filter(Boolean);
  app.use(
    cors({
      origin(origin, cb) {
        // Same-origin/server-side calls send no Origin header — allow them.
        if (!origin || allowedOrigins.includes(origin)) return cb(null, true);
        return cb(new Error('Not allowed by CORS'));
      },
      credentials: true,
    })
  );
  app.use(express.json({ limit: '1mb' }));
  app.use(cookieParser());
  if (!env.isProd) app.use(morgan('dev'));

  app.get('/health', (req, res) => res.json({ ok: true }));

  app.use('/auth', authRoutes);
  app.use('/admin', adminRoutes);
  app.use('/employee', employeeRoutes);
  app.use('/clients', clientsRoutes);
  app.use('/jobs', jobsRoutes);
  app.use('/files', filesRoutes);
  app.use('/ai', aiRoutes);
  app.use('/interview-resources', interviewRoutes);
  app.use('/public', publicRoutes);

  app.use(notFound);
  app.use(errorHandler);

  return app;
}
