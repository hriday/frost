import { test } from 'node:test';
import assert from 'node:assert/strict';
import { RingBuffer } from '../src/ring-buffer.js';

test('starts empty', () => {
  const rb = new RingBuffer(3);
  assert.equal(rb.length, 0);
  assert.equal(rb.capacity, 3);
  assert.deepEqual(rb.toArray(), []);
});

test('pushes up to capacity in order', () => {
  const rb = new RingBuffer(3);
  rb.push(1); rb.push(2); rb.push(3);
  assert.equal(rb.length, 3);
  assert.deepEqual(rb.toArray(), [1, 2, 3]);
});

test('overwrites oldest beyond capacity, oldest->newest order', () => {
  const rb = new RingBuffer(3);
  rb.push(1); rb.push(2); rb.push(3); rb.push(4); rb.push(5);
  assert.equal(rb.length, 3);
  assert.deepEqual(rb.toArray(), [3, 4, 5]);
});

test('pushAll appends many values', () => {
  const rb = new RingBuffer(3);
  rb.pushAll([1, 2, 3, 4]);
  assert.deepEqual(rb.toArray(), [2, 3, 4]);
});
