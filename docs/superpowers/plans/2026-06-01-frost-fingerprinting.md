# FROST Website Fingerprinting Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a per-visitor website-fingerprinting demo to the FROST POC: the page calibrates a few candidate sites' SSD-contention traces on the visitor's own machine, then identifies which one the visitor opens.

**Architecture:** A new pure, unit-tested classifier module (`src/fingerprint.js`) does binning, normalization, template-building, and lag-tolerant cross-correlation matching. `public/app.js` gains a capture controller that records the existing live latency stream into time windows, plus calibration / reveal / self-test wiring and a results renderer. No worker change, no new dependencies.

**Tech Stack:** Node 23 `node --test`, vanilla browser ES modules, Canvas-free DOM, existing OPFS measurement loop.

---

## File Structure

```
src/fingerprint.js        # NEW: pure classifier (binTrace, normalize, buildTemplate, classify)
test/fingerprint.test.js  # NEW: unit tests
public/app.js             # MODIFY: capture controller + fingerprinting UI controller
public/index.html         # MODIFY: add "Website fingerprinting" panel
public/style.css          # MODIFY: panel + results-bar styles
README.md                 # MODIFY: add fingerprinting manual checklist
```

`src/fingerprint.js` holds all reusable pure logic (tested in Node). `app.js` owns the worker
message stream, so the capture controller and Ui wiring live there alongside the existing page
logic. The candidate-site list and tunables (window, reps, bins, lag) are constants at the top
of the fingerprinting section in `app.js`.

---

### Task 1: Classifier module — `binTrace` (TDD)

**Files:**
- Create: `src/fingerprint.js`
- Test: `test/fingerprint.test.js`

- [ ] **Step 1: Write the failing test**

`test/fingerprint.test.js`:
```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { binTrace } from '../src/fingerprint.js';

test('binTrace averages samples within each time slice', () => {
  const samples = [
    { t: 0, latency: 1 }, { t: 10, latency: 3 }, // slice 0 (0–50ms)
    { t: 60, latency: 5 },                        // slice 1 (50–100ms)
  ];
  const out = binTrace(samples, { windowMs: 100, bins: 2 });
  assert.deepEqual(out, [2, 5]); // mean(1,3)=2 ; mean(5)=5
});

test('binTrace linearly interpolates empty interior slices', () => {
  const samples = [{ t: 0, latency: 0 }, { t: 75, latency: 30 }];
  const out = binTrace(samples, { windowMs: 100, bins: 4 }); // 25ms slices
  // slice0=0 (t=0), slice3=30 (t=75); slices 1,2 interpolated between 0 and 30
  assert.deepEqual(out, [0, 10, 20, 30]);
});

test('binTrace returns zeros for no samples', () => {
  assert.deepEqual(binTrace([], { windowMs: 100, bins: 3 }), [0, 0, 0]);
});

test('binTrace ignores samples past the window', () => {
  const out = binTrace([{ t: 0, latency: 2 }, { t: 999, latency: 9 }], { windowMs: 100, bins: 2 });
  assert.equal(out[0], 2);
  assert.equal(out[1], 2); // trailing empty slice filled from last known
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/fingerprint.test.js`
Expected: FAIL — cannot find module `../src/fingerprint.js`.

- [ ] **Step 3: Write minimal implementation**

`src/fingerprint.js`:
```js
// Pure website-fingerprinting classifier for FROST latency traces.

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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/fingerprint.test.js`
Expected: PASS — 4 tests.

- [ ] **Step 5: Commit**

```bash
git add src/fingerprint.js test/fingerprint.test.js
git commit -m "feat: add binTrace for fingerprint preprocessing"
```

---

### Task 2: Classifier module — `normalize` + `buildTemplate` (TDD)

**Files:**
- Modify: `src/fingerprint.js`
- Test: `test/fingerprint.test.js`

- [ ] **Step 1: Add failing tests**

Append to `test/fingerprint.test.js`:
```js
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
```

- [ ] **Step 2: Run to verify failure**

Run: `node --test test/fingerprint.test.js`
Expected: FAIL — `normalize`/`buildTemplate` are not exported.

