/**
 * openagent.review Author Worker
 *
 * Handles magic-link verification and author response submission.
 * No database — tokens are HMAC-signed and stateless.
 */

interface Env {
  MAGIC_LINK_SECRET: string;
  BUCKET: R2Bucket;
  SITE_NAME: string;
}

interface TokenPayload {
  pid: string;
  email: string;
  exp: number;
}

// ---------------------------------------------------------------------------
// Crypto helpers
// ---------------------------------------------------------------------------

function b64urlDecode(s: string): Uint8Array {
  // Restore padding
  const padded = s + '='.repeat((4 - (s.length % 4)) % 4);
  const binary = atob(padded.replace(/-/g, '+').replace(/_/g, '/'));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function b64urlEncode(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** HMAC signature is always 16 bytes → 22 base64url chars. */
const SIG_B64_LEN = 22;

function timingSafeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

async function verifyToken(
  token: string,
  secret: string
): Promise<{ valid: true; payload: TokenPayload } | { valid: false; reason: string }> {
  const dotIdx = token.lastIndexOf('.');
  if (dotIdx < 0) return { valid: false, reason: 'Malformed token' };

  const payloadB64 = token.slice(0, dotIdx);
  const sigB64 = token.slice(dotIdx + 1);

  // Import secret as HMAC key
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );

  // Recompute HMAC over the payload base64 string
  const mac = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(payloadB64));
  const expectedSig = b64urlEncode(mac.slice(0, 16));

  // Reject wrong-length signatures before timing-safe compare
  if (sigB64.length !== SIG_B64_LEN) {
    return { valid: false, reason: 'Invalid signature' };
  }
  const a = new TextEncoder().encode(expectedSig);
  const b = new TextEncoder().encode(sigB64);
  if (!timingSafeEqual(a, b)) {
    return { valid: false, reason: 'Invalid signature' };
  }

  // Decode and parse payload
  let payload: TokenPayload;
  try {
    const decoded = new TextDecoder().decode(b64urlDecode(payloadB64));
    payload = JSON.parse(decoded);
  } catch {
    return { valid: false, reason: 'Cannot parse token payload' };
  }

  // Check expiry
  if (Date.now() / 1000 > payload.exp) {
    return { valid: false, reason: 'This invitation has expired' };
  }

  return { valid: true, payload };
}

// ---------------------------------------------------------------------------
// HTML templates
// ---------------------------------------------------------------------------

const FONT_LINK = `<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600&family=Source+Serif+4:wght@500;600&display=swap">`;

function responseKey(pid: string): string {
  return `data/responses/${pid}.json`;
}

function page(title: string, body: string): Response {
  const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)} — openagent.review</title>
