import { prisma } from './prisma.js';
import { dateOnly } from '../utils/dates.js';
import {
  addDays,
  buildExtensionRanges,
  deriveMonthRanges,
  validateMonthRanges,
} from './packageTracking.js';

const iso = (value) => (value instanceof Date ? value : new Date(value)).toISOString().slice(0, 10);

/** Stored months for a client, oldest first. Empty for a client never edited. */
export function listPackageMonths(clientId, tx = prisma) {
  return tx.packageMonth.findMany({ where: { clientId }, orderBy: { monthIndex: 'asc' } });
}

/** Stored months for several clients at once, keyed by client id (list screens). */
export async function listPackageMonthsByClient(clientIds) {
  if (!clientIds.length) return new Map();
  const rows = await prisma.packageMonth.findMany({
    where: { clientId: { in: clientIds } },
    orderBy: [{ clientId: 'asc' }, { monthIndex: 'asc' }],
  });
  const byClient = new Map();
  for (const row of rows) {
    if (!byClient.has(row.clientId)) byClient.set(row.clientId, []);
    byClient.get(row.clientId).push(row);
  }
  return byClient;
}

export function toRanges(rows) {
  return rows.map((row) => ({
    monthIndex: row.monthIndex,
    startDate: iso(row.startDate),
    endDate: iso(row.endDate),
  }));
}

/**
 * Serialise every writer for one client.
 *
 * A write is "delete all this client's months, then recreate them", so two
 * concurrent writers (two admins, a double-clicked Save, or Save racing the
 * package form) would each delete the set they saw and then collide on the
 * (client_id, month_index) unique index — one request 500s and one edit is lost.
 * A transaction-scoped advisory lock makes the second writer wait and then work
 * from the first one's result. It is released automatically when the
 * transaction ends, including on rollback.
 */
