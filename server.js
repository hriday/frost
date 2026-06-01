import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.join(__dirname, 'public');
const SRC_DIR = path.join(__dirname, 'src');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
};

export function contentTypeFor(filePath) {
  return MIME[path.extname(filePath).toLowerCase()] || 'application/octet-stream';
}

function setIsolationHeaders(res) {
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
  res.setHeader('Cross-Origin-Embedder-Policy', 'require-corp');
}

// Confine `rel` within `baseDir`. Returns an absolute path, or null if it
// would escape the directory (path traversal).
function confine(baseDir, rel) {
  const resolved = path.resolve(baseDir, rel);
  if (resolved === baseDir || resolved.startsWith(baseDir + path.sep)) return resolved;
  return null;
}

// Map a request URL path to a file on disk. `/src/...` is served from the
// project-root src/ directory (so the page can import the shared ES modules);
// everything else is served from public/. Returns an absolute path, or null
// if the request escapes its allowed root.
export function resolveRequestPath(urlPath, { publicDir = PUBLIC_DIR, srcDir = SRC_DIR } = {}) {
  if (urlPath === '/src' || urlPath.startsWith('/src/')) {
    return confine(srcDir, urlPath.slice('/src/'.length));
  }
  const rel = urlPath === '/' ? 'index.html' : urlPath.replace(/^\/+/, '');
  return confine(publicDir, rel);
}

export function createFrostServer(publicDir = PUBLIC_DIR, srcDir = SRC_DIR) {
  return http.createServer((req, res) => {
    setIsolationHeaders(res);

    const urlPath = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    const resolved = resolveRequestPath(urlPath, { publicDir, srcDir });

    if (resolved === null) {
      res.writeHead(403); res.end('Forbidden'); return;
    }

    fs.readFile(resolved, (err, data) => {
      if (err) { res.writeHead(404); res.end('Not Found'); return; }
      res.writeHead(200, { 'Content-Type': contentTypeFor(resolved) });
      res.end(data);
    });
  });
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
if (isMain) {
  const port = Number(process.env.PORT) || 8080;
  createFrostServer().listen(port, () => {
    console.log(`FROST POC on http://localhost:${port}  (crossOriginIsolated enabled)`);
  });
}