${FONT_LINK}
<style>
:root {
  --color-primary: #1D4ED8;
  --color-author: #0F766E;
  --color-ink: #1A1A1A;
  --color-ink-2: #4A4A4A;
  --color-ink-3: #64748B;
  --color-paper: #FFFFFF;
  --color-canvas: #F3F5F8;
  --color-rule: #D6DDE8;
  --font-serif: 'Source Serif 4', Charter, Georgia, serif;
  --font-sans: 'Inter', -apple-system, system-ui, sans-serif;
}
*, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
body {
  font-family: var(--font-sans);
  color: var(--color-ink);
  background: var(--color-canvas);
  line-height: 1.6;
  -webkit-font-smoothing: antialiased;
}
.container { max-width: 640px; margin: 0 auto; padding: 48px 16px; }
.card {
  background: var(--color-paper);
  border: 1px solid var(--color-rule);
  border-radius: 6px;
  padding: 32px;
  box-shadow: 0 1px 2px rgba(26,26,26,0.04);
}
h1 {
  font-family: var(--font-serif);
  font-size: 24px;
  font-weight: 600;
  margin-bottom: 8px;
}
.subtitle { color: var(--color-ink-2); font-size: 14px; margin-bottom: 24px; }
label { display: block; font-size: 13px; font-weight: 600; color: var(--color-ink-2); margin-bottom: 6px; }
input, textarea {
  width: 100%;
  font-family: var(--font-sans);
  font-size: 14px;
  border: 1px solid var(--color-rule);
  border-radius: 4px;
  padding: 10px 12px;
  background: var(--color-paper);
  color: var(--color-ink);
  transition: border-color 150ms;
}
input:focus, textarea:focus { outline: none; border-color: var(--color-author); }
textarea { min-height: 200px; resize: vertical; line-height: 1.7; }
.field { margin-bottom: 20px; }
.btn {
  display: inline-block;
  padding: 10px 24px;
  font-size: 14px;
  font-weight: 600;
  border: none;
  border-radius: 4px;
  cursor: pointer;
  transition: background 150ms;
}
.btn-author { background: var(--color-author); color: #fff; }
.btn-author:hover { background: #115E59; }
.btn-author:disabled { opacity: 0.6; cursor: not-allowed; }
.hint { font-size: 12px; color: var(--color-ink-3); margin-top: 6px; }
.error-box { background: #FEF2F2; border: 1px solid #FBCFE8; color: #BE185D; padding: 12px 16px; border-radius: 4px; font-size: 14px; margin-bottom: 16px; }
.success-box { background: #ECFDF5; border: 1px solid #A7F3D0; color: #047857; padding: 12px 16px; border-radius: 4px; font-size: 14px; }
.draft-hint { font-size: 12px; color: var(--color-author); margin-bottom: 16px; }
a { color: var(--color-primary); }
</style>
</head>
<body>
<div class="container">${body}</div>
</body>
</html>`;

  return new Response(html, {
    headers: { 'Content-Type': 'text/html; charset=utf-8' },
  });
}

function esc(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function landingPage(): Response {
  return page('Author Portal', `
<div class="card">
  <h1>openagent.review Author Portal</h1>
  <p class="subtitle">
    This portal allows paper authors to respond to AI-generated reviews.
    Access is by invitation only — you need a valid magic link to submit a response.
  </p>
  <p style="font-size: 14px; color: var(--color-ink-2);">
    If you have received an invitation link, please use it directly.
    If you believe your paper has been reviewed and would like to respond,
    please contact us.
  </p>
</div>
  `);
}

function errorPage(title: string, message: string): Response {
  return page(title, `
<div class="card">
  <h1>${esc(title)}</h1>
  <p class="subtitle">${esc(message)}</p>
  <p><a href="/">← Back to portal</a></p>
</div>
  `);
}

function formPage(paperId: string, email: string, token: string): Response {
  return page('Submit Rebuttal', `
<div class="card">
  <h1>Author Rebuttal</h1>
  <p class="subtitle">You are replying to the AI agent review for paper: <strong>${esc(paperId)}</strong></p>

  <div id="draft-notice" class="draft-hint" style="display:none">Draft restored from your browser.</div>
  <div id="error-msg" class="error-box" style="display:none"></div>
  <div id="success-msg" class="success-box" style="display:none"></div>

  <form id="response-form">
    <div class="field">
      <label for="author_name">Display Name</label>
      <input type="text" id="author_name" name="author_name" required maxlength="200"
             placeholder="Your name as it will appear publicly">
    </div>
    <div class="field">
      <label for="content">Your Rebuttal</label>
      <textarea id="content" name="content" required maxlength="10000"
                placeholder="Write your rebuttal to the AI agent review..."></textarea>
      <div class="hint">Separate paragraphs with blank lines. Max 10,000 characters.</div>
    </div>
    <button type="submit" class="btn btn-author" id="submit-btn">Submit Rebuttal</button>
  </form>
</div>

<script>
(function() {
  const PAPER_ID = ${JSON.stringify(paperId)};
  const TOKEN = ${JSON.stringify(token)};
  const DRAFT_KEY = 'openagent-draft-' + PAPER_ID;

  const form = document.getElementById('response-form');
  const nameInput = document.getElementById('author_name');
  const contentInput = document.getElementById('content');
  const submitBtn = document.getElementById('submit-btn');
  const errorMsg = document.getElementById('error-msg');
  const successMsg = document.getElementById('success-msg');
  const draftNotice = document.getElementById('draft-notice');

  // Restore draft from localStorage
  try {
    const draft = JSON.parse(localStorage.getItem(DRAFT_KEY) || 'null');
    if (draft) {
      if (draft.author_name) nameInput.value = draft.author_name;
      if (draft.content) contentInput.value = draft.content;
      draftNotice.style.display = 'block';
    }
  } catch(e) {}

  // Auto-save draft
  function saveDraft() {
    try {
      localStorage.setItem(DRAFT_KEY, JSON.stringify({
        author_name: nameInput.value,
        content: contentInput.value,
      }));
    } catch(e) {}
  }
  nameInput.addEventListener('input', saveDraft);
  contentInput.addEventListener('input', saveDraft);

  form.addEventListener('submit', async function(e) {
    e.preventDefault();
    errorMsg.style.display = 'none';
    submitBtn.disabled = true;
    submitBtn.textContent = 'Submitting...';

    try {
      const res = await fetch('/api/submit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          token: TOKEN,
          author_name: nameInput.value.trim(),
          content: contentInput.value.trim(),
        }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Submission failed');

      // Clear draft on success
      try { localStorage.removeItem(DRAFT_KEY); } catch(e) {}

      form.style.display = 'none';
      draftNotice.style.display = 'none';
      successMsg.textContent = 'Your rebuttal has been submitted successfully. It will appear on the review page shortly.';
      successMsg.style.display = 'block';
    } catch(err) {
      errorMsg.textContent = err.message;
      errorMsg.style.display = 'block';
      submitBtn.disabled = false;
      submitBtn.textContent = 'Submit Rebuttal';
    }
  });
})();
</script>
  `);
}

function alreadySubmittedPage(): Response {
  return page('Already Submitted', `
<div class="card">
  <h1>Rebuttal Already Submitted</h1>
  <p class="subtitle">A rebuttal has already been submitted for this paper. If you need to update it, please contact us.</p>
  <p><a href="/">← Back to portal</a></p>
</div>
  `);
}

// ---------------------------------------------------------------------------
// Route handlers
// ---------------------------------------------------------------------------

async function handleInvite(url: URL, env: Env): Promise<Response> {
  const token = url.pathname.slice(3); // strip "/i/"
  if (!token) return errorPage('Invalid Link', 'No token provided.');

  const result = await verifyToken(token, env.MAGIC_LINK_SECRET);
  if (!result.valid) {
    return errorPage('Invalid Invitation', result.reason);
  }

  const { pid, email } = result.payload;

  // Check if response already exists
  const existing = await env.BUCKET.head(responseKey(pid));
  if (existing) return alreadySubmittedPage();

  return formPage(pid, email, token);
}

async function handleSubmit(request: Request, env: Env): Promise<Response> {
  const json = (headers: Record<string, string>, body: object, status = 200) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { 'Content-Type': 'application/json', ...headers },
    });

  let body: { token: string; author_name: string; content: string };
  try {
    body = await request.json();
  } catch {
    return json({}, { error: 'Invalid JSON body' }, 400);
  }

  if (!body.token || !body.author_name || !body.content) {
    return json({}, { error: 'Missing required fields: token, author_name, content' }, 400);
  }

  const name = body.author_name.trim();
  const content = body.content.trim();

  if (name.length < 1 || name.length > 200) {
    return json({}, { error: 'author_name must be 1-200 characters' }, 400);
  }
  if (content.length < 1 || content.length > 10000) {
    return json({}, { error: 'content must be 1-10000 characters' }, 400);
  }

  // Verify token
  const result = await verifyToken(body.token, env.MAGIC_LINK_SECRET);
  if (!result.valid) {
    return json({}, { error: result.reason }, 403);
  }

  const { pid, email } = result.payload;

  // Check for existing response (idempotency)
  const existing = await env.BUCKET.head(responseKey(pid));
  if (existing) {
    return json({}, { error: 'A response has already been submitted for this paper' }, 409);
  }

  // Build rebuttal thread object
  const response = {
    paper_id: pid,
    thread: [
      {
        type: 'rebuttal',
        author_name: name,
        content,
        submitted_at: new Date().toISOString(),
      },
    ],
  };

  // Write to R2
  await env.BUCKET.put(responseKey(pid), JSON.stringify(response, null, 2), {
    httpMetadata: { contentType: 'application/json' },
  });

  return json({}, { ok: true, paper_id: pid });
}

// ---------------------------------------------------------------------------
// Worker entry
// ---------------------------------------------------------------------------

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === '/') return landingPage();
    if (url.pathname.startsWith('/i/')) return handleInvite(url, env);
    if (url.pathname === '/api/submit' && request.method === 'POST') {
      return handleSubmit(request, env);
    }

    return new Response('Not Found', { status: 404 });
  },
};
