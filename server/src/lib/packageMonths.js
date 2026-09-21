import { prisma } from './prisma.js';
import { dateOnly } from '../utils/dates.js';
import {
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

/**
 * Guarantee that a client has real `package_months` rows, seeding them from the
 * legacy start/expiry pair the first time. Every write path calls this first, so
 * an admin edit always has concrete months to act on; read paths do NOT, which
 * keeps GETs side-effect free (they fall back to the same derivation).
 */
export async function ensurePackageMonths(profile, tx = prisma) {
  const existing = await listPackageMonths(profile.id, tx);
  if (existing.length) return existing;
  const ranges = deriveMonthRanges(profile.packageStartedAt, profile.expiryDate);
  await tx.packageMonth.createMany({
    data: ranges.map((range) => ({
      clientId: profile.id,
      monthIndex: range.monthIndex,
      startDate: dateOnly(range.startDate),
      endDate: dateOnly(range.endDate),
    })),
  });
  return listPackageMonths(profile.id, tx);
}

/**
 * Replace a client's months with `ranges` (1-based, already validated) and keep
 * the profile's own start/expiry columns mirroring Month 1 and the last month —
 * everything that still reads those two columns (emails, expiry banners, the
 * daily pulse) therefore follows the edited dates automatically.
 */
export async function writePackageMonths(clientId, ranges) {
  const ordered = [...ranges]
    .sort((a, b) => (a.startDate < b.startDate ? -1 : a.startDate > b.startDate ? 1 : 0))
    .map((range, i) => ({ ...range, monthIndex: i + 1 }));

  return prisma.$transaction(async (tx) => {
    await tx.packageMonth.deleteMany({ where: { clientId } });
    await tx.packageMonth.createMany({
      data: ordered.map((range) => ({
        clientId,
        monthIndex: range.monthIndex,
        startDate: dateOnly(range.startDate),
        endDate: dateOnly(range.endDate),
      })),
    });
    await tx.clientProfile.update({
      where: { id: clientId },
      data: {
        packageStartedAt: dateOnly(ordered[0].startDate),
        expiryDate: dateOnly(ordered[ordered.length - 1].endDate),
      },
    });
    return listPackageMonths(clientId, tx);
  });
}

export function toRanges(rows) {
  return rows.map((row) => ({
    monthIndex: row.monthIndex,
    startDate: iso(row.startDate),
    endDate: iso(row.endDate),
  }));
}

/** Append `months` pre-filled periods after the client's current last month. */
export async function extendPackageMonths(profile, months) {
  const existing = toRanges(await ensurePackageMonths(profile));
  const last = existing[existing.length - 1];
  const added = buildExtensionRanges(last.endDate, last.monthIndex + 1, months);
  const rows = await writePackageMonths(profile.id, [...existing, ...added]);
  return {
    rows,
    added,
    previousExpiryDate: last.endDate,
    expiryDate: added[added.length - 1].endDate,
    packageMonths: rows.length,
  };
}

/** Remove one month (e.g. an extension added by mistake) and renumber the rest. */
export async function deletePackageMonth(profile, monthIndex) {
  const existing = toRanges(await ensurePackageMonths(profile));
  if (existing.length <= 1) {
    return { error: 'A package must keep at least one month. Change its dates instead of deleting it.' };
  }
  const remaining = existing.filter((range) => range.monthIndex !== monthIndex);
  if (remaining.length === existing.length) return { error: 'Package month not found' };
  const rows = await writePackageMonths(profile.id, remaining);
  return { rows, packageMonths: rows.length, expiryDate: iso(rows[rows.length - 1].endDate) };
}

/** Validate then persist a full set of admin-edited months. */
export async function savePackageMonths(profile, ranges) {
  const problem = validateMonthRanges(ranges);
  if (problem) return { error: problem };
  await ensurePackageMonths(profile);
  const rows = await writePackageMonths(profile.id, ranges);
  return { rows, packageMonths: rows.length };
}
