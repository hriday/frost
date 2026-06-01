import { test } from 'node:test';
import assert from 'node:assert/strict';
import { binTrace } from '../src/fingerprint.js';

test('binTrace averages samples within each time slice', () => {
  const samples = [
    { t: 0, latency: 1 }, { t: 10, latency: 3 },
    { t: 60, latency: 5 },
  ];
  const out = binTrace(samples, { windowMs: 100, bins: 2 });
  assert.deepEqual(out, [2, 5]);
});

test('binTrace linearly interpolates empty interior slices', () => {
  const samples = [{ t: 0, latency: 0 }, { t: 75, latency: 30 }];
  const out = binTrace(samples, { windowMs: 100, bins: 4 });
  assert.deepEqual(out, [0, 10, 20, 30]);
});

test('binTrace returns zeros for no samples', () => {
  assert.deepEqual(binTrace([], { windowMs: 100, bins: 3 }), [0, 0, 0]);
});

test('binTrace ignores samples past the window', () => {
  const out = binTrace([{ t: 0, latency: 2 }, { t: 999, latency: 9 }], { windowMs: 100, bins: 2 });
  assert.equal(out[0], 2);
  assert.equal(out[1], 2);
});

import { normalize, buildTemplate } from '../src/fingerprint.js';

test('normalize gives zero mean and unit std', () => {
  const out = normalize([1, 2, 3]);
  const mean = out.reduce((a, b) => a + b, 0) / out.length;
  assert.ok(Math.abs(mean) < 1e-9);
  const std = Math.sqrt(out.reduce((a, b) => a + b * b, 0) / out.length);
  assert.ok(Math.abs(std - 1) < 1e-9);
});

test('normalize maps all-equal input to zeros', () => {
  assert.deepEqual(normalize([5, 5, 5]), [0, 0, 0]);
});

test('buildTemplate averages elementwise', () => {
  assert.deepEqual(buildTemplate([[1, 2], [3, 4]]), [2, 3]);
});
