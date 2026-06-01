export class RingBuffer {
  constructor(capacity) {
    if (!Number.isInteger(capacity) || capacity < 1) {
      throw new RangeError(`RingBuffer capacity must be a positive integer, got ${capacity}`);
    }
    this._cap = capacity;
    this._buf = new Array(capacity);
    this._start = 0;
    this._len = 0;
  }

  get capacity() { return this._cap; }
  get length() { return this._len; }

  push(value) {
    const end = (this._start + this._len) % this._cap;
    this._buf[end] = value;
    if (this._len < this._cap) {
      this._len++;
    } else {
      this._start = (this._start + 1) % this._cap;
    }
  }

  pushAll(values) {
    for (const v of values) this.push(v);
  }

  toArray() {
    const out = new Array(this._len);
    for (let i = 0; i < this._len; i++) {
      out[i] = this._buf[(this._start + i) % this._cap];
    }
    return out;
  }
}
