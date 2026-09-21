import { z } from 'zod';
import { isValidIsoDate } from './dates.js';

/**
 * A real calendar date, not merely something shaped like one.
 *
 * The plain regex accepts 2026-02-30 and 2026-13-45; `new Date()` then rolls
 * them forward (2 March) or produces Invalid Date. Both reach the database as
 * something the admin never typed, which is how package months end up
 * overlapping or a write 500s. Use this for every date field.
 */
export const isoDate = (message = 'Expected a real calendar date (YYYY-MM-DD)') =>
  z.string().refine(isValidIsoDate, { message });