- [ ] **Step 3: Implement**

Append to `src/fingerprint.js`:
```js
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
```

- [ ] **Step 4: Run to verify pass**

Run: `node --test test/fingerprint.test.js`
Expected: PASS — 7 tests.

- [ ] **Step 5: Commit**

```bash
git add src/fingerprint.js test/fingerprint.test.js
git commit -m "feat: add normalize and buildTemplate"
```

---

### Task 3: Classifier module — `classify` (lag-tolerant) (TDD)

**Files:**
- Modify: `src/fingerprint.js`
- Test: `test/fingerprint.test.js`

- [ ] **Step 1: Add failing tests**

Append to `test/fingerprint.test.js`:
```js
import { classify } from '../src/fingerprint.js';

// triangular bump of half-width `w` centered at `c` in a length-`len` vector
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
  const vec = bump(40, 14); // shifted by 4
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
```

- [ ] **Step 2: Run to verify failure**

Run: `node --test test/fingerprint.test.js`
Expected: FAIL — `classify` not exported.

- [ ] **Step 3: Implement**

Append to `src/fingerprint.js`:
```js
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
```

- [ ] **Step 4: Run to verify pass**

Run: `node --test test/fingerprint.test.js`
Expected: PASS — 10 tests.

- [ ] **Step 5: Run full suite + commit**

Run: `npm test`
Expected: PASS — all suites green (was 29, now 39).

```bash
git add src/fingerprint.js test/fingerprint.test.js
git commit -m "feat: add lag-tolerant trace classifier"
```

---

### Task 4: Capture controller + fingerprinting UI in `app.js`

**Files:**
- Modify: `public/app.js`

- [ ] **Step 1: Import the classifier**

In `public/app.js`, change the import block at the top to add fingerprint imports:
```js
import { RingBuffer } from '../src/ring-buffer.js';
import { median, percentile } from '../src/stats.js';
import { spikeFilter } from '../src/spike-filter.js';
import { hexdump, byteStats } from '../src/hexdump.js';
import { binTrace, normalize, buildTemplate, classify } from '../src/fingerprint.js';
```

- [ ] **Step 2: Add fingerprint state + a measuring flag**

In `public/app.js`, find the existing globals block ending with `let rate = 0;` and add directly after it:
```js
// --- Website fingerprinting state ---
const SITES = [
  { label: 'YouTube', url: 'https://www.youtube.com' },
  { label: 'Wikipedia', url: 'https://en.wikipedia.org' },
  { label: 'Amazon', url: 'https://www.amazon.com' },
  { label: 'example.com', url: 'https://example.com' },
];
const FP_WINDOW_MS = 8000;
const FP_REPS = 3;
const FP_BINS = 200;
const FP_MAXLAG = 15;
const calibration = new Map(); // label -> vector[]
const templates = new Map();   // label -> template vector
let captureSink = null;        // function(sample) while a capture window is open
let measuring = false;         // true while the SSD read-loop is running
```

- [ ] **Step 3: Feed the capture sink from the sample stream**

In `public/app.js`, in `ensureWorker()`'s `onmessage`, replace the `samples` branch:
```js
    } else if (m.type === 'samples') {
      for (const v of m.latencies) {
        raw.push(v);
        sampleCount++;
        if (v > SPIKE_MS) spikeCount++;
      }
```
with:
```js
    } else if (m.type === 'samples') {
      const arr = performance.now();
      for (const v of m.latencies) {
        raw.push(v);
        sampleCount++;
        if (v > SPIKE_MS) spikeCount++;
        if (captureSink) captureSink({ t: arr, latency: v });
      }
```

- [ ] **Step 4: Set/clear the measuring flag**

In `public/app.js`, in the `$('start')` click handler, find `$('start').disabled = true; $('stop').disabled = false;` and add `measuring = true;` after it. In `stop()`, add `measuring = false;` as the first line. In the `onmessage` `error` branch (`setStatus(\`Error: ${m.message}\`); stop();`) no change needed (stop() clears it).

- [ ] **Step 5: Add the fingerprinting functions**

