import cron from 'node-cron';
import { prisma } from '../lib/prisma.js';
import { sendMail, brandedEmail } from '../lib/mailer.js';
import { env } from '../config/env.js';
import { todayISO, dateOnly } from '../utils/dates.js';

/**
 * The Daily Pulse: every evening, email each active client how many jobs we
 * applied to for them today. Idempotent — the (clientId, sentDate) unique
 * constraint plus an upfront check prevents duplicate sends.
 */
export async function runDailyPulse() {
  const iso = todayISO();
  const today = dateOnly(iso);

  const clients = await prisma.clientProfile.findMany({
    where: {
      user: { isActive: true, deletedAt: null },
      expiryDate: { gte: today }, // don't pulse expired packages
    },
    include: { user: { select: { fullName: true, email: true } } },
  });

  let sent = 0;
  let skipped = 0;

  for (const client of clients) {
    const already = await prisma.dailyPulseLog.findUnique({
      where: { clientId_sentDate: { clientId: client.id, sentDate: today } },
    });
    if (already) {
      skipped++;
      continue;
    }

    const jobCount = await prisma.jobApplication.count({
      where: { clientId: client.id, applicationDate: today },
    });

    if (jobCount === 0 && !env.pulse.sendZero) {
      skipped++;
      continue;
    }

    const firstName = client.user.fullName.split(' ')[0];
    const subject =
      jobCount > 0
        ? `We applied for ${jobCount} job${jobCount === 1 ? '' : 's'} for you today! 🎯`
        : `Your next batch is being lined up ✨`;
    const bodyHtml =
      jobCount > 0
        ? `<p>Hi ${firstName},</p>
           <p>Great news — our team applied for <strong style="color:#C9A227;">${jobCount} job${jobCount === 1 ? '' : 's'}</strong> on your behalf today. Every application was tailored specifically for the role.</p>
           <p>Log in to your dashboard to see exactly where we applied.</p>`
        : `<p>Hi ${firstName},</p>
           <p>Our team is lining up your next batch of applications. We hand-pick every role to match your profile — quality over quantity, always.</p>`;

    try {
      await sendMail({
        to: client.user.email,
        subject,
        html: brandedEmail({
          heading: jobCount > 0 ? `${jobCount} Applications Today` : 'Momentum Building',
          bodyHtml,
          ctaLabel: 'View My Dashboard',
          ctaUrl: env.clientOrigin,
        }),
        text: subject,
      });
      await prisma.dailyPulseLog.create({
        data: { clientId: client.id, sentDate: today, jobCountSent: jobCount },
      });
      sent++;
    } catch (err) {
      // Unique-violation means another process already sent it — safe to ignore.
      if (err.code === 'P2002') {
        skipped++;
      } else {
        console.error(`[pulse] failed for ${client.user.email}:`, err.message);
      }
    }
  }

  const result = { date: iso, sent, skipped, totalClients: clients.length };
  console.log('[pulse]', JSON.stringify(result));
  return result;
}

export function scheduleDailyPulse() {
  cron.schedule(env.pulse.cron, runDailyPulse, { timezone: env.pulse.timezone });
  console.log(`[pulse] scheduled "${env.pulse.cron}" (${env.pulse.timezone})`);
}
