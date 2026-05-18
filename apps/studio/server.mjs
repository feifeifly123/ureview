#!/usr/bin/env node
/**
 * OpenAgent Studio — authoring server.
 *
 * Binds 0.0.0.0 to allow LAN access. No authentication — only run on trusted
 * networks. Studio has no ability to publish to R2 by design; pushing data to
 * R2 is CLI-only via tools/publish_r2.py.
 *
 * Routes (see apps/studio/README.md for the UX flow):
 *   GET  /                       → SPA shell
 *   GET  /static/*               → bundled static assets
 *   GET  /api/reviews            → list existing reviews (title + status)
 *   GET  /api/review/:id         → one review JSON verbatim
 *   POST /api/reviews            → save a new review (validate → write → reindex)
 *   GET  /api/daily              → fetch HF Daily papers (via tools/fetch_hf.py --json-stdout)
 *   GET  /api/arxiv?id=...       → fetch arXiv metadata for a paper
 */

import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { readdir, readFile, writeFile, mkdtemp, rm, stat } from 'node:fs/promises';
import { existsSync, mkdirSync } from 'node:fs';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { tmpdir } from 'node:os';
import { dirname, join, extname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HOST = '0.0.0.0';
const PORT = Number(process.env.STUDIO_PORT) || 4311;

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '..', '..');
const REVIEWS_DIR = join(REPO_ROOT, 'data', 'reviews');
const PUBLIC_DIR = join(__dirname, 'public');

// ---------- auth: token + sessions + login throttle ----------
//
// Threat model: LAN access (server binds 0.0.0.0) means any same-network user
// can hit :4311. We gate all /api/* behind a single shared token that's
// generated fresh per process and printed to stdout on startup. Login swaps
// the token for an HttpOnly + SameSite=Strict session cookie. Sessions live
// only in memory — restarting the process logs everyone out, which is the
// point: it doubles as a kill switch if the token leaks.
//
// Assumptions:
//   - The deploy network is trusted at the transport layer (HTTP, no TLS).
//     If you need HTTPS, terminate it in a reverse proxy in front.
//   - Single human user. No role model, no audit log.

const STUDIO_TOKEN = (process.env.STUDIO_TOKEN || randomBytes(24).toString('base64url')).trim();
const STUDIO_TOKEN_FROM_ENV = !!process.env.STUDIO_TOKEN;
const STUDIO_TOKEN_BUF = Buffer.from(STUDIO_TOKEN, 'utf-8');

const SESSION_TTL_MS = 12 * 60 * 60 * 1000;   // 12 hours
const SESSION_COOKIE = 'studio_session';
const sessions = new Map();                    // sessionId → expiry timestamp

const LOGIN_MAX_FAILURES = 5;
const LOGIN_LOCK_MS = 5 * 60 * 1000;
const loginAttempts = new Map();               // remoteAddr → { failures, lockedUntil }

function newSession() {
  const id = randomBytes(32).toString('base64url');
  sessions.set(id, Date.now() + SESSION_TTL_MS);
  return id;
}

function sweepSessions() {
  const now = Date.now();
  for (const [id, exp] of sessions) if (exp <= now) sessions.delete(id);
}

function parseCookies(req) {
  const raw = req.headers.cookie;
  if (!raw) return {};
  const out = {};
  for (const part of raw.split(';')) {
    const eq = part.indexOf('=');
    if (eq < 0) continue;
    out[part.slice(0, eq).trim()] = part.slice(eq + 1).trim();
  }
  return out;
}

function isAuthed(req) {
  sweepSessions();
  const sid = parseCookies(req)[SESSION_COOKIE];
  if (!sid) return false;
  const exp = sessions.get(sid);
  return typeof exp === 'number' && exp > Date.now();
}

function clientAddr(req) {
  // Trust only the socket. X-Forwarded-For is trivially forgeable on a LAN.
  // Behind a reverse proxy all requests look like 127.0.0.1, which means the
  // throttle becomes global — acceptable for a single-user tool.
  return req.socket.remoteAddress || 'unknown';
}

function loginLocked(addr) {
  const rec = loginAttempts.get(addr);
  if (!rec) return 0;
  if (rec.lockedUntil && rec.lockedUntil > Date.now()) return rec.lockedUntil;
  if (rec.lockedUntil && rec.lockedUntil <= Date.now()) loginAttempts.delete(addr);
  return 0;
}

