function isoDate(value) {
  return (value instanceof Date ? value : new Date(value)).toISOString().slice(0, 10);
}

function fromIso(iso) {
  return new Date(`${iso}T00:00:00.000Z`);
}

function addDays(iso, days) {
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

/** Exact before/after values returned by the extension API and shown in the UI. */
export function buildPackageExtension(profile, months) {
  const previousExpiryDate = isoDate(profile.expiryDate);
  const expiryDate = addCalendarMonths(previousExpiryDate, months);
  const tracking = buildPackageMonths({
    packageStartedAt: profile.packageStartedAt,
    expiryDate,
    monthlyJobTarget: profile.monthlyJobTarget,
  });
  return { previousExpiryDate, expiryDate, packageMonths: tracking.totalMonths };
}

/**
 * Split a package into anniversary-based months and count applications in each.
 * Expiry dates are inclusive. A package starting on 3 September has Month 1
 * through 3 October; an extension starts Month 2 on 4 October.
 */
export function buildPackageMonths({ packageStartedAt, expiryDate, monthlyJobTarget, applicationDates = [], today }) {
  const startDate = isoDate(packageStartedAt);
  const expiry = isoDate(expiryDate);
  const todayDate = today ? isoDate(today) : isoDate(new Date());
  const dates = applicationDates.map(isoDate);
  const months = [];

  // 240 months is a safety cap for malformed/legacy data (20 years).
  for (let index = 0; index < 240; index += 1) {
    const periodStart = index === 0 ? startDate : addDays(addCalendarMonths(startDate, index), 1);
    if (periodStart > expiry && months.length) break;
    const anniversaryEnd = addCalendarMonths(startDate, index + 1);
    const endDate = anniversaryEnd < expiry ? anniversaryEnd : expiry;
    const applications = dates.filter((date) => date >= periodStart && date <= endDate).length;
    const current = todayDate >= periodStart && todayDate <= endDate;

    months.push({
      month: index + 1,
      label: `Month ${index + 1}`,
      startDate: periodStart,
      endDate,
      applications,
      target: monthlyJobTarget,
      percent: monthlyJobTarget ? Math.min(100, Math.round((applications / monthlyJobTarget) * 100)) : 0,
      status: current ? 'current' : todayDate < periodStart ? 'upcoming' : 'complete',
    });

    if (endDate === expiry) break;
  }

  // A legacy record whose expiry predates its recorded start still gets one safe period.
  if (!months.length) {
    months.push({
      month: 1, label: 'Month 1', startDate, endDate: expiry, applications: 0,
      target: monthlyJobTarget, percent: 0, status: 'complete',
    });
  }

  const current = months.find((period) => period.status === 'current')
    || (todayDate < startDate ? months[0] : months[months.length - 1]);

  return { months, current, totalMonths: months.length };
}

export function packagePeriodWhere(profile, today) {
  const tracking = buildPackageMonths({
    packageStartedAt: profile.packageStartedAt,
    expiryDate: profile.expiryDate,
    monthlyJobTarget: profile.monthlyJobTarget,
    today,
  });
  return {
    tracking,
    applicationDate: {
      gte: fromIso(tracking.current.startDate),
      lte: fromIso(tracking.current.endDate),
    },
  };
}
