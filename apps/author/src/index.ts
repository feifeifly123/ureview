/**
 * openagent.review Author Worker
 *
 * Handles magic-link verification and author response submission.
 * No database — tokens are HMAC-signed and stateless.
 */

interface R2Bucket {
  head(key: string): Promise<unknown>;
  put(
    key: string,
    value: string,
    options?: { httpMetadata?: { contentType?: string } }
  ): Promise<void>;
}

interface Env {
  MAGIC_LINK_SECRET: string;
  BUCKET: R2Bucket;
  SITE_NAME: string;
}

interface TokenPayload {
  pid: string;
  exp: number;
}

function b64urlDecode(s: string): Uint8Array {
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

  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );

  const mac = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(payloadB64));
  const expectedSig = b64urlEncode(mac.slice(0, 16));

  if (sigB64.length !== SIG_B64_LEN) return { valid: false, reason: 'Invalid signature' };
  if (!timingSafeEqual(new TextEncoder().encode(expectedSig), new TextEncoder().encode(sigB64))) {
    return { valid: false, reason: 'Invalid signature' };
  }

  let payload: TokenPayload;
  try {
    payload = JSON.parse(new TextDecoder().decode(b64urlDecode(payloadB64)));
  } catch {
    return { valid: false, reason: 'Cannot parse token payload' };
  }

  if (Date.now() / 1000 > payload.exp) {
    return { valid: false, reason: 'This invitation has expired' };
  }

  return { valid: true, payload };
}

const FONT_LINK = `<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=Source+Serif+4:wght@500;600&display=swap">`;

function responseKey(pid: string): string {
  return `data/responses/${pid}.json`;
}

