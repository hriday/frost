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

import { classify } from '../src/fingerprint.js';

function bump(len, c, w = 4) {
  return Array.from({ length: len }, (_, i) => Math.max(0, 1 - Math.abs(i - c) / w));
}

test('classify picks the matching fingerprint', () => {
  const templates = new Map([['A', bump(40, 10)], ['B', bump(40, 30)]]);
  const vec = bump(40, 10);
  const r = classify(vec, templates, { maxLag: 15 });
  assert.equal(r.best, 'A');
  assert.ok(r.ranking[0].score > r.ranking[1].score);
});

test('classify tolerates a small time shift within maxLag', () => {
  const templates = new Map([['A', bump(40, 10)], ['B', bump(40, 30)]]);
  const vec = bump(40, 14);
  const r = classify(vec, templates, { maxLag: 15 });
  assert.equal(r.best, 'A');
});

test('classify returns ranking sorted by score and a confidence in [0,1]', () => {
  const templates = new Map([['A', bump(40, 10)], ['B', bump(40, 30)]]);
  const r = classify(bump(40, 10), templates, { maxLag: 15 });
  assert.equal(r.ranking.length, 2);
  assert.ok(r.ranking[0].score >= r.ranking[1].score);
  assert.ok(r.confidence >= 0 && r.confidence <= 1);
});
