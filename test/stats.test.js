import { test } from 'node:test';
import assert from 'node:assert/strict';
import { median, percentile } from '../src/stats.js';

test('median of empty is NaN', () => {
  assert.ok(Number.isNaN(median([])));
});

test('median of odd-length', () => {
  assert.equal(median([3, 1, 2]), 2);
});

test('median of even-length averages middle two', () => {
  assert.equal(median([1, 2, 3, 4]), 2.5);
});

test('percentile p0 is min, p100 is max', () => {
  assert.equal(percentile([10, 20, 30, 40], 0), 10);
  assert.equal(percentile([10, 20, 30, 40], 100), 40);
});

test('p95 of 1..100 is 95-ish (nearest-rank)', () => {
  const data = Array.from({ length: 100 }, (_, i) => i + 1);
  assert.equal(percentile(data, 95), 95);
});

test('percentile of empty is NaN', () => {
  assert.ok(Number.isNaN(percentile([], 95)));
});
