export function median(values) {
  if (values.length === 0) return NaN;
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

// Nearest-rank percentile. p in [0, 100].
export function percentile(values, p) {
  if (values.length === 0) return NaN;
  const s = [...values].sort((a, b) => a - b);
  if (p <= 0) return s[0];
  if (p >= 100) return s[s.length - 1];
  const rank = Math.ceil((p / 100) * s.length);
  return s[Math.min(rank, s.length) - 1];
}
