import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { createFrostServer, contentTypeFor } from '../server.js';

test('contentTypeFor maps known extensions', () => {
  assert.equal(contentTypeFor('a.html'), 'text/html; charset=utf-8');
  assert.equal(contentTypeFor('a.js'), 'text/javascript; charset=utf-8');
  assert.equal(contentTypeFor('a.css'), 'text/css; charset=utf-8');
  assert.equal(contentTypeFor('a.unknown'), 'application/octet-stream');
});

const server = createFrostServer();
await new Promise((r) => server.listen(0, r));
const port = server.address().port;
const base = `http://127.0.0.1:${port}`;
after(() => server.close());

test('serves index.html with isolation headers', async () => {
  const res = await fetch(`${base}/`);
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('cross-origin-opener-policy'), 'same-origin');
  assert.equal(res.headers.get('cross-origin-embedder-policy'), 'require-corp');
  assert.match(res.headers.get('content-type'), /text\/html/);
});

test('unknown path returns 404', async () => {
  const res = await fetch(`${base}/does-not-exist`);
  assert.equal(res.status, 404);
});

test('blocks path traversal (encoded, reaches the guard)', async () => {
  const status = await new Promise((resolve, reject) => {
    http.get(`${base}/..%2fpackage.json`, (res) => { res.resume(); resolve(res.statusCode); })
        .on('error', reject);
  });
  assert.equal(status, 403);
});
