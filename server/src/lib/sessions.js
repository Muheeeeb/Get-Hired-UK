import { prisma } from './prisma.js';

/**
 * Login/working-time tracking.
 * A session row is opened at login; while the user keeps making authenticated
 * requests we bump lastSeenAt (heartbeat). Working time is the sum of
 * (lastSeenAt - loginAt) across sessions, so idle/closed tabs stop counting.
 */

const HEARTBEAT_THROTTLE_MS = 60_000;
// Presence: seen within the last 2 minutes counts as online.
export const ONLINE_WINDOW_MS = 2 * 60_000;

export async function startSession(userId) {
  try {
    await prisma.userSession.create({ data: { userId } });
  } catch (err) {
    console.error('[sessions] start failed:', err.message);
  }
}

export async function heartbeat(userId) {
  try {
    const latest = await prisma.userSession.findFirst({
      where: { userId, logoutAt: null },
      orderBy: { loginAt: 'desc' },
    });
    const now = Date.now();
    if (!latest) {
      await prisma.userSession.create({ data: { userId } });
      return;
    }
    if (now - latest.lastSeenAt.getTime() >= HEARTBEAT_THROTTLE_MS) {
      await prisma.userSession.update({
        where: { id: latest.id },
        data: { lastSeenAt: new Date() },
      });
    }
  } catch (err) {
    console.error('[sessions] heartbeat failed:', err.message);
  }
}

export async function endSession(userId) {
  try {
    const latest = await prisma.userSession.findFirst({
      where: { userId, logoutAt: null },
      orderBy: { loginAt: 'desc' },
    });
    if (latest) {
      await prisma.userSession.update({
        where: { id: latest.id },
        data: { logoutAt: new Date(), lastSeenAt: new Date() },
      });
    }
  } catch (err) {
    console.error('[sessions] end failed:', err.message);
  }
}

function overlapMs(session, from, to) {
  const start = Math.max(session.loginAt.getTime(), from.getTime());
  const end = Math.min(session.lastSeenAt.getTime(), to.getTime());
  return Math.max(0, end - start);
}

/**
 * Activity summary for a set of users:
 * { userId: { online, lastLoginAt, todayMs, weekMs } }
 */
export async function activitySummary(userIds, { weekStart, dayStart }) {
  const now = new Date();
  const sessions = await prisma.userSession.findMany({
    where: { userId: { in: userIds }, lastSeenAt: { gte: weekStart } },
    orderBy: { loginAt: 'asc' },
  });
  const latestLogin = await prisma.userSession.groupBy({
    by: ['userId'],
    where: { userId: { in: userIds } },
    _max: { loginAt: true, lastSeenAt: true },
  });

  const out = {};
  for (const id of userIds) out[id] = { online: false, lastLoginAt: null, todayMs: 0, weekMs: 0 };
  for (const row of latestLogin) {
    const o = out[row.userId];
    o.lastLoginAt = row._max.loginAt;
    o.online = row._max.lastSeenAt && now - row._max.lastSeenAt.getTime() < ONLINE_WINDOW_MS;
  }
  for (const s of sessions) {
    const o = out[s.userId];
    if (!o) continue;
    o.todayMs += overlapMs(s, dayStart, now);
    o.weekMs += overlapMs(s, weekStart, now);
  }
  return out;
}
