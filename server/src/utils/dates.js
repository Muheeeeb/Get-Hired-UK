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

/**
 * True only for a real calendar date in YYYY-MM-DD form.
 *
 * A `/^\d{4}-\d{2}-\d{2}$/` regex happily accepts 2026-02-30, and `new Date()`
 * then rolls it forward to 2 March. Silently moving a package month's end date
 * two days is how two months end up overlapping, so every date that reaches the
 * database is round-tripped through this first.
 */
export function isValidIsoDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

/** Date object at UTC midnight for a YYYY-MM-DD string (matches @db.Date columns). */
export function dateOnly(iso) {
  if (!isValidIsoDate(iso)) {
    throw Object.assign(new Error(`Not a valid calendar date: ${iso}`), { status: 400 });
  }
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

/** 'YYYY-MM-DD' N days from today (business timezone). */
export function isoDaysFromNow(days) {
  const d = dateOnly(todayISO());
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** Whole days from today (business tz) until the given date. Negative = expired. */
export function daysUntil(date) {
  const today = dateOnly(todayISO());
  const target = dateOnly(date.toISOString().slice(0, 10));
  return Math.round((target - today) / 86400000);
}
