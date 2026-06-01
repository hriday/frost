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
