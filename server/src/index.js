import { env } from './config/env.js';
import { createApp } from './app.js';
import { scheduleDailyPulse } from './jobs/dailyPulse.js';
import { prisma } from './lib/prisma.js';

const app = createApp();

// Ensure exactly one Admin Lead exists: promote the earliest admin if none is flagged.
async function ensureAdminLead() {
  try {
    const lead = await prisma.user.findFirst({ where: { role: 'admin', isLead: true, deletedAt: null } });
    if (!lead) {
      const first = await prisma.user.findFirst({
        where: { role: 'admin', deletedAt: null },
        orderBy: { createdAt: 'asc' },
      });
      if (first) {
        await prisma.user.update({ where: { id: first.id }, data: { isLead: true } });
        console.log(`[boot] Admin Lead set: ${first.email}`);
      }
    }
  } catch (err) {
    console.error('[boot] ensureAdminLead failed:', err.message);
  }
}
ensureAdminLead();

// Behind a reverse proxy (Caddy/nginx) bind to loopback only, so the Node
// process is never reachable directly from the internet. Set HOST=0.0.0.0 to
// override (e.g. in a container where the proxy is on another host).
const host = process.env.HOST || (env.isProd ? '127.0.0.1' : '0.0.0.0');

app.listen(env.port, host, () => {
  console.log(`[server] Get Hired UK API on ${host}:${env.port} (${env.nodeEnv})`);
  scheduleDailyPulse();
});
