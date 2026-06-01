// Pure time-series matching for FROST latency traces.

// Linearly fill null entries from known neighbors; leading/trailing nulls take
// the nearest known value; an all-null array becomes zeros.
function interpolateNulls(arr) {
  const n = arr.length;
  let first = -1, last = -1;
  for (let i = 0; i < n; i++) if (arr[i] !== null) { if (first < 0) first = i; last = i; }
  if (first < 0) return arr.map(() => 0);
  const out = arr.slice();
  for (let i = 0; i < first; i++) out[i] = arr[first];
  for (let i = last + 1; i < n; i++) out[i] = arr[last];
  let i = first;
  while (i <= last) {
    if (out[i] !== null) { i++; continue; }
    let j = i;
    while (out[j] === null) j++;
    const lo = out[i - 1], hi = out[j], span = j - (i - 1);
    for (let k = i; k < j; k++) out[k] = lo + (hi - lo) * (k - (i - 1)) / span;
    i = j;
  }
  return out;
}

// Split arrival-timestamped samples ({t, latency}) into `bins` equal time slices
// over windowMs, returning the mean latency per slice (empty slices interpolated).
// The window starts at the first sample's timestamp.
export function binTrace(samples, { windowMs = 8000, bins = 200 } = {}) {
  if (samples.length === 0) return new Array(bins).fill(0);
  const t0 = samples[0].t;
  const sliceMs = windowMs / bins;
  const sums = new Array(bins).fill(0);
  const counts = new Array(bins).fill(0);
  for (const s of samples) {
    let idx = Math.floor((s.t - t0) / sliceMs);
    if (idx < 0) idx = 0;
    if (idx >= bins) continue;
    sums[idx] += s.latency;
    counts[idx] += 1;
  }
  const means = new Array(bins);
  for (let i = 0; i < bins; i++) means[i] = counts[i] ? sums[i] / counts[i] : null;
  return interpolateNulls(means);
}
