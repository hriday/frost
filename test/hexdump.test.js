import { test } from 'node:test';
import assert from 'node:assert/strict';
import { hexdump, byteStats } from '../src/hexdump.js';

test('hexdump formats one short row with offset, padded hex, and ascii', () => {
  const out = hexdump(Uint8Array.from([0x00, 0x41, 0x42, 0xff]));
  const expected = `00000000  00 41 42 ff${' '.repeat(16 * 3 - 1 - 11)}  |·AB·|`;
  assert.equal(out, expected);
});

test('hexdump wraps to multiple rows at bytesPerRow', () => {
  const bytes = Uint8Array.from(Array.from({ length: 20 }, (_, i) => i));
  const lines = hexdump(bytes).split('\n');
  assert.equal(lines.length, 2);
  assert.match(lines[0], /^00000000 {2}00 01 02/);
  assert.match(lines[1], /^00000010 {2}10 11 12 13/);
});

test('hexdump respects custom bytesPerRow', () => {
  const lines = hexdump(Uint8Array.from([1, 2, 3, 4]), { bytesPerRow: 2 }).split('\n');
  assert.equal(lines.length, 2);
  assert.match(lines[0], /^00000000 {2}01 02 {2}\|/);
  assert.match(lines[1], /^00000002 {2}03 04 {2}\|/);
});

test('byteStats counts printable, distinct, and percentage', () => {
  const s = byteStats(Uint8Array.from([0x00, 0x41, 0x42, 0xff]));
  assert.deepEqual(s, { total: 4, printable: 2, distinct: 4, printablePct: 50 });
});

test('byteStats handles empty input', () => {
  assert.deepEqual(byteStats(Uint8Array.from([])), { total: 0, printable: 0, distinct: 0, printablePct: 0 });
});