function esc(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
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
  --bg: #fafaf8;
  --surface: #ffffff;
  --surface-soft: #f4f5f7;
  --border: #e3e6ea;
  --text: #141821;
  --text-muted: #5f6775;
  --blue: #3158d3;
  --blue-soft: #eaf1ff;
  --green: #2f8f5b;
  --green-soft: #eaf7ee;
  --amber: #a15c00;
  --amber-soft: #fff1d6;
  --danger: #b42318;
  --danger-soft: #fee4e2;
  --font-serif: 'Source Serif 4', Charter, Georgia, serif;
  --font-sans: 'Inter', -apple-system, system-ui, sans-serif;
}
* { box-sizing: border-box; }
body {
  margin: 0;
  font-family: var(--font-sans);
  color: var(--text);
  background: var(--bg);
  line-height: 1.6;
  -webkit-font-smoothing: antialiased;
}
a { color: var(--blue); text-decoration: none; }
a:hover { text-decoration: underline; }
.shell {
  max-width: 1120px;
  margin: 0 auto;
  padding: 48px 20px 64px;
}
.topbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 28px;
  gap: 16px;
}
.brand {
  display: inline-flex;
  align-items: center;
  gap: 10px;
  color: var(--text);
  font-weight: 700;
}
.brand-mark {
  width: 26px;
  height: 26px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border-radius: 8px;
  background: var(--text);
  color: white;
  font-family: var(--font-serif);
}
.hero-kicker,
.section-kicker {
  display: inline-flex;
  align-items: center;
  min-height: 28px;
  padding: 0 12px;
  border-radius: 999px;
  background: var(--blue-soft);
  color: var(--blue);
  font-size: 12px;
  font-weight: 700;
  letter-spacing: 0.02em;
}
.page-grid {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 320px;
  gap: 24px;
  align-items: start;
}
.card {
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 18px;
  padding: 28px;
  box-shadow: 0 8px 30px rgba(20, 24, 33, 0.04);
}
.card + .card { margin-top: 18px; }
h1, h2, h3 {
  font-family: var(--font-serif);
  margin: 0 0 8px;
  line-height: 1.15;
}
h1 { font-size: 34px; }
h2 { font-size: 26px; }
h3 { font-size: 18px; }
p { margin: 0 0 14px; color: var(--text-muted); }
label {
  display: block;
  font-size: 13px;
  font-weight: 700;
  color: var(--text);
  margin-bottom: 8px;
}
input, textarea {
  width: 100%;
  border: 1px solid var(--border);
  border-radius: 12px;
  padding: 12px 14px;
  font: inherit;
  color: var(--text);
  background: white;
}
input:focus, textarea:focus {
  outline: 2px solid rgba(49, 88, 211, 0.18);
  border-color: var(--blue);
}
textarea {
  min-height: 140px;
  resize: vertical;
}
.small-text { font-size: 13px; color: var(--text-muted); }
.form-grid {
  display: grid;
  gap: 18px;
}
.two-col {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
  gap: 18px;
}
.action-row {
  display: flex;
  align-items: center;
  gap: 12px;
  flex-wrap: wrap;
}
.btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-height: 44px;
  padding: 0 18px;
  border-radius: 12px;
  border: 1px solid transparent;
  font: inherit;
  font-weight: 700;
  cursor: pointer;
}
.btn-primary {
  background: var(--text);
  color: white;
}
.btn-primary:hover { opacity: 0.92; }
.btn-secondary {
  background: white;
  border-color: var(--border);
  color: var(--text);
}
.notice {
  border-radius: 12px;
  padding: 12px 14px;
  font-size: 14px;
  margin-bottom: 16px;
}
.notice-error { background: var(--danger-soft); color: var(--danger); }
.notice-success { background: var(--green-soft); color: var(--green); }
.notice-draft { background: var(--blue-soft); color: var(--blue); }
.meta-list,
.policy-list,
.flow-list {
  padding-left: 18px;
  margin: 0;
  color: var(--text-muted);
}
.meta-list li,
.policy-list li,
.flow-list li { margin-bottom: 10px; }
.flow-strip {
  display: flex;
  gap: 10px;
  flex-wrap: wrap;
  margin: 18px 0 22px;
}
.flow-pill {
  display: inline-flex;
  align-items: center;
  min-height: 34px;
  padding: 0 12px;
  border-radius: 999px;
  background: var(--surface-soft);
  color: var(--text-muted);
  font-size: 13px;
  font-weight: 700;
}
.preview {
  border: 1px solid var(--border);
  background: var(--surface-soft);
  border-radius: 14px;
  padding: 16px;
}
.preview h3 { margin-bottom: 10px; }
.preview-body h4 {
  font-size: 14px;
  margin: 14px 0 4px;
  color: var(--text);
}
.preview-body p {
  font-size: 14px;
  color: var(--text);
  white-space: pre-wrap;
  margin-bottom: 10px;
}
.footer-note {
  margin-top: 16px;
  font-size: 13px;
  color: var(--text-muted);
}
.token-box {
  display: grid;
  gap: 12px;
}
.error-link {
  display: inline-flex;
  margin-top: 12px;
  font-weight: 700;
}
@media (max-width: 920px) {
  .page-grid { grid-template-columns: 1fr; }
  .two-col { grid-template-columns: 1fr; }
}
@media (max-width: 640px) {
  .shell { padding: 28px 14px 40px; }
  .card { padding: 20px; border-radius: 16px; }
  h1 { font-size: 28px; }
}
</style>
</head>
<body>
<div class="shell">
  <div class="topbar">
    <a class="brand" href="/"><span class="brand-mark">O</span>openagent.review</a>
    <a href="/">Back to site</a>
  </div>
  ${body}
</div>
</body>
</html>`;

  return new Response(html, {
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-store',
      'Referrer-Policy': 'no-referrer',
      'X-Content-Type-Options': 'nosniff',
      'X-Frame-Options': 'DENY',
      'Content-Security-Policy':
        "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline' https://fonts.googleapis.com https://fonts.gstatic.com; font-src https://fonts.gstatic.com; connect-src 'self'; frame-ancestors 'none'",
    },
  });
}

function landingPage(): Response {
  return page(
    'For authors',
    `
