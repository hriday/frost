import { RingBuffer } from '../src/ring-buffer.js';
import { median, percentile } from '../src/stats.js';
import { spikeFilter } from '../src/spike-filter.js';

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
      for (const v of m.latencies) {
        raw.push(v);
        sampleCount++;
        if (v > SPIKE_MS) spikeCount++;
      }
    } else if (m.type === 'error') {
      setStatus(`Error: ${m.message}`);
      stop();
    }
  };
  return worker;
}

function stop() {
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

function loop() { updateStats(); drawChart(); }

function init() {
  showEnvironment();
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