In `public/app.js`, add this block immediately before `function init() {`:
```js
// ---- Website fingerprinting ----

function fpStatus(text) { $('fpStatus').textContent = text; }

function captureWindow(ms) {
  return new Promise((resolve) => {
    const buf = [];
    captureSink = (s) => buf.push(s);
    setTimeout(() => { captureSink = null; resolve(buf); }, ms);
  });
}

function traceToVector(samples) {
  const binned = binTrace(samples, { windowMs: FP_WINDOW_MS, bins: FP_BINS });
  const smoothed = spikeFilter(binned, { thresholdMs: SPIKE_MS, window: 20 });
  return normalize(smoothed);
}

function countdown(n) {
  return new Promise((resolve) => {
    let k = n;
    fpStatus(`Get ready… ${k}`);
    const iv = setInterval(() => {
      k--;
      if (k <= 0) { clearInterval(iv); resolve(); } else fpStatus(`Get ready… ${k}`);
    }, 1000);
  });
}

function updateCalibrationUI() {
  for (const span of document.querySelectorAll('.fpticks')) {
    const n = (calibration.get(span.dataset.label) || []).length;
    span.textContent = '✓'.repeat(n) + '·'.repeat(Math.max(0, FP_REPS - n)) + ` (${n}/${FP_REPS})`;
  }
  const ready = templates.size >= 2;
  $('fpGuess').disabled = !ready;
  $('fpSelfTest').disabled = !ready;
}

function renderResults(result) {
  const box = $('fpResults');
  box.innerHTML = '';
  const max = Math.max(0.001, ...result.ranking.map((r) => Math.max(0, r.score)));
  for (const r of result.ranking) {
    const pct = Math.round((Math.max(0, r.score) / max) * 100);
    const row = document.createElement('div');
    row.className = 'fpbar' + (r.label === result.best ? ' top' : '');
    row.innerHTML =
      `<span class="fplabel">${r.label}</span>` +
      `<span class="fptrack"><span class="fpfill" style="width:${pct}%"></span></span>` +
      `<span class="fpscore">${r.score.toFixed(2)}</span>`;
    box.appendChild(row);
  }
}

async function captureSite(site) {
  if (!measuring) { fpStatus('Start the SSD measurement first.'); return; }
  const popup = window.open(site.url, '_blank');
  if (!popup) fpStatus(`Popup blocked — allow popups, or open ${site.label} yourself now.`);
  else fpStatus(`Capturing ${site.label}… (window opens for ${FP_WINDOW_MS / 1000}s)`);
  const samples = await captureWindow(FP_WINDOW_MS);
  try { if (popup) popup.close(); } catch (e) { /* cross-origin close may throw */ }
  if (samples.length < 50) { fpStatus('Too few samples — is the measurement running?'); return; }
  if (!calibration.has(site.label)) calibration.set(site.label, []);
  calibration.get(site.label).push(traceToVector(samples));
  templates.set(site.label, buildTemplate(calibration.get(site.label)));
  updateCalibrationUI();
  fpStatus(`${site.label}: ${calibration.get(site.label).length}/${FP_REPS} captured.`);
}

async function guess() {
  if (templates.size < 2) { fpStatus('Calibrate at least two sites first.'); return; }
  if (!measuring) { fpStatus('Start the SSD measurement first.'); return; }
  await countdown(3);
  fpStatus('Measuring — open ONE of the calibrated sites now!');
  const samples = await captureWindow(FP_WINDOW_MS);
  if (samples.length < 50) { fpStatus('Too few samples — is the measurement running?'); return; }
  const result = classify(traceToVector(samples), templates, { maxLag: FP_MAXLAG });
  renderResults(result);
  fpStatus(`You probably opened: ${result.best} (${Math.round(result.confidence * 100)}% margin over the runner-up).`);
}

async function selfTest() {
  if (templates.size < 2) { fpStatus('Calibrate at least two sites first.'); return; }
  if (!measuring) { fpStatus('Start the SSD measurement first.'); return; }
  const labels = [...templates.keys()];
  const pick = labels[Math.floor(Math.random() * labels.length)];
  const site = SITES.find((s) => s.label === pick);
  const popup = window.open(site.url, '_blank');
  fpStatus('Self-test: measuring a site I picked secretly…');
  const samples = await captureWindow(FP_WINDOW_MS);
  try { if (popup) popup.close(); } catch (e) { /* cross-origin close may throw */ }
  if (samples.length < 50) { fpStatus('Too few samples — is the measurement running?'); return; }
  const result = classify(traceToVector(samples), templates, { maxLag: FP_MAXLAG });
  renderResults(result);
  const ok = result.best === pick ? '✓ correct' : '✗ wrong';
  fpStatus(`Self-test: I predicted ${result.best}; it was actually ${pick} — ${ok}.`);
}

function initFingerprint() {
  const container = $('fpSites');
  for (const site of SITES) {
    const row = document.createElement('div');
    row.className = 'fprow';
    const btn = document.createElement('button');
    btn.textContent = `Capture ${site.label}`;
    btn.addEventListener('click', () => captureSite(site));
    const ticks = document.createElement('span');
    ticks.className = 'fpticks';
    ticks.dataset.label = site.label;
    row.append(btn, ticks);
    container.appendChild(row);
  }
  $('fpGuess').addEventListener('click', guess);
  $('fpSelfTest').addEventListener('click', selfTest);
  updateCalibrationUI();
}
```