function recordLoginFailure(addr) {
  const rec = loginAttempts.get(addr) ?? { failures: 0, lockedUntil: 0 };
  rec.failures += 1;
  if (rec.failures >= LOGIN_MAX_FAILURES) rec.lockedUntil = Date.now() + LOGIN_LOCK_MS;
  loginAttempts.set(addr, rec);
}

function clearLoginFailures(addr) {
  loginAttempts.delete(addr);
}

function tokensEqual(a, b) {
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

// Cheap second-layer CSRF check (SameSite=Strict cookies are the first).
// Only enforced on mutating endpoints (POST/PUT/DELETE/PATCH).
function originOk(req) {
  const method = req.method || 'GET';
  if (!['POST', 'PUT', 'DELETE', 'PATCH'].includes(method)) return true;
  const origin = req.headers.origin;
  if (!origin) return false;
  try {
    const host = req.headers.host;
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}

// ---------- small helpers ----------

const MIME = {
  '.html':  'text/html; charset=utf-8',
  '.js':    'application/javascript; charset=utf-8',
  '.css':   'text/css; charset=utf-8',
  '.json':  'application/json; charset=utf-8',
  '.svg':   'image/svg+xml',
  '.ico':   'image/x-icon',
  '.woff2': 'font/woff2',
  '.woff':  'font/woff',
};

function send(res, code, body, headers = {}) {
  res.writeHead(code, { 'content-type': 'application/json; charset=utf-8', ...headers });
  res.end(typeof body === 'string' ? body : JSON.stringify(body));
}

function sendText(res, code, text, contentType = 'text/plain; charset=utf-8') {
  res.writeHead(code, { 'content-type': contentType });
  res.end(text);
}

async function readBody(req, maxBytes = 512_000) {
  return new Promise((resolve, reject) => {
    let total = 0;
    const chunks = [];
    req.on('data', (chunk) => {
      total += chunk.length;
      if (total > maxBytes) {
        reject(new Error('request body too large'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf-8')));
    req.on('error', reject);
  });
}

function runChild(cmd, args, opts = {}) {
  return new Promise((resolve) => {
    const proc = spawn(cmd, args, {
      cwd: opts.cwd ?? REPO_ROOT,
      env: { ...process.env, ...(opts.env ?? {}) },
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    proc.stdout.on('data', (d) => (stdout += d.toString('utf-8')));
    proc.stderr.on('data', (d) => (stderr += d.toString('utf-8')));
    proc.on('close', (code) => resolve({ code, stdout, stderr }));
    if (opts.stdin) {
      proc.stdin.write(opts.stdin);
      proc.stdin.end();
    }
  });
}

// ---------- static file serving ----------

async function serveStatic(req, res, relativePath) {
  const safePath = relativePath.replace(/\.\.+/g, '').replace(/^\/+/, '');
  const filePath = join(PUBLIC_DIR, safePath || 'index.html');
  try {
    const body = await readFile(filePath);
    res.writeHead(200, { 'content-type': MIME[extname(filePath)] ?? 'application/octet-stream' });
    res.end(body);
  } catch {
    sendText(res, 404, 'not found');
  }
}

// KaTeX assets live in apps/web/node_modules/katex/dist (pnpm workspace).
// Studio is vanilla — no bundler, no own node_modules — so we proxy them
// directly. The contrib/ subtree (auto-render) and fonts/ are needed too.
const KATEX_DIR = join(REPO_ROOT, 'apps', 'web', 'node_modules', 'katex', 'dist');

async function serveKatex(req, res, relativePath) {
  const safePath = relativePath.replace(/\.\.+/g, '').replace(/^\/+/, '');
  const filePath = join(KATEX_DIR, safePath);
  try {
    const body = await readFile(filePath);
    res.writeHead(200, {
      'content-type': MIME[extname(filePath)] ?? 'application/octet-stream',
      'cache-control': 'public, max-age=86400',
    });
    res.end(body);
  } catch {
    sendText(res, 404, 'not found');
  }
}

// ---------- review inventory ----------

async function* walkJson(dir) {
  // Recursive walk: yields .json file paths under dir. Used so we can pick up
  // both new-style ids (data/reviews/2401.12345.json) and old-style
  // (data/reviews/math/0211159.json).
  if (!existsSync(dir)) return;
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) yield* walkJson(full);
    else if (entry.isFile() && entry.name.endsWith('.json')) yield full;
  }
}

async function listReviews() {
  const out = [];
  for await (const path of walkJson(REVIEWS_DIR)) {
    const raw = await readFile(path, 'utf-8');
    let j;
    try { j = JSON.parse(raw); } catch { continue; }
    out.push({
      id: j.id,
      title: j.title,
      date: j.date,
      paper_url: j.paper_url,
      authors: j.authors || [],
      arxiv_categories: j.arxiv_categories || [],
    });
  }
  out.sort((a, b) => (b.date || '').localeCompare(a.date || ''));
  return out;
}

async function readReview(id) {
  // arxiv ids include "/" for old-style (math/0211159); reject only path-
  // traversal characters, not the slash itself.
  if (!/^[A-Za-z0-9./_\-]+$/.test(id) || id.includes('..')) throw new Error('bad id');
  const p = join(REVIEWS_DIR, `${id}.json`);
  const raw = await readFile(p, 'utf-8');
  return JSON.parse(raw);
}

// ---------- save review ----------

async function saveReview(body) {
  let review;
  try { review = JSON.parse(body); } catch (e) { return { code: 400, error: `invalid JSON: ${e.message}` }; }

  if (!review.id || !/^(\d{4}\.\d{4,5}|[a-z-]+\/\d{7})$/.test(review.id)) {
    return { code: 400, error: 'review.id missing or malformed (want arxiv id like 2401.12345 or math/0211159)' };
  }

  // Old-style arxiv ids contain a slash (e.g. math/0211159). Both the temp
  // path and the final on-disk path need their parent dirs created first.
  const tmp = await mkdtemp(join(tmpdir(), 'studio-review-'));
  const tmpFile = join(tmp, `${review.id}.json`);
  mkdirSync(dirname(tmpFile), { recursive: true });
  await writeFile(tmpFile, JSON.stringify(review, null, 2), 'utf-8');

  const validator = await runChild('python3', [
    join(REPO_ROOT, 'tools', 'validate_data.py'),
    '--single', tmpFile,
  ]);

  if (validator.code !== 0) {
    await rm(tmp, { recursive: true, force: true });
    return { code: 422, error: `schema validation failed: ${validator.stderr.trim() || validator.stdout.trim()}` };
  }

  if (!existsSync(REVIEWS_DIR)) mkdirSync(REVIEWS_DIR, { recursive: true });
  const dest = join(REVIEWS_DIR, `${review.id}.json`);
  mkdirSync(dirname(dest), { recursive: true });
  await writeFile(dest, JSON.stringify(review, null, 2), 'utf-8');
  await rm(tmp, { recursive: true, force: true });

  // Rebuild indexes so /api/reviews reflects the new entry.
  const build = await runChild('python3', [join(REPO_ROOT, 'tools', 'build_indexes.py')]);
  if (build.code !== 0) {
    return { code: 500, error: `saved, but index rebuild failed: ${build.stderr.trim() || build.stdout.trim()}` };
  }

  return { code: 200, body: { ok: true, id: review.id, indexes_rebuilt: true } };
}

// ---------- arXiv bridge ----------

async function fetchArxiv(id) {
  // Accept new-style (NNNN.NNNNN, optional vN), old-style (math/NNNNNNN), and
  // raw arxiv URL fragments — fetch_arxiv.py normalises.
  if (!/^[A-Za-z0-9./_\-]+$/.test(id || '')) return { code: 400, error: 'bad arxiv id' };
  const r = await runChild('python3', [join(REPO_ROOT, 'tools', 'fetch_arxiv.py'), '--id', id]);
  if (r.code !== 0) return { code: 502, error: r.stderr.trim() || 'fetch_arxiv.py failed' };
  try {
    return { code: 200, body: JSON.parse(r.stdout) };
  } catch (e) {
    return { code: 502, error: `could not parse fetch_arxiv output: ${e.message}` };
  }
}

// ---------- router ----------

const PUBLIC_API_PATHS = new Set(['/api/auth/login']);

async function handle(req, res) {
  const url = new URL(req.url, `http://${HOST}:${PORT}`);
  const { pathname } = url;

  // Static
  if (req.method === 'GET' && (pathname === '/' || pathname === '/index.html')) {
    return serveStatic(req, res, 'index.html');
  }
  if (req.method === 'GET' && pathname.startsWith('/static/katex/')) {
    return serveKatex(req, res, pathname.slice('/static/katex/'.length));
  }
  if (req.method === 'GET' && pathname.startsWith('/static/')) {
    return serveStatic(req, res, pathname.slice('/static/'.length));
  }

  // Auth gate for /api/*. /api/auth/login is exempt (you can't log in
  // without being able to call login). whoami and logout require a session
  // — for whoami this is how the client distinguishes "logged in" from "not".
  if (pathname.startsWith('/api/') && !PUBLIC_API_PATHS.has(pathname)) {
    if (!isAuthed(req)) return send(res, 401, { error: 'auth required' });
  }

  // API
  try {
    // Auth
    if (req.method === 'POST' && pathname === '/api/auth/login') {
      return handleLogin(req, res);
    }
    if (req.method === 'POST' && pathname === '/api/auth/logout') {
      return handleLogout(req, res);
    }
    if (req.method === 'GET' && pathname === '/api/auth/whoami') {
      return send(res, 200, { authed: true });
    }

    // Data
    if (req.method === 'GET' && pathname === '/api/reviews') {
      return send(res, 200, await listReviews());
    }
    const reviewMatch = pathname.match(/^\/api\/review\/([A-Za-z0-9._%/\-]+)$/);
    if (req.method === 'GET' && reviewMatch) {
      try { return send(res, 200, await readReview(decodeURIComponent(reviewMatch[1]))); }
      catch { return send(res, 404, { error: 'review not found' }); }
    }
    if (req.method === 'POST' && pathname === '/api/reviews') {
      if (!originOk(req)) return send(res, 403, { error: 'bad origin' });
      const body = await readBody(req);
      const r = await saveReview(body);
      if (r.error) return send(res, r.code, { error: r.error });
      return send(res, r.code, r.body);
    }
    if (req.method === 'GET' && pathname === '/api/arxiv') {
      const id = url.searchParams.get('id');
      const r = await fetchArxiv(id);
      if (r.error) return send(res, r.code, { error: r.error });
      return send(res, r.code, r.body);
    }
  } catch (e) {
    console.error('[studio] handler error:', e);
    return send(res, 500, { error: e.message });
  }

  send(res, 404, { error: 'not found' });
}

// ---------- auth handlers ----------

async function handleLogin(req, res) {
  if (!originOk(req)) return send(res, 403, { error: 'bad origin' });

  const addr = clientAddr(req);
  const lockedUntil = loginLocked(addr);
  if (lockedUntil) {
    const retryAfter = Math.max(1, Math.ceil((lockedUntil - Date.now()) / 1000));
    return send(res, 429, { error: 'too many attempts, try later' }, {
      'retry-after': String(retryAfter),
    });
  }

  let body;
  try { body = JSON.parse(await readBody(req, 4_096)); }
  catch { return send(res, 400, { error: 'invalid JSON' }); }

  const submitted = typeof body?.token === 'string' ? body.token.trim() : '';
  if (!submitted) {
    recordLoginFailure(addr);
    return send(res, 401, { error: 'token required' });
  }

  if (!tokensEqual(Buffer.from(submitted, 'utf-8'), STUDIO_TOKEN_BUF)) {
    recordLoginFailure(addr);
    return send(res, 401, { error: 'invalid token' });
  }

  clearLoginFailures(addr);
  const sid = newSession();
  const maxAge = Math.floor(SESSION_TTL_MS / 1000);
  return send(res, 200, { ok: true }, {
    'set-cookie': `${SESSION_COOKIE}=${sid}; Path=/; Max-Age=${maxAge}; HttpOnly; SameSite=Strict`,
  });
}

function handleLogout(req, res) {
  const sid = parseCookies(req)[SESSION_COOKIE];
  if (sid) sessions.delete(sid);
  return send(res, 200, { ok: true }, {
    'set-cookie': `${SESSION_COOKIE}=; Path=/; Max-Age=0; HttpOnly; SameSite=Strict`,
  });
}

const server = createServer((req, res) => { handle(req, res).catch((e) => {
  console.error('[studio] unhandled:', e);
  send(res, 500, { error: 'internal error' });
}); });

server.listen(PORT, HOST, () => {
  console.log(`[studio] http://${HOST}:${PORT} ready`);
  console.log(`[studio] repo root: ${REPO_ROOT}`);
  printTokenBanner();
});

function printTokenBanner() {
  const line = '═'.repeat(58);
  const source = STUDIO_TOKEN_FROM_ENV ? '(from STUDIO_TOKEN env)' : '(this session only)';
  console.log('');
  console.log(line);
  console.log('  Studio login token ' + source);
  console.log('');
  console.log('      ' + STUDIO_TOKEN);
  console.log('');
  console.log('  Paste into the browser login screen.');
  if (!STUDIO_TOKEN_FROM_ENV) {
    console.log('  A fresh token is issued on each restart.');
    console.log('  Set STUDIO_TOKEN in env to pin it.');
  }
  console.log(line);
  console.log('');
}
