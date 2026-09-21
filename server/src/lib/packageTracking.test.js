import test from 'node:test';
import assert from 'node:assert/strict';
import { applyPackageBoundaries } from './packageMonths.js';
import {
  addCalendarMonths,
  buildExtensionRanges,
  buildPackageExtension,
  buildPackageMonths,
  deriveMonthRanges,
  exceedsMonthLimit,
  validateMonthRanges,
} from './packageTracking.js';

test('calendar-month extension clamps month ends', () => {
  assert.equal(addCalendarMonths('2027-01-31', 1), '2027-02-28');
  assert.equal(addCalendarMonths('2028-01-31', 1), '2028-02-29');
  assert.equal(addCalendarMonths('2026-09-30', 3), '2026-12-31');
});

test('repeated month-end extensions do not drift to the 28th', () => {
  const february = addCalendarMonths('2027-01-31', 1);
  assert.equal(february, '2027-02-28');
  assert.equal(addCalendarMonths(february, 1), '2027-03-31');
});

test('package extension reports exact old/new dates and resulting duration', () => {
  const extension = buildPackageExtension({
    packageStartedAt: '2026-08-31',
    expiryDate: '2026-09-30',
    monthlyJobTarget: 40,
  }, 2);
  assert.equal(extension.previousExpiryDate, '2026-09-30');
  assert.equal(extension.expiryDate, '2026-11-30');
  assert.equal(extension.packageMonths, 3);
  assert.deepEqual(extension.added, [
    { monthIndex: 2, startDate: '2026-10-01', endDate: '2026-10-31' },
    { monthIndex: 3, startDate: '2026-11-01', endDate: '2026-11-30' },
  ]);
});

test('applications are separated into package months without boundary double-counting', () => {
  const result = buildPackageMonths({
    packageStartedAt: '2026-07-15',
    expiryDate: '2026-10-14',
    monthlyJobTarget: 40,
    today: '2026-09-03',
    applicationDates: ['2026-07-15', '2026-08-15', '2026-08-16', '2026-09-15', '2026-09-16'],
  });
  assert.deepEqual(result.months.map((m) => m.applications), [2, 2, 1]);
  assert.equal(result.current.month, 2);
  assert.equal(result.totalMonths, 3);
});

test('an anniversary expiry is one complete package month', () => {
  const result = buildPackageMonths({
    packageStartedAt: '2026-09-03', expiryDate: '2026-10-03', monthlyJobTarget: 40,
    today: '2026-09-20', applicationDates: [],
  });
  assert.equal(result.totalMonths, 1);
  assert.equal(result.months[0].endDate, '2026-10-03');
});

test('a partial final month ends on the inclusive expiry date', () => {
  const result = buildPackageMonths({
    packageStartedAt: '2026-07-20', expiryDate: '2026-09-02', monthlyJobTarget: 10,
    today: '2026-09-10', applicationDates: ['2026-09-02', '2026-09-03'],
  });
  assert.equal(result.months.length, 2);
  assert.equal(result.months[1].endDate, '2026-09-02');
  assert.equal(result.months[1].applications, 1);
});

test('stored month dates override the anniversary derivation, gaps and all', () => {
  const result = buildPackageMonths({
    packageStartedAt: '2026-08-31',
    expiryDate: '2026-11-19',
    monthlyJobTarget: 300,
    today: '2026-09-10',
    storedMonths: [
      { monthIndex: 1, startDate: '2026-08-31', endDate: '2026-09-30' },
      { monthIndex: 2, startDate: '2026-10-01', endDate: '2026-10-11' },
      // Created by an extension, then edited to start later — a deliberate gap.
      { monthIndex: 3, startDate: '2026-10-20', endDate: '2026-11-19' },
    ],
    applicationDates: ['2026-09-01', '2026-10-05', '2026-10-15', '2026-10-25'],
  });

  assert.deepEqual(result.months.map((m) => m.applications), [1, 1, 1]);
  // 15 Oct falls in the gap: it belongs to no month and is never double-counted.
  assert.equal(result.totalApplications, 4);
  assert.equal(result.current.month, 1);
  assert.equal(result.next.month, 2);
  assert.equal(result.expiryDate, '2026-11-19');
});

test('editing Month 1 recounts its applications immediately', () => {
  const applicationDates = ['2026-09-01', '2026-09-20'];
  const before = buildPackageMonths({
    monthlyJobTarget: 40, today: '2026-09-10', applicationDates,
    storedMonths: [{ monthIndex: 1, startDate: '2026-09-01', endDate: '2026-09-30' }],
  });
  const after = buildPackageMonths({
    monthlyJobTarget: 40, today: '2026-09-10', applicationDates,
    storedMonths: [{ monthIndex: 1, startDate: '2026-09-15', endDate: '2026-10-14' }],
  });

  assert.equal(before.months[0].applications, 2);
  assert.equal(after.months[0].applications, 1);
});

test('during a gap between months, the next month is treated as current', () => {
  const result = buildPackageMonths({
    monthlyJobTarget: 40, today: '2026-10-15',
    storedMonths: [
      { monthIndex: 1, startDate: '2026-09-01', endDate: '2026-09-30' },
      { monthIndex: 2, startDate: '2026-11-01', endDate: '2026-11-30' },
    ],
  });
  assert.equal(result.current.month, 2);
  assert.equal(result.current.status, 'upcoming');
});

test('extension months are pre-filled back-to-back without overlapping', () => {
  const ranges = buildExtensionRanges('2026-09-30', 2, 2);
  assert.deepEqual(ranges, [
    { monthIndex: 2, startDate: '2026-10-01', endDate: '2026-10-31' },
    { monthIndex: 3, startDate: '2026-11-01', endDate: '2026-11-30' },
  ]);
  assert.equal(validateMonthRanges([
    { monthIndex: 1, startDate: '2026-09-01', endDate: '2026-09-30' },
    ...ranges,
  ]), null);
});

