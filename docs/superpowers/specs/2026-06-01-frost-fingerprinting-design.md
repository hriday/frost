# FROST POC — Website Fingerprinting (per-visitor) Design

**Date:** 2026-06-01
**Builds on:** the deployed FROST measurement POC (`docs/superpowers/specs/2026-05-31-frost-poc-design.md`).

## Goal

Demonstrate the paper's closed-world website-fingerprinting attack live: the page learns, on
the visitor's own machine, what a few candidate sites' SSD-contention traces look like, then
correctly identifies which one the visitor opens — the "you probably have YouTube open" reveal.

Runs entirely in the visitor's browser, no backend, no persistence. Reuses the existing
measurement loop and latency stream.

## Why per-visitor calibration (not a baked-in model)

An SSD fingerprint depends on the exact SSD, OS, free RAM / page-cache state, and browser. A
model trained on our hardware would misclassify on a different machine. So the page trains on
the same machine it runs on. This is the honest, working version, and it faithfully
reproduces the paper's closed-world setup.

## Scope

**In scope:**
- A fixed candidate-site set, a calibration phase (a few labeled traces per site), and a reveal
  phase that classifies a freshly opened site.
- A pure, unit-tested classifier using template matching (no new dependencies).
- A self-test mode (page opens a random calibrated site and identifies it) for a reproducible,
  obviously-not-rigged demo.

**Out of scope:**
- CNN / TensorFlow.js. Covert channel. Application fingerprinting. Persisting calibration
  across sessions. Open-world detection of unseen sites (we classify among calibrated sites
  only; an "unknown" rejection is a possible later addition, not now).

## Phases

0. **Measure (existing):** the SSD probe must be running (file built, read-loop active). The
   fingerprint panel is disabled until then.
1. **Calibrate:** for each candidate site, the visitor captures ~3 labeled traces. On the
   capture click the page calls `window.open(url)` *within the click handler* (gesture-safe so
   popup blockers don't fire), records an 8 s window of the live latency stream, then
   `popup.close()`s it. Progress shown per site.
2. **Reveal:** a countdown, then the visitor opens one candidate site themselves in a new tab
   (blind — they don't tell the page). The page records an 8 s window, classifies it, and shows
   a ranked guess with a confidence headline. A **Self-test** button runs the same path with a
   page-chosen random site (label hidden until after the guess) for reliability/integrity.

**Candidate sites (default, fixed):** `https://www.youtube.com`, `https://en.wikipedia.org`,
`https://www.amazon.com`, `https://example.com` (light/baseline anchor). Chosen for very
different load weights. The visitor opens these same landing-page URLs in both phases (avoids
logged-in-vs-login-page mismatch, e.g. Gmail).

## Classifier — `src/fingerprint.js` (pure, unit-tested)

Trace = array of `{ t, latency }` (arrival-timestamped samples collected during a window).

- `binTrace(samples, { windowMs, bins })` → `number[bins]`: split the window into `bins` equal
  time slices, mean latency per slice; linearly interpolate empty slices; returns fixed length
  (default windowMs 8000, bins 200 → 40 ms slices).
- `normalize(vec)` → `number[]`: z-normalize (subtract mean, divide by std; std 0 → zeros).
- `buildTemplate(vectors)` → `number[]`: elementwise mean of equal-length vectors.
- `classify(vec, templates, { maxLag })` → `{ ranking: [{label, score}], best, confidence }`:
  for each template compute the **best normalized cross-correlation** over lags in
  `[-maxLag, +maxLag]` (default 15 bins) to absorb the human open-timing offset; score = max
  correlation in `[-1, 1]`. Rank descending. `confidence` = normalized gap between top-1 and
  top-2 (e.g. `(s1 - s2)` mapped to a 0–1 display value), so a clear winner reads as high
  confidence and a tie as low.

Preprocessing pipeline before classify: `binTrace` → existing `spikeFilter` → `normalize`.
Templates are built from each site's calibration vectors (post-preprocess).

## Capture mechanics

- No worker change. The page already receives `{type:'samples', latencies}` continuously. A
  `Capture` controller records arrival-timestamped samples between `t_start` and `t_end`
  (`performance.now()` on receipt; 8 s window). On completion it returns the sample array for
  binning.
- Calibration opens/closes the site popup around the capture. Reveal/self-test use a countdown;
  reveal is a manual open, self-test is a page `window.open` of a random site.
- Fingerprinting requires the measurement loop to be running (otherwise no contention signal);
  the UI enforces this.

## UI (`public/index.html`, `public/app.js`, `public/style.css`)

New **"Website fingerprinting"** panel below the hex-dump panel:
- One row per candidate site: name, "Capture (k/3)" button, progress ticks.
- **Guess what I open** button → 3-2-1 countdown → records → shows results.
- **Self-test** button → page opens a random calibrated site → records → shows results.
- Results: a horizontal bar per site (correlation score) and a headline
  "You probably opened: <site> — <confidence>%". For self-test, also show actual vs predicted.
- Disabled with an explanatory note until measurement is running and at least two sites have
  calibration data.
- Honesty notes inline: per-machine/per-session calibration; page cache can't be reset from JS
  so signal weakens on repeat opens (strongest on first opens); accuracy is rough in a casual
  setting and below the paper's lab numbers; requires target activity on the same SSD.

State (in `app.js`): `calibration = Map<label, vector[]>`, `templates = Map<label, vector>`
rebuilt after each capture. Not persisted.

## Error handling

- Popup blocked / `window.open` returns null → show a message asking the visitor to allow
  popups (calibration) or to open the site manually.
- Capture with too few samples (e.g. measurement stopped mid-window) → discard, ask to retry.
- Classify with <2 calibrated sites → disabled with explanation.

## Testing

**Unit (`node --test`, pure):** `src/fingerprint.js`:
- `binTrace`: correct length; correct per-slice means; interpolation of empty slices.
- `normalize`: zero mean / unit std on varied input; all-equal input → zeros.
- `buildTemplate`: elementwise mean.
- `classify`: separates two distinct synthetic fingerprints; still correct when the test trace
  is lag-shifted within `maxLag`; returns a sensible ranking and lower confidence on ambiguous
  input.

**Manual checklist (browser/hardware):** start measurement → calibrate the candidate sites →
run Self-test a few times (expect mostly-correct) → run a blind Guess (open one yourself) and
confirm the prediction. Documented in the README.

## File layout (additions)

```
src/fingerprint.js          # pure classifier (binTrace, normalize, buildTemplate, classify)
test/fingerprint.test.js    # unit tests
public/app.js               # + capture controller, calibration/reveal/self-test wiring, results render
public/index.html           # + fingerprinting panel
public/style.css            # + panel/results styles
README.md                   # + fingerprinting manual checklist
```

## Honest limitations

- Closed-world only: predicts among calibrated sites; opening an uncalibrated site yields a
  (wrong) nearest match. Open-world "unknown" rejection is future work.
- Page-cache state can't be controlled from JS; repeat opens degrade the signal. Demo is
  strongest on first opens of each site.
- Casual-setting accuracy is well below the paper's controlled-automation F1 scores.
- Calibration is per machine and per browser session; not persisted.
