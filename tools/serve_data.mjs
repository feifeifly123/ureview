import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve, normalize, join, relative, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const DATA_DIR = resolve(__dirname, '..', 'data');
const PORT = parseInt(process.env.PORT || '7001', 10);

const MIME = { '.json': 'application/json' };

const server = createServer(async (req, res) => {
  // CORS — restrict to localhost origins
  const origin = req.headers.origin || '';
  const allowed = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin);
  res.setHeader('Access-Control-Allow-Origin', allowed ? origin : '');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }
  if (req.method !== 'GET') { res.writeHead(405); res.end(); return; }

  // Strip /data prefix if present (proxy forwards full path)
  const url = new URL(req.url, `http://localhost:${PORT}`);
  let pathname = decodeURIComponent(url.pathname);
  if (pathname.startsWith('/data')) pathname = pathname.slice('/data'.length);
  if (!pathname.startsWith('/')) pathname = '/' + pathname;

  // Resolve and guard against traversal.
  // Use path.relative so "/home/.../data-secret/x" next to DATA_DIR "/home/.../data"
  // does not slip past a simple startsWith prefix check.
  const filePath = normalize(join(DATA_DIR, pathname));
  const rel = relative(DATA_DIR, filePath);
  if (rel === '' || rel.startsWith('..') || isAbsolute(rel)) {
    res.writeHead(403); res.end('Forbidden'); return;
  }

  try {
    const content = await readFile(filePath);
    const ext = filePath.slice(filePath.lastIndexOf('.'));
    res.writeHead(200, {
      'Content-Type': MIME[ext] || 'application/octet-stream',
      'Cache-Control': 'no-cache',
    });
    res.end(content);
    console.log(`200 ${req.url}`);
  } catch {
    res.writeHead(404);
    res.end('Not Found');
    console.log(`404 ${req.url}`);
  }
});

const HOST = process.env.HOST || '0.0.0.0';

server.listen(PORT, HOST, () => {
  console.log(`Data server listening on http://${HOST}:${PORT}  (serving ${DATA_DIR})`);
});
