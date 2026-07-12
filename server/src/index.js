import { env } from './config/env.js';
import { createApp } from './app.js';
import { scheduleDailyPulse } from './jobs/dailyPulse.js';

const app = createApp();

// Behind a reverse proxy (Caddy/nginx) bind to loopback only, so the Node
// process is never reachable directly from the internet. Set HOST=0.0.0.0 to
// override (e.g. in a container where the proxy is on another host).
const host = process.env.HOST || (env.isProd ? '127.0.0.1' : '0.0.0.0');

app.listen(env.port, host, () => {
  console.log(`[server] Get Hired UK API on ${host}:${env.port} (${env.nodeEnv})`);
  scheduleDailyPulse();
});
