import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spikeFilter } from '../src/spike-filter.js';

test('leaves sub-threshold samples untouched', () => {
  const input = [0.2, 0.3, 0.25, 0.4];
  assert.deepEqual(spikeFilter(input, { thresholdMs: 1, window: 2 }), input);
});

test('replaces a spike with mean of non-spike neighbors', () => {
  const out = spikeFilter([0.2, 5.0, 0.4], { thresholdMs: 1, window: 2 });
  assert.equal(out[0], 0.2);
  assert.ok(Math.abs(out[1] - 0.3) < 1e-9);
  assert.equal(out[2], 0.4);
});

test('spike at the edge uses available neighbors only', () => {
  const out = spikeFilter([5.0, 0.4, 0.6], { thresholdMs: 1, window: 2 });
  assert.ok(Math.abs(out[0] - 0.4) < 1e-9);
});

test('falls back to threshold when no non-spike neighbors exist', () => {
  const out = spikeFilter([5.0, 6.0, 7.0], { thresholdMs: 1, window: 2 });
  assert.deepEqual(out, [1, 1, 1]);
});

test('does not mutate the input array', () => {
  const input = [0.2, 5.0, 0.4];
  const copy = [...input];
  spikeFilter(input, { thresholdMs: 1, window: 2 });
  assert.deepEqual(input, copy);
});
