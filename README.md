# FROST

**Live demo: [frost.moosha.org](https://frost.moosha.org)**

A browser-only proof-of-concept of **FROST: Fingerprinting Remotely using OPFS-based SSD
Timing** ([paper](https://hannesweissteiner.com/pdfs/frost.pdf), Weissteiner et al.). From
plain JavaScript, the page times random reads against a large file in the Origin Private File
System (OPFS) and plots your SSD's access latency live. When anything else on the machine
touches the same SSD (an app launching, a website loading), contention pushes those latencies
up. The spikes are a side channel that leaks what you're doing.

Everything runs locally in your browser and measures only your own machine. No measurement
data leaves the page, and there is no backend storage.

> This is an unaffiliated reproduction for education and research. It is not the authors'
> code.

## What the demo does

- **Live SSD-contention monitor.** Creates a probe file in OPFS (size is up to you, 1–8 GB),
  runs timed random reads, and charts the latency trace with live stats (median, p95, read
  rate, spikes over 1 ms) and a spike-filtered overlay.
- **"Last read off the SSD" view.** Hex dump and grayscale swatch of the bytes just read. They
  come from the page's own random-filled probe file. OPFS is sandboxed, so the signal is the
  read *latency* and never anyone's data.
- **Website fingerprinting.** A closed-world version of the paper's attack. You calibrate by
  capturing a few traces each of YouTube, Wikipedia, Amazon, and example.com. Then the page
  guesses which of them you open in another tab. **Self-test** mode opens one at random and
  identifies it, so you can see it isn't rigged.

### Try it

1. Open [frost.moosha.org](https://frost.moosha.org) in a desktop browser. The Environment
   panel should show **Cross-origin isolated: yes** and **OPFS available: yes**.
2. Pick a probe size larger than your free RAM (so reads go to the SSD instead of the page
   cache) and click **Start**. Wait for "Preparing probe file… 100%".
3. Launch an app or load a heavy website and watch the trace spike.
4. For fingerprinting, capture each site about 3 times, then try **Self-test** or **Guess what
   I open**.
5. When you're done, click **Stop**, then **Delete probe file** to free the disk space.

Accuracy is rough in a casual setting and well below the paper's controlled-lab F1 scores.
JavaScript can't reset the OS page cache, so a site's signal is strongest the first time it's
opened. It also only works when the site's disk activity hits the same SSD as the probe file.
Calibration lives in the tab and is never stored or sent anywhere.

## Why the server matters

Browsers coarsen `performance.now()` unless the page is *cross-origin isolated*. Without it,
the timer is too coarse for the SSD signal. The bundled server sets these headers on every
response:

```
Cross-Origin-Opener-Policy: same-origin
Cross-Origin-Embedder-Policy: require-corp
```

Opening `public/index.html` directly over `file://` will **not** work. If a reverse proxy or
CDN sits in front of the server, make sure it passes these headers through unchanged.

## Run locally

Requires Node.js 22+. There are no dependencies, so `npm install` isn't needed.

```bash
npm start              # http://localhost:8080
PORT=3000 npm start
```

Or with Docker:

```bash
docker compose up -d --build   # binds 127.0.0.1:8013
```

## Test

```bash
npm test
```

The unit tests (`node --test`) cover the ring buffer, statistics, spike filter, hex dump,
trace classifier, and server (headers, 404, path-traversal guard, `/src` route). The parts
that depend on timing, OPFS, and the canvas vary by hardware, so they're checked by hand with
the steps in [Try it](#try-it).

## Project layout

```
server.js               zero-dependency static server; sets COOP/COEP, serves public/ and /src
public/
  index.html, style.css the page
  app.js                UI, live chart, stats, and fingerprinting capture controller
  probe-worker.js       Web Worker that owns all OPFS I/O and the timed read loop
src/                    pure logic shared by the browser and the Node tests
  ring-buffer.js, stats.js, spike-filter.js, hexdump.js
  fingerprint.js        trace binning and the lag-tolerant template-matching classifier
test/                   node:test unit tests
docs/superpowers/       design specs and implementation plans
frost.pdf               the original paper
```

## Scope

The demo covers the paper's core measurement primitive, live visualization, and a
per-visitor, closed-world website-fingerprinting demo that uses template matching. It leaves
out the paper's CNN classifier, open-world detection, application fingerprinting, and covert
channel.

## Credit

The attack is from *FROST: Fingerprinting Remotely using OPFS-based SSD Timing* by Hannes
Weissteiner et al. (TU Graz). All credit for the research goes to the authors.
