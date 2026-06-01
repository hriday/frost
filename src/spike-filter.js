// Replace every sample greater than thresholdMs with the mean of up to `window`
// surrounding non-spike samples (half the window on each side). If no non-spike
// neighbor is in range, fall back to the threshold value.
export function spikeFilter(samples, { thresholdMs = 1, window = 100 } = {}) {
  const half = Math.max(1, Math.floor(window / 2));
  const out = samples.slice();
  for (let i = 0; i < samples.length; i++) {
    if (samples[i] <= thresholdMs) continue;
    let sum = 0;
    let count = 0;
    const lo = Math.max(0, i - half);
    const hi = Math.min(samples.length - 1, i + half);
    for (let j = lo; j <= hi; j++) {
      if (j === i) continue;
      if (samples[j] > thresholdMs) continue;
      sum += samples[j];
      count++;
    }
    out[i] = count > 0 ? sum / count : thresholdMs;
  }
  return out;
}
