import { RingBuffer } from '../src/ring-buffer.js';
import { median, percentile } from '../src/stats.js';
import { spikeFilter } from '../src/spike-filter.js';
import { hexdump, byteStats } from '../src/hexdump.js';
import { binTrace, normalize, buildTemplate, classify } from '../src/fingerprint.js';

const CAPACITY = 4000;        // samples kept for the chart
const CAP_GB = 8;             // hard file-size cap
const SPIKE_MS = 1;

const $ = (id) => document.getElementById(id);
const raw = new RingBuffer(CAPACITY);
let worker = null;
let spikeCount = 0;
let sampleCount = 0;
let lastRateStamp = performance.now();
let lastRateCount = 0;
let rate = 0;

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
let capturing = false;         // true while a single capture window is in flight

function setStatus(text) { $('status').textContent = text; }

function fmtBytes(b) {
  const gb = b / (1024 ** 3);
  return gb >= 1 ? `${gb.toFixed(2)} GB` : `${(b / (1024 ** 2)).toFixed(0)} MB`;
}

async function showEnvironment() {
  $('coi').textContent = self.crossOriginIsolated ? 'yes' : 'NO';
  $('coi').className = self.crossOriginIsolated ? 'ok' : 'bad';
  $('mem').textContent = navigator.deviceMemory ? `${navigator.deviceMemory} GB` : 'unknown';
  const opfsOk = !!(navigator.storage && navigator.storage.getDirectory);
  $('opfs').textContent = opfsOk ? 'yes' : 'NO';
  $('opfs').className = opfsOk ? 'ok' : 'bad';
  try {
    const est = await navigator.storage.estimate();
    $('quota').textContent = `${fmtBytes(est.usage || 0)} used / ${fmtBytes(est.quota || 0)} quota`;
  } catch { $('quota').textContent = 'unavailable'; }
}

function cacheWarning(sizeBytes) {
  const memGB = navigator.deviceMemory;
  if (!memGB) return '';
  const fileGB = sizeBytes / (1024 ** 3);
  if (fileGB < memGB * 1.5) {
    return `⚠ File (${fileGB.toFixed(1)} GB) may fit in the page cache on this ` +
           `~${memGB} GB machine; the SSD signal could be weak. Consider a larger file.`;
  }
  return '';
}

function ensureWorker() {
  if (worker) return worker;
  worker = new Worker('./probe-worker.js', { type: 'module' });
  worker.onmessage = (e) => {
    const m = e.data;
    if (m.type === 'status') setStatus(m.message);
    else if (m.type === 'fillProgress') {
      const pct = ((m.written / m.total) * 100).toFixed(0);
      setStatus(`Preparing probe file… ${pct}% (${fmtBytes(m.written)} / ${fmtBytes(m.total)})`);
    } else if (m.type === 'samples') {
      const arrivedAt = performance.now();
      for (const v of m.latencies) {
        raw.push(v);
        sampleCount++;
        if (v > SPIKE_MS) spikeCount++;
        if (captureSink) captureSink({ t: arrivedAt, latency: v });
      }
    } else if (m.type === 'dump') {
      renderDump(m.offset, m.readSize, m.bytes);
    } else if (m.type === 'error') {
      setStatus(`Error: ${m.message}`);
      stop();
    }
  };
  return worker;
}

function stop() {
  measuring = false;
  if (worker) worker.postMessage({ type: 'stop' });
  $('start').disabled = false;
  $('stop').disabled = true;
}

function updateStats() {
  const arr = raw.toArray();
  const now = performance.now();
  if (now - lastRateStamp >= 1000) {
    rate = Math.round((sampleCount - lastRateCount) * 1000 / (now - lastRateStamp));
    lastRateStamp = now; lastRateCount = sampleCount;
  }
  const last = arr.length ? arr[arr.length - 1] : NaN;
  $('cur').textContent = isNaN(last) ? '—' : `${last.toFixed(3)} ms`;
  $('median').textContent = arr.length ? `${median(arr).toFixed(3)} ms` : '—';
  $('p95').textContent = arr.length ? `${percentile(arr, 95).toFixed(3)} ms` : '—';
  $('rate').textContent = `${rate} /s`;
  $('spikes').textContent = String(spikeCount);
}

function drawChart() {
  const c = $('chart');
  const ctx = c.getContext('2d');
  const w = c.width, h = c.height;
  ctx.clearRect(0, 0, w, h);
  const arr = raw.toArray();
  if (arr.length < 2) { requestAnimationFrame(loop); return; }

  const smooth = spikeFilter(arr, { thresholdMs: SPIKE_MS, window: 100 });
  const maxY = Math.max(0.5, ...smooth) * 1.1;
  const x = (i) => (i / (arr.length - 1)) * w;
  const y = (v) => h - Math.min(v, maxY) / maxY * h;

  // raw trace (faint)
  ctx.strokeStyle = 'rgba(120,170,255,0.35)';
  ctx.beginPath();
  arr.forEach((v, i) => i ? ctx.lineTo(x(i), y(v)) : ctx.moveTo(x(i), y(v)));
  ctx.stroke();

  // smoothed trace (bright)
  ctx.strokeStyle = '#5cf';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  smooth.forEach((v, i) => i ? ctx.lineTo(x(i), y(v)) : ctx.moveTo(x(i), y(v)));
  ctx.stroke();

  // y-axis label
  ctx.fillStyle = '#9ab';
  ctx.font = '11px monospace';
  ctx.fillText(`${maxY.toFixed(2)} ms`, 4, 12);
  ctx.fillText('0 ms', 4, h - 4);

  requestAnimationFrame(loop);
}