<div class="page-grid">
  <main>
    <section class="card">
      <span class="hero-kicker">Private author flow</span>
      <h1>Respond to a machine review through a secure invite link.</h1>
      <p>
        Paste the token or the full invite URL from your email. This opens the private author portal,
        where you can review the critique, draft a structured response, preview it, and publish it.
      </p>
      <form id="token-form" class="token-box">
        <label for="token-input">Invite token or invite URL</label>
        <textarea id="token-input" placeholder="https://author.example.com/i/your-token-here"></textarea>
        <div class="action-row">
          <button type="submit" class="btn btn-primary">Open author portal</button>
          <span class="small-text">You can paste the raw token or the full magic link.</span>
        </div>
        <div id="token-error" class="notice notice-error" style="display:none"></div>
      </form>
    </section>

    <section class="card">
      <span class="section-kicker">What the author flow includes</span>
      <div class="flow-strip">
        <span class="flow-pill">1. Review AI critique</span>
        <span class="flow-pill">2. Draft rebuttal</span>
        <span class="flow-pill">3. Preview</span>
        <span class="flow-pill">4. Publish</span>
      </div>
      <ul class="flow-list">
        <li>The machine review stays visible. Your response is added as a new note in the thread.</li>
        <li>Your display name and reply become public when you publish.</li>
        <li>If a link is expired or malformed, the portal will explain why.</li>
      </ul>
    </section>
  </main>

  <aside>
    <section class="card">
      <span class="section-kicker">Publication policy</span>
      <h3>What becomes public</h3>
      <ul class="policy-list">
        <li>Your display name and response text.</li>
        <li>The timestamp showing when the response was published.</li>
        <li>The resulting public thread that readers can browse alongside the AI review.</li>
      </ul>
    </section>

    <section class="card">
      <span class="section-kicker">Need help?</span>
      <h3>Common cases</h3>
      <ul class="policy-list">
        <li>Paste the full URL if you are not sure where the token begins.</li>
        <li>If your invitation expired, you will need a new invite from the sender.</li>
        <li>If you already submitted once, the portal will stop duplicate publication.</li>
      </ul>
    </section>
  </aside>
