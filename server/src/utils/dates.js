import { env } from '../config/env.js';

/** Returns 'YYYY-MM-DD' for "today" in the business timezone (Europe/London). */
export function todayISO() {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: env.pulse.timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}

/** Date object at UTC midnight for a YYYY-MM-DD string (matches @db.Date columns). */
export function dateOnly(iso) {
  return new Date(`${iso}T00:00:00.000Z`);
}

/** First day of the current calendar month (business timezone), as a UTC date-only. */
export function startOfMonth() {
  const iso = todayISO();
  return dateOnly(`${iso.slice(0, 7)}-01`);
}

/** Start of the current ISO week (Monday), as a UTC date-only. */
export function startOfWeek() {
  const iso = todayISO();
  const d = dateOnly(iso);
  const day = d.getUTCDay() || 7; // Sunday = 7
  d.setUTCDate(d.getUTCDate() - (day - 1));
  return d;
}

/** Whole days from today (business tz) until the given date. Negative = expired. */
export function daysUntil(date) {
  const today = dateOnly(todayISO());
  const target = dateOnly(date.toISOString().slice(0, 10));
  return Math.round((target - today) / 86400000);
}