function drawSwatch(bytes) {
  const c = $('swatch');
  const ctx = c.getContext('2d');
  const cols = 16;
  const rows = Math.ceil(bytes.length / cols);
  const cw = c.width / cols;
  const ch = c.height / rows;
  for (let i = 0; i < bytes.length; i++) {
    const v = bytes[i];                 // 0..255 -> grayscale pixel
    ctx.fillStyle = `rgb(${v},${v},${v})`;
    ctx.fillRect((i % cols) * cw, Math.floor(i / cols) * ch, Math.ceil(cw), Math.ceil(ch));
  }
}

function renderDump(offset, readSize, bytes) {
  $('dumpMeta').textContent =
    `${bytes.length} bytes from file offset 0x${offset.toString(16)} (read size ${fmtBytes(readSize)})`;
  $('hex').textContent = hexdump(bytes);
  const s = byteStats(bytes);
  $('dumpHuman').textContent =
    `In plain terms: these are random bytes this page itself wrote to its own probe file — ` +
    `${s.printablePct}% happen to be printable characters, ${s.distinct}/${s.total} distinct values, ` +
    `no readable message. That's expected: the leak is in how long the read took, not in these bytes.`;
  drawSwatch(bytes);
}

function loop() { updateStats(); drawChart(); }

// ---- Website fingerprinting ----

function fpStatus(text) { $('fpStatus').textContent = text; }

function captureWindow(ms) {
  return new Promise((resolve) => {
    const buf = [];
    capturing = true;
    setFpBusy(true);
    captureSink = (s) => buf.push(s);
    setTimeout(() => {
      captureSink = null;
      capturing = false;
      setFpBusy(false);
      resolve(buf);
    }, ms);
  });
}

// Disable/enable all fingerprinting buttons while a capture window is open.
function setFpBusy(busy) {
  for (const btn of document.querySelectorAll('#fpSites button')) btn.disabled = busy;
  $('fpGuess').disabled = busy || templates.size < 2;
  $('fpSelfTest').disabled = busy || templates.size < 2;
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
  if (capturing) { fpStatus('A capture is already running — wait for it to finish.'); return; }
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
  if (capturing) { fpStatus('A capture is already running — wait for it to finish.'); return; }
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
  if (capturing) { fpStatus('A capture is already running — wait for it to finish.'); return; }
  if (templates.size < 2) { fpStatus('Calibrate at least two sites first.'); return; }
  if (!measuring) { fpStatus('Start the SSD measurement first.'); return; }
  const labels = [...templates.keys()];
  const pick = labels[Math.floor(Math.random() * labels.length)];
  const site = SITES.find((s) => s.label === pick);
  const popup = window.open(site.url, '_blank');
  if (!popup) { fpStatus('Popup blocked — allow popups so self-test can open a site.'); return; }
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

function init() {
  showEnvironment();
  initFingerprint();
  const sizeInput = $('size');
  const updateWarn = () => {
    const bytes = Number(sizeInput.value) * (1024 ** 3);
    $('sizeLabel').textContent = `${sizeInput.value} GB`;
    $('warn').textContent = cacheWarning(bytes);
  };
  sizeInput.addEventListener('input', updateWarn);
  updateWarn();

  $('start').addEventListener('click', () => {
    if (!self.crossOriginIsolated) {
      setStatus('Not cross-origin isolated — high-resolution timer unavailable. ' +
                'Serve via the included server.js so COOP/COEP headers are set.');
      return;
    }
    const gb = Math.min(CAP_GB, Math.max(1, Number(sizeInput.value)));
    const bytes = gb * (1024 ** 3);
    if (!confirm(`This will create a ${gb} GB file on your disk (deletable afterwards). Continue?`)) return;
    const readSize = Number($('readSize').value);
    spikeCount = 0; sampleCount = 0; lastRateCount = 0;
    $('start').disabled = true; $('stop').disabled = false;
    measuring = true;
    ensureWorker().postMessage({ type: 'start', sizeBytes: bytes, readSize });
  });

  $('stop').addEventListener('click', stop);

  $('delete').addEventListener('click', () => {
    ensureWorker().postMessage({ type: 'delete' });
    setTimeout(showEnvironment, 500);
  });

  requestAnimationFrame(loop);
}

init();