</div>
<script>
(function() {
  const form = document.getElementById('token-form');
  const input = document.getElementById('token-input');
  const error = document.getElementById('token-error');

  function normalizeToken(value) {
    const raw = value.trim();
    if (!raw) return '';
    try {
      const url = new URL(raw);
      const match = url.pathname.match(/\/i\/([^/?#]+)/);
      if (match && match[1]) return match[1];
      const qp = url.searchParams.get('token');
      if (qp) return qp;
    } catch (_) {}
    const pathMatch = raw.match(/\/i\/([^/?#]+)/);
    if (pathMatch && pathMatch[1]) return pathMatch[1];
    return raw.replace(/^\/+|\/+$/g, '');
  }

  form.addEventListener('submit', function(event) {
    event.preventDefault();
    const token = normalizeToken(input.value);
    if (!token) {
      error.style.display = 'block';
      error.textContent = 'Paste the invite token or the full invite URL.';
      return;
    }
    window.location.href = '/i/' + encodeURIComponent(token);
  });
})();
</script>`
  );
}

function errorPage(title: string, message: string): Response {
  return page(
    title,
    `
<section class="card">
  <span class="section-kicker">Invite error</span>
  <h1>${esc(title)}</h1>
  <p>${esc(message)}</p>
  <a class="error-link" href="/">← Back to author portal</a>
</section>`
  );
}

function formPage(paperId: string, token: string): Response {
  return page(
    'Draft author response',
    `
<div class="page-grid">
  <main>
    <section class="card">
      <span class="hero-kicker">Private response draft</span>
      <h1>Draft your response for ${esc(paperId)}</h1>
      <p>
        This response will appear in the public thread next to the machine review.
        Use the structure below to clarify what the review got right, what needs correction, and what readers should know.
      </p>
      <div class="flow-strip">
        <span class="flow-pill">Review critique</span>
        <span class="flow-pill">Draft response</span>
        <span class="flow-pill">Preview</span>
        <span class="flow-pill">Publish</span>
      </div>

      <div id="draft-notice" class="notice notice-draft" style="display:none">Draft restored from this browser.</div>
      <div id="error-msg" class="notice notice-error" style="display:none"></div>
      <div id="success-msg" class="notice notice-success" style="display:none"></div>

      <form id="response-form" class="form-grid">
        <div>
          <label for="author_name">Display name</label>
          <input type="text" id="author_name" maxlength="200" required placeholder="Your name as it will appear publicly">
        </div>

        <div class="two-col">
          <div>
            <label for="what_right">What the review got right</label>
            <textarea id="what_right" maxlength="4000" placeholder="Points where the machine review was directionally accurate."></textarea>
          </div>
          <div>
            <label for="needs_correction">What needs correction</label>
            <textarea id="needs_correction" maxlength="4000" placeholder="Clarify mistakes, missing scope, or unsupported claims."></textarea>
          </div>
        </div>

        <div>
          <label for="additional_evidence">Additional evidence or appendix pointers</label>
          <textarea id="additional_evidence" maxlength="4000" placeholder="Point to experiments, ablations, appendices, code, or relevant discussion."></textarea>
        </div>

        <div>
          <label for="final_response">Final response</label>
          <textarea id="final_response" maxlength="4000" required placeholder="A concise final reply that readers should take away from the thread."></textarea>
        </div>

        <div class="action-row">
          <button type="submit" class="btn btn-primary" id="submit-btn">Publish response</button>
          <span class="small-text">One-time publication for this paper.</span>
        </div>
      </form>
    </section>
  </main>

  <aside>
    <section class="card preview">
      <span class="section-kicker">Live preview</span>
      <h3>How your response will look</h3>
      <div id="preview-body" class="preview-body">
        <p>Start typing to preview your public response.</p>
      </div>
    </section>

    <section class="card">
      <span class="section-kicker">Before you publish</span>
      <ul class="policy-list">
        <li>Your display name and response text will be public.</li>
        <li>The machine review remains visible alongside your response.</li>
        <li>Publishing through this link is a one-time action for this paper.</li>
      </ul>
      <div class="footer-note">Paper ID: <strong>${esc(paperId)}</strong></div>
    </section>
  </aside>
</div>

<script>
(function() {
  const PAPER_ID = ${JSON.stringify(paperId)};
  const TOKEN = ${JSON.stringify(token)};
  const DRAFT_KEY = 'openagent-draft-' + PAPER_ID;

  const form = document.getElementById('response-form');
  const nameInput = document.getElementById('author_name');
  const whatRight = document.getElementById('what_right');
  const needsCorrection = document.getElementById('needs_correction');
  const evidence = document.getElementById('additional_evidence');
  const finalResponse = document.getElementById('final_response');
  const submitBtn = document.getElementById('submit-btn');
  const errorMsg = document.getElementById('error-msg');
  const successMsg = document.getElementById('success-msg');
  const draftNotice = document.getElementById('draft-notice');
  const previewBody = document.getElementById('preview-body');

  function getSections() {
    return [
      ['What the review got right', whatRight.value.trim()],
      ['What needs correction', needsCorrection.value.trim()],
      ['Additional evidence or appendix pointers', evidence.value.trim()],
      ['Final response', finalResponse.value.trim()],
    ].filter(([, value]) => value.length > 0);
  }

  function composeSections() {
    return getSections().map(([title, value]) => title + '\n' + value).join('\n\n');
  }

  function esc(s) {
    return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }

  function renderPreview() {
    const sections = getSections();

    if (!sections.length) {
      previewBody.innerHTML = '<p>Start typing to preview your public response.</p>';
      return;
    }

    previewBody.innerHTML = sections
      .map(([title, value]) => '<h4>' + esc(title) + '</h4><p>' + esc(value).replace(/\n/g, '<br>') + '</p>')
      .join('');
  }

  function saveDraft() {
    try {
      localStorage.setItem(DRAFT_KEY, JSON.stringify({
        author_name: nameInput.value,
        what_right: whatRight.value,
        needs_correction: needsCorrection.value,
        additional_evidence: evidence.value,
        final_response: finalResponse.value,
      }));
    } catch (_) {}
  }

  function restoreDraft() {
    try {
      const draft = JSON.parse(localStorage.getItem(DRAFT_KEY) || 'null');
      if (!draft) return;
      if (draft.author_name) nameInput.value = draft.author_name;
      if (draft.what_right) whatRight.value = draft.what_right;
      if (draft.needs_correction) needsCorrection.value = draft.needs_correction;
      if (draft.additional_evidence) evidence.value = draft.additional_evidence;
      if (draft.final_response) finalResponse.value = draft.final_response;
      draftNotice.style.display = 'block';
    } catch (_) {}
  }

  [nameInput, whatRight, needsCorrection, evidence, finalResponse].forEach((node) => {
    node.addEventListener('input', function() {
      saveDraft();
      renderPreview();
    });
  });

  restoreDraft();
  renderPreview();

  form.addEventListener('submit', async function(event) {
    event.preventDefault();
    errorMsg.style.display = 'none';
    successMsg.style.display = 'none';

    const content = composeSections();
    if (!content.trim()) {
      errorMsg.textContent = 'Please add at least one response section before publishing.';
      errorMsg.style.display = 'block';
      return;
    }

    submitBtn.disabled = true;
    submitBtn.textContent = 'Publishing...';

    try {
      const res = await fetch('/api/submit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          token: TOKEN,
          author_name: nameInput.value.trim(),
          content,
        }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Submission failed');

      try { localStorage.removeItem(DRAFT_KEY); } catch (_) {}
      form.style.display = 'none';
      draftNotice.style.display = 'none';
      successMsg.textContent = 'Your response has been published. It will appear in the public thread shortly.';
      successMsg.style.display = 'block';
    } catch (err) {
      errorMsg.textContent = err && err.message ? err.message : 'Submission failed';
      errorMsg.style.display = 'block';
      submitBtn.disabled = false;
      submitBtn.textContent = 'Publish response';
    }
  });
})();
</script>`
  );
}

function alreadySubmittedPage(): Response {
  return page(
    'Already submitted',
    `
<section class="card">
  <span class="section-kicker">Duplicate submission blocked</span>
  <h1>Response already published</h1>
  <p>This invite has already been used to publish a response for this paper.</p>
  <a class="error-link" href="/">← Back to author portal</a>
</section>`
  );
}

async function handleInvite(url: URL, env: Env): Promise<Response> {
  const token = url.pathname.slice(3);
  if (!token) return errorPage('Invalid link', 'No token was provided.');

  const result = await verifyToken(token, env.MAGIC_LINK_SECRET);
  if (result.valid === false) return errorPage('Invalid invitation', result.reason);

  const { pid } = result.payload;
  const existing = await env.BUCKET.head(responseKey(pid));
  if (existing) return alreadySubmittedPage();
  return formPage(pid, token);
}

async function handleSubmit(request: Request, env: Env): Promise<Response> {
  const origin = request.headers.get('Origin');
  if (origin
    && !origin.endsWith('.openagent.review')
    && origin !== 'https://openagent.review'
    && !/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)) {
    return new Response(JSON.stringify({ error: 'Cross-origin request rejected' }), {
      status: 403,
      headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' },
    });
  }

  const json = (body: object, status = 200) =>
    new Response(JSON.stringify(body), {
      status,
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff',
      },
    });

  let body: { token: string; author_name: string; content: string };
  try {
    body = await request.json();
  } catch {
    return json({ error: 'Invalid JSON body' }, 400);
  }

  if (!body.token || !body.author_name || !body.content) {
    return json({ error: 'Missing required fields: token, author_name, content' }, 400);
  }

  const authorName = body.author_name.trim();
  const content = body.content.trim();
  if (authorName.length < 1 || authorName.length > 200) {
    return json({ error: 'author_name must be 1-200 characters' }, 400);
  }
  if (content.length < 1 || content.length > 10000) {
    return json({ error: 'content must be 1-10000 characters' }, 400);
  }

  const result = await verifyToken(body.token, env.MAGIC_LINK_SECRET);
  if (result.valid === false) return json({ error: result.reason }, 403);

  const { pid } = result.payload;
  const existing = await env.BUCKET.head(responseKey(pid));
  if (existing) {
    return json({ error: 'A response has already been submitted for this paper' }, 409);
  }

  const response = {
    paper_id: pid,
    thread: [
      {
        type: 'rebuttal',
        author_name: authorName,
        content,
        submitted_at: new Date().toISOString(),
      },
    ],
  };

  await env.BUCKET.put(responseKey(pid), JSON.stringify(response, null, 2), {
    httpMetadata: { contentType: 'application/json' },
  });

  return json({ ok: true, paper_id: pid });
}

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
