# FROST POC — Design

**Date:** 2026-05-31
**Target host:** https://frost.moosha.org
**Source:** `frost.pdf` — *FROST: Fingerprinting Remotely using OPFS-based SSD Timing* (Weissteiner et al., TU Graz).

## Goal

A browser-only proof-of-concept that reproduces the **core measurement primitive** of the
FROST paper: using the Origin Private File System (OPFS) to perform timed random reads
against the visitor's SSD, and visualizing the resulting access-latency trace live. When
other activity on the machine touches the same disk (a website loading, an app launching),
SSD contention raises the read latencies, and those spikes are visible in the trace.

Everything runs in the visitor's own browser and measures the visitor's own machine. No
logins, no database, no measurement data ever leaves the browser.

## Scope

**In scope (decided):**
- Live SSD-contention monitor: create a large OPFS file, run timed random reads, plot the
  latency trace in real time with live statistics.
- A small self-contained Node server that serves the page and sets the cross-origin
  isolation headers the high-resolution timer requires.
- User-controlled probe-file size (capped default ~2 GB) with an explicit disk-usage
  warning and a cleanup button.

**Out of scope (decided):**
- CNN-based website/application fingerprinting (needs training data + a model + automation).
- Covert channel (needs two coordinated parties).
- The user-selected-file (File System Access API) measurement primitive — OPFS only.

## Why the headers matter

Browsers coarsen `performance.now()` unless the page is *cross-origin isolated*. The paper's
Figure 2 shows that without isolation the timer rounds to ~100 µs steps and the SSD signal is
unreadable; with isolation the timer is fine-grained (~5 µs in Chrome) and the trace becomes
usable. Therefore every response from the server MUST carry:

- `Cross-Origin-Opener-Policy: same-origin`
- `Cross-Origin-Embedder-Policy: require-corp`

The page checks `self.crossOriginIsolated` at load and refuses to start (with an explanation)
if it is false.

## Architecture

Three components, each with a single responsibility.

### 1. `server.js` — static server with isolation headers

- Node built-in `http` + `fs` only. No dependencies, no `npm install`.
- Serves files from `public/` with correct MIME types.
- Adds `Cross-Origin-Opener-Policy: same-origin` and
  `Cross-Origin-Embedder-Policy: require-corp` to every response.
- Port from `PORT` env (default 8080). Binds `0.0.0.0`.
- 404 for unknown paths; no directory traversal (resolve and confine to `public/`).

### 2. `public/` — the page (UI + orchestration)

Files: `index.html`, `app.js`, `style.css`.

Responsibilities:
- Render an explanation of what FROST is and that it measures the visitor's own machine.
- Show environment status: `crossOriginIsolated`, `navigator.deviceMemory` (if available),
  `navigator.storage.estimate()` usage/quota.
- Controls:
  - Probe-file size: slider/input, range ~1–8 GB, default 2 GB, hard cap enforced.
  - Read size: select among 4 KB / 64 KB / 128 KB (default) / 512 KB.
  - Start / Stop measurement.
  - Delete probe file (cleanup).
- Live latency chart on a `<canvas>`, drawn under `requestAnimationFrame` from a ring buffer.
- Live stats: current latency, median, p95, samples/sec, spike count (> 1 ms).
- Smoothed overlay computed with the paper's spike filter (any sample > 1 ms replaced by the
  mean of its ~100 neighbors), shown alongside the raw trace.
- Honesty guard: if the chosen file size is not comfortably larger than `deviceMemory`,
  surface a warning that the page cache may absorb the signal.
- Up-front confirmation before creating a large file.

The page owns no synchronous disk work; it delegates all of that to the worker and only
receives sample batches.

### 3. `public/probe-worker.js` — measurement engine (Web Worker)

OPFS's synchronous access handle (`createSyncAccessHandle`) is only available inside a
Worker, so all disk I/O lives here.

- Setup: `root = await navigator.storage.getDirectory()`,
  `fh = await root.getFileHandle('frost-probe.bin', {create:true})`,
  `h = await fh.createSyncAccessHandle()`.
- Provision the file to the target size:
  - If `h.getSize()` already equals the target, skip (re-use across reloads).
  - Otherwise `h.truncate(target)` and fill with random data to defeat page deduplication.
  - **Fill strategy:** generate one ~8 MB random chunk with `crypto.getRandomValues`, then
    write it across the file, mutating a few offset-dependent bytes per write so blocks are
    not identical. Report fill progress to the page.
- Measurement loop:
  - Pick a random *aligned* offset in `[0, size - readSize]`.
  - `t0 = performance.now()`; `h.read(buf, {at: offset})`; `dt = performance.now() - t0`.
  - Reuse a single `Uint8Array(readSize)` buffer.
  - Accumulate samples and `postMessage` them in batches (e.g. every ~16 ms / N samples) to
    avoid flooding the main thread.
- Messages handled: `start {sizeBytes, readSize}`, `stop`, `delete`. Emits:
  `status`, `fillProgress`, `samples`, `error`.

## Data flow

```
probe-worker (sync OPFS reads, performance.now)
   --> postMessage batches of {t, latency} -->
app.js ring buffer
   --> requestAnimationFrame --> canvas chart + stats
```

No data path leaves the browser. The server is a dumb static file server.

## Error handling

- `crossOriginIsolated === false` → block start, explain the header requirement.
- OPFS / `createSyncAccessHandle` unsupported → feature-detect, show an unsupported message
  naming the browser requirement (Chrome/Firefox/Safari, OPFS sync handles).
- Quota exceeded while provisioning → catch, report the largest size that fit, offer a
  smaller size.
- Worker error → surface message to the page, stop cleanly, leave the file deletable.

## Testing

**Unit tests (`node --test`, zero deps)** — pure logic extracted into importable modules:
- Spike filter: > 1 ms samples replaced by neighbor mean; edges handled; sub-threshold
  samples untouched.
- Statistics: median and p95 on known inputs, including empty/singleton.
- Ring buffer: wraparound, capacity, ordered read-out.

**Manual test checklist** (browser/hardware-dependent, documented in README):
1. Start server, open page → `crossOriginIsolated` shows true.
2. Build a probe file → fill progress completes, baseline latency trace appears.
3. Launch a native app or load a heavy website → observe latency spikes in the trace.
4. Stop → trace freezes. Delete probe file → storage estimate drops.

## File layout

```
server.js
public/
  index.html
  style.css
  app.js
  probe-worker.js
src/                # pure, unit-tested logic imported by app.js (as ES modules)
  spike-filter.js
  stats.js
  ring-buffer.js
test/
  *.test.js
README.md
```

(`src/` modules are plain ES modules importable both by the browser page and by `node --test`.)

## Open risks / honest limitations

- Signal quality depends on real hardware (single SSD, file larger than free RAM). On
  high-RAM machines with a small file the trace may stay flat; the UI warns about this.
- Provisioning a multi-GB file is slow on first run; mitigated by reuse across reloads and a
  progress indicator.
- Firefox caps OPFS at 10 GB/origin; within our ≤8 GB cap this is fine.