- [ ] **Step 6: Initialize the panel**

In `public/app.js`, in `function init() {`, add `initFingerprint();` on the line right after `showEnvironment();`.

- [ ] **Step 7: Syntax check**

Run: `node --check public/app.js`
Expected: exits 0.

- [ ] **Step 8: Commit**

```bash
git add public/app.js
git commit -m "feat: add capture controller and fingerprinting UI logic"
```

---

### Task 5: Markup + styles

**Files:**
- Modify: `public/index.html`
- Modify: `public/style.css`

- [ ] **Step 1: Add the panel to `public/index.html`**

In `public/index.html`, find the closing `</section>` of the hex-dump panel (the one containing
`id="dumpHuman"`), and insert this new section immediately after it (before
`<script type="module" src="./app.js">`):
```html
  <section class="panel">
    <h2>Website fingerprinting</h2>
    <p class="hint">Start the SSD measurement above first. Then <strong>calibrate</strong> by
      capturing each site a few times on this machine, and let the page <strong>guess</strong>
      which one you open. Closed-world: it always picks the closest calibrated site.</p>
    <div id="fpSites" class="fpsites"></div>
    <div class="buttons">
      <button id="fpGuess" disabled>Guess what I open</button>
      <button id="fpSelfTest" disabled>Self-test</button>
    </div>
    <p id="fpStatus" class="status">Calibrate at least two sites to enable guessing.</p>
    <div id="fpResults" class="fpresults"></div>
    <p class="hint">Why calibration is needed: an SSD fingerprint is specific to this machine,
      OS, and browser, so the page learns it where it runs. It can't reset the OS page cache from
      JavaScript, so a site's signal is strongest on its first open and weakens on repeats.
      Accuracy here is rough — well below the paper's controlled-lab numbers — and works only when
      the site's activity hits the same SSD as the probe file. Calibration lives in this tab
      only; nothing is stored or sent anywhere.</p>
  </section>
```

- [ ] **Step 2: Add styles to `public/style.css`**

Append to `public/style.css`:
```css
.fpsites { display: flex; flex-direction: column; gap: 0.4rem; margin: 0.5rem 0; }
.fprow { display: flex; align-items: center; gap: 0.75rem; }
.fprow button { background: #1f6feb; }
.fpticks { color: #8b949e; font-family: ui-monospace, monospace; font-size: 0.85rem; }
.fpresults { display: flex; flex-direction: column; gap: 0.35rem; margin-top: 0.75rem; }
.fpbar { display: grid; grid-template-columns: 7rem 1fr 3rem; align-items: center; gap: 0.5rem; }
.fpbar .fplabel { color: #8b949e; }
.fpbar.top .fplabel { color: #c9d1d9; font-weight: 700; }
.fptrack { background: #0a0e14; border: 1px solid #30363d; border-radius: 4px; height: 14px; overflow: hidden; }
.fpfill { display: block; height: 100%; background: #5cf; }
.fpbar.top .fpfill { background: #3fb950; }
.fpscore { color: #9ab; font-variant-numeric: tabular-nums; font-size: 0.85rem; text-align: right; }
```