test('overlapping or inverted months are rejected', () => {
  assert.match(validateMonthRanges([
    { monthIndex: 1, startDate: '2026-09-01', endDate: '2026-10-15' },
    { monthIndex: 2, startDate: '2026-10-01', endDate: '2026-10-31' },
  ]), /cannot overlap/);

  assert.match(validateMonthRanges([
    { monthIndex: 1, startDate: '2026-09-30', endDate: '2026-09-01' },
  ]), /end date cannot be before the start date/);

  // A gap is legitimate — a client who pauses and resumes.
  assert.equal(validateMonthRanges([
    { monthIndex: 1, startDate: '2026-09-01', endDate: '2026-09-30' },
    { monthIndex: 2, startDate: '2026-10-20', endDate: '2026-11-19' },
  ]), null);
});

test('deriveMonthRanges still seeds legacy clients from start + expiry', () => {
  assert.deepEqual(deriveMonthRanges('2026-08-31', '2026-10-11'), [
    { monthIndex: 1, startDate: '2026-08-31', endDate: '2026-09-30' },
    { monthIndex: 2, startDate: '2026-10-01', endDate: '2026-10-11' },
  ]);
});

// --- regressions found in independent review -------------------------------

test('a legacy record with an expiry before its start never derives an inverted month', () => {
  // Nothing used to check start <= expiry, so such rows exist. Persisting an
  // inverted range mirrors an impossible expiry back onto the profile and leaves
  // the client permanently "expired".
  const ranges = deriveMonthRanges('2026-06-01', '2026-03-15');
  assert.equal(validateMonthRanges(ranges), null);
  for (const range of ranges) assert.ok(range.endDate >= range.startDate);
});

test('the same package month submitted twice is rejected', () => {
  assert.match(validateMonthRanges([
    { monthIndex: 1, startDate: '2026-09-01', endDate: '2026-09-30' },
    { monthIndex: 1, startDate: '2026-10-01', endDate: '2026-10-31' },
  ]), /submitted twice/);
});

test('moving the package end later appends whole months instead of stretching the last one', () => {
  // The Package & Assignment form used to write the new expiry straight onto the
  // final month, turning "Month 2" into a 92-day period counted against a
  // one-month target.
  const { ranges } = applyPackageBoundaries([
    { monthIndex: 1, startDate: '2026-08-31', endDate: '2026-09-30' },
    { monthIndex: 2, startDate: '2026-10-01', endDate: '2026-10-11' },
  ], { expiryDate: '2026-12-31' });

  assert.equal(validateMonthRanges(ranges), null);
  assert.deepEqual(ranges, [
    { monthIndex: 1, startDate: '2026-08-31', endDate: '2026-09-30' },
    { monthIndex: 2, startDate: '2026-10-01', endDate: '2026-10-11' },
    { monthIndex: 3, startDate: '2026-10-12', endDate: '2026-11-11' },
    { monthIndex: 4, startDate: '2026-11-12', endDate: '2026-12-11' },
    { monthIndex: 5, startDate: '2026-12-12', endDate: '2026-12-31' },
  ]);
});

test('moving the package end earlier drops the months outside it and trims the survivor', () => {
  const { ranges } = applyPackageBoundaries([
    { monthIndex: 1, startDate: '2026-01-01', endDate: '2026-01-31' },
    { monthIndex: 2, startDate: '2026-02-01', endDate: '2026-02-28' },
    { monthIndex: 3, startDate: '2026-03-01', endDate: '2026-03-31' },
  ], { expiryDate: '2026-02-15' });

  assert.deepEqual(ranges, [
    { monthIndex: 1, startDate: '2026-01-01', endDate: '2026-01-31' },
    { monthIndex: 2, startDate: '2026-02-01', endDate: '2026-02-15' },
  ]);
});

test('the package end cannot be moved before the package starts', () => {
  const result = applyPackageBoundaries(
    [{ monthIndex: 1, startDate: '2026-05-01', endDate: '2026-05-31' }],
    { expiryDate: '2026-04-01' },
  );
  assert.match(result.error, /cannot be before the package starts/);
});

test('moving the package start past Month 2 is refused rather than creating an overlap', () => {
  const result = applyPackageBoundaries([
    { monthIndex: 1, startDate: '2026-01-01', endDate: '2026-01-31' },
    { monthIndex: 2, startDate: '2026-02-01', endDate: '2026-02-28' },
  ], { startDate: '2026-02-10' });
  assert.match(result.error, /before Month 2 begins/);
});

test('an implausibly long package is refused instead of being silently truncated', () => {
  // deriveMonthRanges caps at 240 months; without this guard a mistyped year
  // would seed 240 months and then mirror a far-too-early expiry back.
  assert.equal(exceedsMonthLimit('2026-01-01', '2027-01-01'), false);
  assert.equal(exceedsMonthLimit('2026-01-01', '2060-01-01'), true);
});

test('during a gap the tracking says so instead of presenting a future month as running', () => {
  const result = buildPackageMonths({
    monthlyJobTarget: 40, today: '2026-10-15',
    storedMonths: [
      { monthIndex: 1, startDate: '2026-09-01', endDate: '2026-09-30' },
      { monthIndex: 2, startDate: '2026-11-01', endDate: '2026-11-30' },
    ],
  });
  assert.equal(result.inGap, true);
  assert.equal(result.current.month, 2);

  const running = buildPackageMonths({
    monthlyJobTarget: 40, today: '2026-09-15',
    storedMonths: [{ monthIndex: 1, startDate: '2026-09-01', endDate: '2026-09-30' }],
  });
  assert.equal(running.inGap, false);
});
