import test from 'node:test';
import assert from 'node:assert/strict';
import { dateOnly, isValidIsoDate } from './dates.js';

test('a date that only looks valid is rejected', () => {
  // The old `/^\d{4}-\d{2}-\d{2}$/` check accepted these, and `new Date()` then
  // rolled 30 February forward to 2 March — which is how two package months
  // ended up overlapping and double-counting an application.
  assert.equal(isValidIsoDate('2026-02-30'), false);
  assert.equal(isValidIsoDate('2026-13-45'), false);
  assert.equal(isValidIsoDate('2026-04-31'), false);
  assert.equal(isValidIsoDate('2026-1-01'), false);
  assert.equal(isValidIsoDate(''), false);
  assert.equal(isValidIsoDate(null), false);
});

test('real calendar dates, including leap days, are accepted', () => {
  assert.equal(isValidIsoDate('2026-02-28'), true);
  assert.equal(isValidIsoDate('2028-02-29'), true);
  assert.equal(isValidIsoDate('2026-12-31'), true);
});

test('dateOnly refuses to silently roll an impossible date forward', () => {
  assert.throws(() => dateOnly('2026-02-30'), /valid calendar date/);
  assert.equal(dateOnly('2026-02-28').toISOString(), '2026-02-28T00:00:00.000Z');
});
