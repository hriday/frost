# FROST POC

Browser-only proof-of-concept of **FROST: Fingerprinting Remotely using OPFS-based SSD
Timing** (Weissteiner et al.). It creates a large file in the Origin Private File System
(OPFS), performs timed random reads against it, and plots the SSD access-latency trace live.
When other activity on the machine touches the same SSD, contention raises the read latencies
— visible as spikes in the trace.

Everything runs locally in your browser. No data leaves the page; there is no backend storage.

## Run

```bash
npm start          # serves http://localhost:8080
PORT=3000 npm start
```

The server sets `Cross-Origin-Opener-Policy: same-origin` and
`Cross-Origin-Embedder-Policy: require-corp` on every response. These enable
`crossOriginIsolated`, which unlocks the high-resolution `performance.now()` timer the
measurement needs. Opening the files directly (`file://`) will **not** work.

## Test

```bash
npm test           # runs the unit tests via node --test
```

Unit tests cover the ring buffer, statistics, the spike filter, and the server (headers,
404, path-traversal guard, and the `/src` module route). The timing/OPFS/canvas parts are
hardware-dependent and verified with the manual checklist below.

## How it works

- `server.js` — zero-dependency Node static server. Serves `public/` and the shared ES
  modules under `/src` (the page imports them), and sets the COOP/COEP isolation headers.
- `public/probe-worker.js` — a Web Worker that owns all OPFS I/O. It provisions the probe
  file (reused across reloads), fills it with random data to defeat page deduplication, then
  loops timed random reads (`performance.now()` around `SyncAccessHandle.read`) and posts
  sample batches to the page. It releases the OPFS handle on **Stop**.
- `public/app.js` — wires the controls to a single persistent worker, buffers samples,
  computes live stats and the spike-filtered overlay, and renders the canvas chart.
- `src/` — pure, unit-tested logic (`RingBuffer`, `median`/`percentile`, `spikeFilter`),
  imported unchanged by both the browser and the Node test runner.

## Manual test checklist

1. `npm start`, open `http://localhost:8080`. Confirm **Cross-origin isolated: yes** and
   **OPFS available: yes** in the Environment panel.
2. Pick a file size larger than your free RAM (heed the cache warning), click **Start**, accept
   the confirmation. Watch "Preparing probe file… N%" complete.
3. A baseline latency trace appears and updates live.
4. Launch a native app (or load a heavy website) on the same disk. Observe latency spikes in
   the trace and the **spikes >1ms** counter rising.
5. Click **Stop** — the trace freezes. Click **Delete probe file** — the Storage line drops.

## Deployment (frost.moosha.org)

Run `server.js` behind your TLS terminator. The COOP/COEP headers must reach the browser
unmodified, so if a reverse proxy or CDN sits in front, ensure it does not strip them.

## Scope

This POC implements the paper's core measurement primitive and live visualization only. The
CNN fingerprinting and covert-channel constructions from the paper are intentionally out of
scope.
