function isoDate(value) {
  return (value instanceof Date ? value : new Date(value)).toISOString().slice(0, 10);
}

function fromIso(iso) {
  return new Date(`${iso}T00:00:00.000Z`);
}

export function addDays(iso, days) {
  const date = fromIso(iso);
  date.setUTCDate(date.getUTCDate() + days);
  return isoDate(date);
}

/** Add calendar months while clamping month-end dates (31 Jan + 1 month = 28/29 Feb). */
export function addCalendarMonths(value, months) {
  const iso = isoDate(value);
  const source = fromIso(iso);
  const day = source.getUTCDate();
  const sourceLastDay = new Date(Date.UTC(source.getUTCFullYear(), source.getUTCMonth() + 1, 0)).getUTCDate();
  const target = new Date(Date.UTC(source.getUTCFullYear(), source.getUTCMonth() + months, 1));
  const lastDay = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  // Once a package ends on a month's final day, keep subsequent extensions on
  // the final day too (31 Jan → 28 Feb → 31 Mar), instead of drifting to the 28th.
  target.setUTCDate(day === sourceLastDay ? lastDay : Math.min(day, lastDay));
  return isoDate(target);
}

/**
 * Derive anniversary-based month ranges from a start date and an inclusive expiry.
 *
 * This is the LEGACY shape: it is used to seed real `package_months` rows for a
 * client who has never had them edited, and as the read-time fallback for one who
 * still has none. Once rows exist they are the only source of truth — see
 * `buildPackageMonths`.
 */
export function deriveMonthRanges(packageStartedAt, expiryDate) {
  const startDate = isoDate(packageStartedAt);
  const expiry = isoDate(expiryDate);
  const ranges = [];

  // 240 months is a safety cap for malformed/legacy data (20 years). Hitting it
  // means the expiry is implausibly far out; `derivedFullRange` below reports
  // that so a caller can refuse rather than silently shortening the package.
  for (let index = 0; index < MAX_PACKAGE_MONTHS; index += 1) {
    const periodStart = index === 0 ? startDate : addDays(addCalendarMonths(startDate, index), 1);
    if (periodStart > expiry && ranges.length) break;
    const anniversaryEnd = addCalendarMonths(startDate, index + 1);
    const endDate = anniversaryEnd < expiry ? anniversaryEnd : expiry;
    ranges.push({ monthIndex: index + 1, startDate: periodStart, endDate });
    if (endDate === expiry) break;
  }

  // A legacy record whose expiry predates its recorded start still gets one period.
  if (!ranges.length) ranges.push({ monthIndex: 1, startDate, endDate: expiry });

  // Never hand back an inverted range. Legacy rows can hold an expiry recorded
  // before the start (nothing used to check), and persisting that would fail
  // validation on the next edit and mirror an impossible expiry onto the
  // profile — leaving the client permanently "expired".
  for (const range of ranges) {
    if (range.endDate < range.startDate) {
      // Silently moving a stored expiry can un-expire a client, and nobody could
      // explain it afterwards from the record alone.
      console.warn(`[package] clamped an inverted legacy range ${range.startDate}..${range.endDate} for a package starting ${startDate}`);
      range.endDate = range.startDate;
    }
  }
  return ranges;
}

/** True when start→expiry needs more months than a package is allowed to hold. */
export function exceedsMonthLimit(packageStartedAt, expiryDate) {
  const ranges = deriveMonthRanges(packageStartedAt, expiryDate);
  return ranges.length >= MAX_PACKAGE_MONTHS
    && ranges[ranges.length - 1].endDate < isoDate(expiryDate);
}

/** The dates an extension would pre-fill: the day after the last month, one calendar month long. */
export function nextMonthRange(previousEndDate, monthIndex) {
  const startDate = addDays(isoDate(previousEndDate), 1);
  return {
    monthIndex,
    startDate,
    // Inclusive end: 1 Oct + 1 month − 1 day = 31 Oct, so months tile without overlap.
    endDate: addDays(addCalendarMonths(startDate, 1), -1),
  };
}

/** The safety cap on how many months one package may hold (20 years). */
export const MAX_PACKAGE_MONTHS = 240;

/** Pre-filled ranges for `months` extra months appended after `lastEndDate`. */
export function buildExtensionRanges(lastEndDate, firstIndex, months) {
  const ranges = [];
  let cursor = isoDate(lastEndDate);
  for (let i = 0; i < months; i += 1) {
    const range = nextMonthRange(cursor, firstIndex + i);
    ranges.push(range);
    cursor = range.endDate;
  }
  return ranges;
}

