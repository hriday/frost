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

// Z-normalize a vector (zero mean, unit std). All-equal input -> zeros.
export function normalize(vec) {
  const n = vec.length;
  if (n === 0) return [];
  const mean = vec.reduce((a, b) => a + b, 0) / n;
  let varSum = 0;
  for (const v of vec) varSum += (v - mean) ** 2;
  const std = Math.sqrt(varSum / n);
  if (std === 0) return vec.map(() => 0);
  return vec.map((v) => (v - mean) / std);
}

// Elementwise mean of equal-length vectors.
export function buildTemplate(vectors) {
  const n = vectors.length;
  if (n === 0) return [];
  const len = vectors[0].length;
  const out = new Array(len).fill(0);
  for (const vec of vectors) for (let i = 0; i < len; i++) out[i] += vec[i];
  return out.map((s) => s / n);
}

// Pearson correlation of two equal-length arrays; 0 if either is constant.
function pearson(a, b) {
  const n = a.length;
  if (n === 0) return 0;
  let ma = 0, mb = 0;
  for (let i = 0; i < n; i++) { ma += a[i]; mb += b[i]; }
  ma /= n; mb /= n;
  let num = 0, da = 0, db = 0;
  for (let i = 0; i < n; i++) {
    const xa = a[i] - ma, xb = b[i] - mb;
    num += xa * xb; da += xa * xa; db += xb * xb;
  }
  if (da === 0 || db === 0) return 0;
  return num / Math.sqrt(da * db);
}

// Best Pearson correlation between vec and template over integer lags in
// [-maxLag, maxLag], computed on the overlapping region at each lag.
function bestCorr(vec, template, maxLag) {
  const n = vec.length;
  let best = -Infinity;
  for (let lag = -maxLag; lag <= maxLag; lag++) {
    const lo = Math.max(0, -lag);
    const hi = Math.min(n, n - lag);
    if (hi - lo < 2) continue;
    const c = pearson(vec.slice(lo, hi), template.slice(lo + lag, hi + lag));
    if (c > best) best = c;
  }
  return best === -Infinity ? 0 : best;
}

// Classify `vec` against templates (Map<label,vector> or [[label,vector],...]).
// Returns { ranking: [{label, score}], best, confidence } where confidence is
// the score gap between the top two matches, clamped to [0,1].
export function classify(vec, templates, { maxLag = 15 } = {}) {
  const entries = templates instanceof Map ? [...templates] : templates;
  const ranking = entries
    .map(([label, tmpl]) => ({ label, score: bestCorr(vec, tmpl, maxLag) }))
    .sort((a, b) => b.score - a.score);
  const best = ranking.length ? ranking[0].label : null;
  const s1 = ranking[0] ? ranking[0].score : 0;
  const s2 = ranking[1] ? ranking[1].score : 0;
  const confidence = Math.max(0, Math.min(1, s1 - s2));
  return { ranking, best, confidence };
}