function withClientLock(clientId, run) {
  return prisma.$transaction(async (tx) => {
    // `$executeRaw`, not `$queryRaw`: the lock function returns void, which the
    // query path cannot deserialize into a row.
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${clientId}::text, 0))`;
    return run(tx);
  });
}

/** Seed a client's months from the legacy start/expiry pair. Caller holds the lock. */
async function ensureRanges(profile, tx) {
  const existing = await listPackageMonths(profile.id, tx);
  if (existing.length) return toRanges(existing);
  const ranges = deriveMonthRanges(profile.packageStartedAt, profile.expiryDate);
  await tx.packageMonth.createMany({
    data: ranges.map((range) => ({
      clientId: profile.id,
      monthIndex: range.monthIndex,
      startDate: dateOnly(range.startDate),
      endDate: dateOnly(range.endDate),
    })),
  });
  return ranges;
}

/**
 * Guarantee that a client has real `package_months` rows, seeding them from the
 * legacy start/expiry pair the first time. Read paths do NOT call this, which
 * keeps GETs side-effect free (they fall back to the same derivation).
 */
export async function ensurePackageMonths(profile) {
  await withClientLock(profile.id, (tx) => ensureRanges(profile, tx));
  return listPackageMonths(profile.id);
}

/** Replace the stored set. Caller holds the lock and has already validated. */
async function writeRanges(clientId, ranges, tx) {
  const ordered = [...ranges]
    .sort((a, b) => (a.startDate < b.startDate ? -1 : a.startDate > b.startDate ? 1 : 0))
    .map((range, i) => ({ ...range, monthIndex: i + 1 }));

  await tx.packageMonth.deleteMany({ where: { clientId } });
  await tx.packageMonth.createMany({
    data: ordered.map((range) => ({
      clientId,
      monthIndex: range.monthIndex,
      startDate: dateOnly(range.startDate),
      endDate: dateOnly(range.endDate),
    })),
  });
  // The profile columns mirror the first and last month, so everything that
  // still reads them (expiry banners, the Daily Pulse, client lists) follows.
  await tx.clientProfile.update({
    where: { id: clientId },
    data: {
      packageStartedAt: dateOnly(ordered[0].startDate),
      expiryDate: dateOnly(ordered[ordered.length - 1].endDate),
    },
  });
  return listPackageMonths(clientId, tx);
}

/**
 * Re-shape a set of months so the package starts and ends on the given dates.
 *
 * This is what the Package & Assignment form's two date fields mean now that
 * months are stored. Moving the expiry later APPENDS whole months (as an
 * extension would) rather than stretching the final month into a 92-day
 * "Month 2"; moving it earlier drops the months that now fall outside and trims
 * the last surviving one. Without this the form silently corrupted every
 * per-month count, and shortening a package failed outright.
 */
export function applyPackageBoundaries(ranges, { startDate, expiryDate }) {
  let next = ranges.map((range) => ({ ...range }));

  if (startDate) {
    if (next.length > 1 && startDate > next[1].startDate) {
      return { error: 'The package start date must be before Month 2 begins. Edit the months individually instead.' };
    }
    if (startDate > next[0].endDate) {
      return { error: `The package start date cannot be after Month 1 ends (${next[0].endDate}).` };
    }
    next[0] = { ...next[0], startDate };
  }

  if (expiryDate) {
    if (expiryDate < next[0].startDate) {
      return { error: `The package end date cannot be before the package starts (${next[0].startDate}).` };
    }
    // Shorter: drop whole months that now fall outside, trim the last survivor.
    next = next.filter((range) => range.startDate <= expiryDate);
    const last = next[next.length - 1];
    if (last.endDate > expiryDate) last.endDate = expiryDate;

    // Longer: append whole months until the new expiry is covered.
    while (next[next.length - 1].endDate < expiryDate) {
      const previousEnd = next[next.length - 1].endDate;
      const [added] = buildExtensionRanges(previousEnd, next.length + 1, 1);
      if (added.endDate > expiryDate) added.endDate = expiryDate;
      // Defensive: a month that cannot advance would loop forever.
      if (added.endDate <= previousEnd) break;
      next.push(added);
    }
  }

  return { ranges: next.map((range, i) => ({ ...range, monthIndex: i + 1 })) };
}

/** Validate then persist a full set of admin-edited months. */
export async function savePackageMonths(profile, ranges) {
  return withClientLock(profile.id, async (tx) => {
    const existing = await ensureRanges(profile, tx);
    // A stale tab must never silently delete months another admin added; the
    // delete endpoint is the only way to remove one.
    if (ranges.length < existing.length) {
      return {
        error: `This client now has ${existing.length} package months but only ${ranges.length} were submitted. Reload the page before saving — use "Delete month" to remove one.`,
      };
    }
    const problem = validateMonthRanges(ranges);
    if (problem) return { error: problem };
    const rows = await writeRanges(profile.id, ranges, tx);
    return { rows, packageMonths: rows.length };
  });
}

/** Move the package's own start/end, re-shaping the months to match. */
export async function savePackageBoundaries(profile, { startDate, expiryDate }) {
  return withClientLock(profile.id, async (tx) => {
    const existing = await ensureRanges(profile, tx);
    const shaped = applyPackageBoundaries(existing, { startDate, expiryDate });
    if (shaped.error) return { error: shaped.error };
    const problem = validateMonthRanges(shaped.ranges);
    if (problem) return { error: problem };
    const rows = await writeRanges(profile.id, shaped.ranges, tx);
    return { rows, packageMonths: rows.length };
  });
}

/** Append `months` pre-filled periods after the client's current last month. */
export async function extendPackageMonths(profile, months) {
  return withClientLock(profile.id, async (tx) => {
    const existing = await ensureRanges(profile, tx);
    const last = existing[existing.length - 1];
    const added = buildExtensionRanges(last.endDate, last.monthIndex + 1, months);
    const ranges = [...existing, ...added];
    // Legacy rows can be malformed (an expiry recorded before the start), and
    // an extension must not persist that — or the client ends up permanently
    // "expired" with the request reporting success.
    const problem = validateMonthRanges(ranges);
    if (problem) {
      return { error: `This client's existing package months are inconsistent (${problem}). Correct them under Package Months before extending.` };
    }
    const rows = await writeRanges(profile.id, ranges, tx);
    return {
      rows,
      added,
      previousExpiryDate: last.endDate,
      expiryDate: added[added.length - 1].endDate,
      packageMonths: rows.length,
    };
  });
}

/** Remove one month (e.g. an extension added by mistake) and renumber the rest. */
export async function deletePackageMonth(profile, monthIndex) {
  return withClientLock(profile.id, async (tx) => {
    const existing = await ensureRanges(profile, tx);
    if (existing.length <= 1) {
      return { error: 'A package must keep at least one month. Change its dates instead of deleting it.' };
    }
    const remaining = existing.filter((range) => range.monthIndex !== monthIndex);
    if (remaining.length === existing.length) return { error: 'Package month not found' };
    const rows = await writeRanges(profile.id, remaining, tx);
    return { rows, packageMonths: rows.length, expiryDate: iso(rows[rows.length - 1].endDate) };
  });
}

export { addDays };