/**
 * Reject overlapping or inverted periods. Gaps between months are allowed on
 * purpose — a client can pause and resume — but two months may never claim the
 * same day, or an application could be counted twice.
 */
export function validateMonthRanges(ranges) {
  if (!ranges.length) return 'At least one package month is required';
  const indices = new Set(ranges.map((range) => range.monthIndex));
  if (indices.size !== ranges.length) return 'The same package month was submitted twice';
  const sorted = [...ranges].sort((a, b) => a.monthIndex - b.monthIndex);
  for (const range of sorted) {
    if (range.endDate < range.startDate) {
      return `Month ${range.monthIndex}: the end date cannot be before the start date`;
    }
  }
  for (let i = 1; i < sorted.length; i += 1) {
    if (sorted[i].startDate <= sorted[i - 1].endDate) {
      return `Month ${sorted[i].monthIndex} starts on or before Month ${sorted[i - 1].monthIndex} ends — package months cannot overlap`;
    }
  }
  return null;
}

/** Exact before/after values returned by the extension API and shown in the UI. */
export function buildPackageExtension(profile, months, storedRanges = null) {
  const ranges = storedRanges?.length
    ? storedRanges.map((m) => ({ monthIndex: m.monthIndex, startDate: isoDate(m.startDate), endDate: isoDate(m.endDate) }))
    : deriveMonthRanges(profile.packageStartedAt, profile.expiryDate);
  const last = ranges[ranges.length - 1];
  const added = buildExtensionRanges(last.endDate, last.monthIndex + 1, months);
  return {
    previousExpiryDate: last.endDate,
    expiryDate: added[added.length - 1].endDate,
    packageMonths: ranges.length + added.length,
    added,
  };
}

/**
 * Split a package into months and count the applications inside each.
 *
 * Pass `storedMonths` (rows from `package_months`) to use the admin-edited dates;
 * without them the anniversary derivation from `packageStartedAt`/`expiryDate` is
 * used, so a client who has never been edited still tracks exactly as before.
 * Expiry dates are inclusive.
 */
export function buildPackageMonths({
  packageStartedAt, expiryDate, monthlyJobTarget, applicationDates = [], today, storedMonths = null,
}) {
  const todayDate = today ? isoDate(today) : isoDate(new Date());
  const dates = applicationDates.map(isoDate);

  const ranges = storedMonths?.length
    ? [...storedMonths]
        .map((m) => ({ monthIndex: m.monthIndex, startDate: isoDate(m.startDate), endDate: isoDate(m.endDate) }))
        .sort((a, b) => a.monthIndex - b.monthIndex)
    : deriveMonthRanges(packageStartedAt, expiryDate);

  const months = ranges.map((range, position) => {
    const applications = dates.filter((date) => date >= range.startDate && date <= range.endDate).length;
    const current = todayDate >= range.startDate && todayDate <= range.endDate;
    return {
      month: range.monthIndex,
      // `label` follows the stored index so renumbering after a delete is visible everywhere.
      label: `Month ${range.monthIndex}`,
      position,
      startDate: range.startDate,
      endDate: range.endDate,
      applications,
      target: monthlyJobTarget,
      percent: monthlyJobTarget ? Math.min(100, Math.round((applications / monthlyJobTarget) * 100)) : 0,
      status: current ? 'current' : todayDate < range.startDate ? 'upcoming' : 'complete',
    };
  });

  // Between two months (a deliberate gap) there is no "current" period, so fall
  // back to the next one starting — that is the month work is heading into.
  // `inGap` is exposed because callers must not present that month as if it were
  // running: work logged today belongs to no month at all, by design.
  const active = months.find((period) => period.status === 'current');
  const current = active
    || months.find((period) => period.status === 'upcoming')
    || months[months.length - 1];
  const inGap = !active && todayDate >= months[0].startDate && todayDate <= months[months.length - 1].endDate;
  const next = months.find((period) => period.month > current.month) || null;
  const applied = dates.length;

  return {
    months,
    current,
    next,
    inGap,
    totalMonths: months.length,
    startDate: months[0].startDate,
    expiryDate: months[months.length - 1].endDate,
    // Counts the whole package, for the "all time" headline.
    totalApplications: applied,
    appliedToday: dates.filter((date) => date === todayDate).length,
  };
}

export function packagePeriodWhere(profile, today, storedMonths = null) {
  const tracking = buildPackageMonths({
    packageStartedAt: profile.packageStartedAt,
    expiryDate: profile.expiryDate,
    monthlyJobTarget: profile.monthlyJobTarget,
    today,
    storedMonths,
  });
  return {
    tracking,
    applicationDate: {
      gte: fromIso(tracking.current.startDate),
      lte: fromIso(tracking.current.endDate),
    },
  };
}