- [ ] **Step 3: Verify ids, run server, smoke test**

Run:
```bash
for id in fpSites fpGuess fpSelfTest fpStatus fpResults; do grep -q "id=\"$id\"" public/index.html || echo "MISSING: $id"; done
PORT=8099 node server.js >/tmp/frost.log 2>&1 & SRV=$!; sleep 1
curl -s -o /dev/null -w "page %{http_code}\n" http://localhost:8099/
curl -s -o /dev/null -w "fingerprint.js %{http_code}\n" http://localhost:8099/src/fingerprint.js
kill $SRV
```
Expected: no `MISSING` lines; both 200.

- [ ] **Step 4: Commit**

```bash
git add public/index.html public/style.css
git commit -m "feat: add website-fingerprinting panel and styles"
```

---

### Task 6: README + manual checklist

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Add a fingerprinting section**

In `README.md`, add before the `## Deployment` heading:
```markdown
## Website fingerprinting demo

A per-visitor, closed-world reproduction of the paper's website-fingerprinting attack. Because
an SSD fingerprint is specific to the machine, OS, and browser, the page calibrates on the
visitor's own machine rather than shipping a pre-trained model.

Manual checklist:
1. Start the SSD measurement (build a probe file larger than free RAM) so there is a contention
   signal.
2. In **Website fingerprinting**, click "Capture YouTube" — a tab opens, an 8 s window records,
   the tab closes. Repeat for each site (≈3 reps each). At least two sites must be calibrated.
3. Click **Self-test**: the page opens one of your calibrated sites at random and identifies it.
   Run it a few times — it should be mostly correct.
4. Click **Guess what I open**, wait for the countdown, then open one calibrated site yourself in
   a new tab. The page predicts which one.

Accuracy is rough in a casual setting (the page cannot reset the OS page cache, so signals are
strongest on first opens) and is well below the paper's controlled-automation F1 scores. It only
works when the opened site's disk activity hits the same SSD as the probe file.
```

- [ ] **Step 2: Final full-suite run**

Run: `npm test`
Expected: PASS — all suites green (39 tests).

- [ ] **Step 3: Commit**

```bash
git add README.md
git commit -m "docs: document the website-fingerprinting demo"
```

---

## Self-Review Notes

- **Spec coverage:** per-visitor calibration (Task 4 `captureSite`), template matching (Tasks
  1–3), classify with lag tolerance (Task 3), reveal/blind guess (Task 4 `guess`), self-test
  (Task 4 `selfTest`), candidate sites incl. example.com baseline (Task 4 `SITES`), capture from
  existing stream / no worker change (Task 4 Step 3), UI panel + results bars + honesty notes
  (Task 5), disabled-until-ready (`updateCalibrationUI`), unit tests (Tasks 1–3), README
  checklist (Task 6). All spec sections map to a task.
- **Type consistency:** `binTrace`/`normalize`/`buildTemplate`/`classify` signatures match
  across tests and `app.js`. `classify` returns `{ ranking:[{label,score}], best, confidence }`,
  used exactly that way in `renderResults`/`guess`/`selfTest`. `traceToVector` →
  `binTrace`→`spikeFilter`→`normalize`. Capture samples are `{t, latency}`, matching `binTrace`.
- **Decisions honored:** 8 s window, 3 reps, 200 bins, ±15-bin lag are the constants
  `FP_WINDOW_MS/FP_REPS/FP_BINS/FP_MAXLAG`. Closed-world (always nearest match). No persistence
  (in-memory `Map`s). No new dependencies.
- **Note for executor:** the fingerprint panel requires the measurement loop to be running;
  `measuring` gates all three actions. Popup `close()` is wrapped in try/catch (cross-origin).
