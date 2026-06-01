// FROST OPFS measurement engine. Runs in a Web Worker because
// createSyncAccessHandle() and its read/write are synchronous.

const FILE_NAME = 'frost-probe.bin';
const FILL_CHUNK = 8 * 1024 * 1024; // 8 MiB
const BATCH_MS = 16;                // flush samples to the page ~60x/sec
const DUMP_MS = 350;                // send a byte sample to the page ~3x/sec
const DUMP_BYTES = 256;             // how many bytes of the last read to show

let handle = null;
let running = false;

function post(type, payload = {}) { self.postMessage({ type, ...payload }); }

async function openHandle() {
  const root = await navigator.storage.getDirectory();
  const fh = await root.getFileHandle(FILE_NAME, { create: true });
  return fh.createSyncAccessHandle();
}

function makeRandomChunk() {
  const chunk = new Uint8Array(FILL_CHUNK);
  // getRandomValues caps at 65536 bytes per call.
  for (let off = 0; off < chunk.length; off += 65536) {
    crypto.getRandomValues(chunk.subarray(off, Math.min(off + 65536, chunk.length)));
  }
  return chunk;
}

async function provision(sizeBytes) {
  if (handle) { try { handle.close(); } catch {} handle = null; }
  handle = await openHandle();
  if (handle.getSize() === sizeBytes) {
    post('status', { phase: 'ready', message: 'Reusing existing probe file.' });
    return;
  }
  handle.truncate(sizeBytes);
  const chunk = makeRandomChunk();
  let written = 0;
  while (written < sizeBytes) {
    const n = Math.min(FILL_CHUNK, sizeBytes - written);
    // Mutate a few offset-dependent bytes so blocks are not identical (defeats dedup).
    chunk[0] = written & 0xff;
    chunk[1] = (written >> 8) & 0xff;
    chunk[2] = (written >> 16) & 0xff;
    handle.write(chunk.subarray(0, n), { at: written });
    written += n;
    post('fillProgress', { written, total: sizeBytes });
  }
  handle.flush();
  post('status', { phase: 'ready', message: 'Probe file ready.' });
}

function measureLoop(sizeBytes, readSize) {
  const buf = new Uint8Array(readSize);
  const maxOffset = Math.max(0, sizeBytes - readSize);
  let batch = [];
  let lastFlush = performance.now();
  let lastDump = 0;
  let lastOffset = 0;

  function tick() {
    if (!running) return;
    // Run a burst of reads, then yield so messages can flush.
    for (let i = 0; i < 64 && running; i++) {
      const offset = Math.floor(Math.random() * (maxOffset / readSize)) * readSize;
      const t0 = performance.now();
      handle.read(buf, { at: offset });
      const dt = performance.now() - t0;
      batch.push(dt);
      lastOffset = offset;
    }
    const now = performance.now();
    if (now - lastFlush >= BATCH_MS && batch.length) {
      post('samples', { latencies: batch });
      batch = [];
      lastFlush = now;
    }
    // Occasionally ship the bytes of the most recent read so the page can
    // show what actually came off the disk (our own random probe data).
    if (now - lastDump >= DUMP_MS) {
      post('dump', { offset: lastOffset, readSize, bytes: buf.slice(0, DUMP_BYTES) });
      lastDump = now;
    }
    setTimeout(tick, 0);
  }
  tick();
}

self.onmessage = async (e) => {
  const msg = e.data;
  try {
    if (msg.type === 'start') {
      if (running) return; // ignore overlapping start; stop first
      if (!(msg.sizeBytes > 0) || !(msg.readSize > 0) || msg.readSize >= msg.sizeBytes) {
        post('error', { message: 'Invalid sizeBytes/readSize (need readSize < sizeBytes, both > 0).' });
        return;
      }
      post('status', { phase: 'provisioning', message: 'Preparing probe file…' });
      await provision(msg.sizeBytes);
      running = true;
      post('status', { phase: 'measuring', message: 'Measuring SSD contention…' });
      measureLoop(msg.sizeBytes, msg.readSize);
    } else if (msg.type === 'stop') {
      running = false;
      if (handle) { try { handle.flush(); } catch {} try { handle.close(); } catch {} handle = null; }
      post('status', { phase: 'stopped', message: 'Stopped.' });
    } else if (msg.type === 'delete') {
      running = false;
      if (handle) { try { handle.close(); } catch {} handle = null; }
      const root = await navigator.storage.getDirectory();
      await root.removeEntry(FILE_NAME).catch(() => {});
      post('status', { phase: 'deleted', message: 'Probe file deleted.' });
    }
  } catch (err) {
    running = false;
    post('error', { message: String(err && err.message || err) });
  }
};
