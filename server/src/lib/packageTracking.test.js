import test from 'node:test';
import assert from 'node:assert/strict';
import { addCalendarMonths, buildPackageMonths } from './packageTracking.js';

test('calendar-month extension clamps month ends', () => {
  assert.equal(addCalendarMonths('2027-01-31', 1), '2027-02-28');
  assert.equal(addCalendarMonths('2028-01-31', 1), '2028-02-29');
  assert.equal(addCalendarMonths('2026-09-30', 3), '2026-12-30');
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
