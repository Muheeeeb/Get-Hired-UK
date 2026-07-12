import { env } from './config/env.js';
import { createApp } from './app.js';
import { scheduleDailyPulse } from './jobs/dailyPulse.js';

const app = createApp();

app.listen(env.port, () => {
  console.log(`[server] Get Hired UK API on http://localhost:${env.port} (${env.nodeEnv})`);
  scheduleDailyPulse();
});
