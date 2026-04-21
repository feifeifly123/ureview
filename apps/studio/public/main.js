// OpenAgent Studio — vanilla SPA.
//
// Two views share the same root <main id="app">:
//   Dashboard: HF trending, existing reviews, publish panel
//   Editor:    per-paper form with LLM paste + structured fields
//
// Client-side routing via the `view` query param.

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

// ---------- tiny DOM helper ----------

function el(tag, props = {}, children = []) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (v == null || v === false) continue;
    if (k === 'class') node.className = v;
    else if (k === 'style' && typeof v === 'object') Object.assign(node.style, v);
    else if (k.startsWith('on') && typeof v === 'function') node.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === 'html') node.innerHTML = v;
    else node.setAttribute(k, v);
  }
  const kids = Array.isArray(children) ? children : [children];
  for (const kid of kids) {
    if (kid == null || kid === false) continue;
    node.appendChild(typeof kid === 'string' ? document.createTextNode(kid) : kid);
  }
  return node;
}

function mount(root, ...nodes) {
  root.replaceChildren(...nodes);
}

function toast(msg, kind = 'ok', timeout = 3500) {
  const stack = $('#toast-stack');
  const node = el('div', { class: `toast ${kind}` }, msg);
  stack.appendChild(node);
  setTimeout(() => node.remove(), timeout);
}

// ---------- API ----------

async function api(path, opts = {}) {
  const res = await fetch(path, opts);
  const ct = res.headers.get('content-type') ?? '';
  const payload = ct.includes('application/json') ? await res.json() : await res.text();
  if (!res.ok) {
    const msg = typeof payload === 'object' ? payload.error ?? JSON.stringify(payload) : payload;
    throw new Error(`${res.status}: ${msg}`);
  }
  return payload;
}

// ---------- router ----------

function currentView() {
  const params = new URLSearchParams(location.search);
  if (params.get('review')) return { name: 'editor', reviewId: params.get('review') };
  if (params.get('paper')) return { name: 'editor', arxivId: params.get('paper') };
  return { name: 'dashboard' };
}

function navTo(query) {
  const url = new URL(location.href);
  url.search = '';
  for (const [k, v] of Object.entries(query)) {
    if (v != null) url.searchParams.set(k, v);
  }
  history.pushState({}, '', url);
  route();
}

window.addEventListener('popstate', () => route());

// Top nav buttons
document.addEventListener('click', (e) => {
  const btn = e.target.closest('#nav [data-view]');
  if (!btn) return;
  if (btn.dataset.view === 'dashboard') navTo({});
});

// ---------- views ----------

function renderNav(active) {
  $$('#nav button').forEach((b) => {
    const isActive = b.dataset.view === active;
    b.classList.toggle('active', isActive);
    if (b.dataset.view === 'editor') b.disabled = active !== 'editor';
  });
}

async function route() {
  const v = currentView();
  renderNav(v.name);
  if (v.name === 'dashboard') await renderDashboard();
  else if (v.name === 'editor') await renderEditor(v);
}

// ---------- dashboard ----------

let trendingCache = null;

async function renderDashboard() {
  const root = $('#app');
  mount(root,
    buildTrendingPanel(),
    buildReviewsPanel(),
    buildPublishPanel(),
  );
  await Promise.all([loadReviewsList(), trendingCache ? renderTrendingList(trendingCache) : null]);
}

function buildTrendingPanel() {
  return el('section', { class: 'panel', id: 'trending-panel' }, [
    el('div', { class: 'panel-title' }, [
      el('h2', {}, 'HF Trending'),
      el('div', { class: 'flex gap-2 items-center' }, [
        el('input', {
          type: 'text', id: 'arxiv-input', placeholder: 'Add by arXiv ID…',
          style: { width: '200px' },
          onkeydown: (e) => { if (e.key === 'Enter') startEditorByArxiv(); },
        }),
        el('button', { class: 'btn', onclick: startEditorByArxiv }, 'Open →'),
        el('button', { class: 'btn btn-primary', id: 'sync-btn', onclick: syncTrending }, 'Sync trending'),
      ]),
    ]),
    el('div', { id: 'trending-list' }, [
      el('p', { class: 'skel' }, 'Click "Sync trending" to pull the current HF trending list.'),
    ]),
  ]);
}

function buildReviewsPanel() {
  return el('section', { class: 'panel' }, [
    el('div', { class: 'panel-title' }, [
      el('h2', {}, 'Existing reviews'),
      el('span', { class: 'muted', id: 'reviews-count' }, '—'),
    ]),
    el('div', { id: 'reviews-list' }, [el('p', { class: 'skel' }, 'Loading…')]),
  ]);
}

function buildPublishPanel() {
  return el('section', { class: 'panel' }, [
    el('div', { class: 'panel-title' }, [
      el('h2', {}, 'Publish to R2'),
      el('span', { class: 'muted' }, 'Production bucket — requires typed confirmation'),
    ]),
    el('div', { class: 'flex gap-2' }, [
      el('button', { class: 'btn', onclick: openPublishModal }, 'Preview R2 changes'),
    ]),
    el('p', { class: 'muted mt-2' }, [
      'Before publishing make sure ',
      el('span', { class: 'kbd' }, '.env.local'),
      ' is sourced in the terminal that runs this server (it carries the R2 credentials).',
    ]),
  ]);
}

function startEditorByArxiv() {
  const input = $('#arxiv-input');
  const raw = (input?.value || '').trim();
  if (!raw) { toast('Paste an arXiv ID first', 'warn'); return; }
  const cleaned = raw.replace(/.*arxiv\.org\/abs\//i, '').replace(/v\d+$/, '');
  navTo({ paper: cleaned });
}

async function loadReviewsList() {
  const list = $('#reviews-list');
  const count = $('#reviews-count');
  try {
    const reviews = await api('/api/reviews');
    count.textContent = `${reviews.length} review${reviews.length === 1 ? '' : 's'}`;
    if (reviews.length === 0) {
      mount(list, el('p', { class: 'skel' }, 'No reviews yet. Add one from trending or by arXiv ID above.'));
      return;
    }
    const rows = reviews.map((r) => el('div', { class: 'row' }, [
      el('span', { class: 'mono' }, r.arxiv_id || r.id.slice(0, 14)),
      el('a', {
        class: 'title', href: `?review=${encodeURIComponent(r.id)}`,
        onclick: (e) => { e.preventDefault(); navTo({ review: r.id }); },
      }, r.title),
      r.verdict_leaning
        ? el('span', { class: `leaning-pill leaning-pill--${r.verdict_leaning}` }, r.verdict_leaning)
        : el('span', { class: 'muted' }, '—'),
      el('span', {}, [
        el('span', { class: 'muted' }, r.date),
        r.ethics_flag ? el('span', { class: 'status-chip ethics' }, '⚠ ethics') : null,
      ]),
    ]));
    mount(list, ...rows);
  } catch (e) {
    mount(list, el('div', { class: 'error-box' }, `Failed to load reviews: ${e.message}`));
  }
}

async function syncTrending() {
  const btn = $('#sync-btn');
  btn.disabled = true;
  btn.textContent = 'Syncing…';
  try {
    trendingCache = await api('/api/trending');
    renderTrendingList(trendingCache);
    toast(`Fetched ${trendingCache.length} trending papers`);
  } catch (e) {
    mount($('#trending-list'), el('div', { class: 'error-box' }, `HF sync failed:\n${e.message}`));
    toast('HF sync failed — see panel', 'err');
  } finally {
    btn.disabled = false;
    btn.textContent = 'Sync trending';
  }
}

async function renderTrendingList(papers) {
  const list = $('#trending-list');
  if (!list) return;
  let reviewedSet = new Set();
  try {
    const reviews = await api('/api/reviews');
    reviewedSet = new Set(reviews.map((r) => r.arxiv_id).filter(Boolean));
  } catch {}

  if (!papers.length) {
    mount(list, el('p', { class: 'skel' }, 'No papers in the trending feed.'));
    return;
  }

  const rows = papers.slice(0, 30).map((p) => {
    const arxivId = p.arxiv_id || (p.url?.match(/arxiv\.org\/abs\/(.+)/)?.[1] ?? '').replace(/v\d+$/, '');
    const reviewed = reviewedSet.has(arxivId);
    return el('div', { class: 'row' }, [
      el('span', { class: 'mono' }, [
        `#${p.rank}  `,
        el('span', { style: { color: 'var(--ink-2)' } }, arxivId),
      ]),
      el('a', {
        class: 'title', href: `?paper=${encodeURIComponent(arxivId)}`,
        onclick: (e) => { e.preventDefault(); navTo(reviewed ? { review: null } : { paper: arxivId }); },
      }, p.title),
      el('span', { class: 'muted' }, p.upvotes != null ? `↑ ${p.upvotes}` : ''),
      el('span', { class: `status-chip ${reviewed ? 'reviewed' : 'new'}` }, reviewed ? '✓ reviewed' : '○ new'),
    ]);
  });
  mount(list, ...rows);
}

// ---------- publish modal ----------

async function openPublishModal() {
  const backdrop = el('div', { class: 'backdrop', onclick: (e) => { if (e.target === backdrop) backdrop.remove(); } });
  const output = el('pre', { class: 'plan-output' }, 'Running publish_r2.py --dry-run…');
  const confirmInput = el('input', { type: 'text', placeholder: 'Type "publish" to enable' });
  const applyBtn = el('button', { class: 'btn btn-danger', disabled: true, onclick: () => runApply() }, 'Publish now');
  const closeBtn = el('button', { class: 'btn', onclick: () => backdrop.remove() }, 'Close');

  confirmInput.addEventListener('input', () => { applyBtn.disabled = confirmInput.value.trim() !== 'publish'; });

  const modal = el('div', { class: 'modal' }, [
    el('div', { class: 'modal-head' }, [
      el('h3', {}, 'Publish to R2 — production'),
      el('button', { class: 'btn-link', onclick: () => backdrop.remove() }, '✕'),
    ]),
    el('div', { class: 'modal-body' }, [
      el('p', { class: 'muted' }, 'Dry-run plan:'),
      output,
      el('div', { class: 'field mt-2' }, [
        el('label', {}, 'Confirm — type the word "publish"'),
        confirmInput,
      ]),
    ]),
    el('div', { class: 'modal-foot' }, [closeBtn, applyBtn]),
  ]);

  backdrop.appendChild(modal);
  document.body.appendChild(backdrop);

  try {
    const plan = await api('/api/publish/plan', { method: 'POST' });
    output.textContent = plan.stdout || plan.stderr || '(no output)';
    if (plan.exit !== 0) output.textContent += `\n\n[exit ${plan.exit}]\n${plan.stderr || ''}`;
  } catch (e) {
    output.textContent = `plan failed: ${e.message}`;
  }

  async function runApply() {
    applyBtn.disabled = true;
    applyBtn.textContent = 'Publishing…';
    try {
      const r = await api('/api/publish/apply', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ confirm: 'publish' }),
      });
      output.textContent = r.stdout || r.stderr || '(no output)';
      if (r.exit === 0) toast('Published to R2', 'ok'); else toast(`Publish exited ${r.exit}`, 'err');
    } catch (e) {
      output.textContent = `publish failed: ${e.message}`;
      toast('Publish failed', 'err');
    } finally {
      applyBtn.textContent = 'Publish now';
      applyBtn.disabled = false;
    }
  }
}

// ---------- editor ----------

const EMPTY_REVIEW = () => ({
  id: '',
  slug: '',
  date: new Date().toISOString().slice(0, 10),
  title: '',
  paper_url: '',
  hf_rank: undefined,
  arxiv_categories: [],
  abstract: '',
  ai_review: {
    summary: '',
    strengths_weaknesses: '',
    ratings: {
      soundness:    { score: 3, note: '' },
      presentation: { score: 3, note: '' },
      significance: { score: 3, note: '' },
      originality:  { score: 3, note: '' },
    },
    key_questions: [],
    limitations: '',
    overall_recommendation: 4,
    confidence: 3,
    ethics_flag: false,
    ethics_concerns: null,
  },
  review_highlights: {
    why_read: '',
    why_doubt: '',
    verdict_leaning: 'mixed',
  },
  updated_at: new Date().toISOString(),
});

function slugify(s) {
  return (s || '').toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60);
}

async function renderEditor({ reviewId, arxivId }) {
  const root = $('#app');
  mount(root, el('p', { class: 'skel' }, 'Loading editor…'));

  let review = EMPTY_REVIEW();
  let isNew = true;

  if (reviewId) {
    try {
      review = await api(`/api/review/${encodeURIComponent(reviewId)}`);
      isNew = false;
    } catch (e) {
      mount(root, el('div', { class: 'error-box' }, `Failed to load ${reviewId}: ${e.message}`));
      return;
    }
  } else if (arxivId) {
    try {
      const meta = await api(`/api/arxiv?id=${encodeURIComponent(arxivId)}`);
      review.title = meta.title;
      review.abstract = meta.abstract;
      review.paper_url = meta.paper_url;
      review.arxiv_categories = meta.arxiv_categories || [];
      review.slug = slugify(meta.title);
      review.id = `${review.date}-${review.slug}`;
    } catch (e) {
      toast(`arXiv fetch failed: ${e.message}`, 'err', 5000);
    }
  }

  mount(root, buildEditorView(review, isNew));
}

function buildEditorView(review, isNew) {
  const container = el('div', { id: 'editor-root' });

  // Block A: arxiv metadata
  const blockA = el('section', { class: 'panel' }, [
    el('div', { class: 'panel-title' }, [
      el('h2', {}, isNew ? 'New review' : `Review ${review.id}`),
      el('button', { class: 'btn-link', onclick: () => navTo({}) }, '← Back to dashboard'),
    ]),
    el('div', { class: 'form-grid' }, [
      buildField('Title', 'title', review.title),
      buildField('arXiv URL', 'paper_url', review.paper_url),
    ]),
    buildField('Abstract (arXiv)', 'abstract', review.abstract, { textarea: true, tall: true }),
    el('div', { class: 'form-grid' }, [
      buildField('Categories (comma-separated)', 'arxiv_categories', (review.arxiv_categories || []).join(', ')),
      buildField('HF rank', 'hf_rank', review.hf_rank ?? '', { type: 'number' }),
    ]),
  ]);

  // Block B: bulk paste
  const pasteArea = el('textarea', {
    class: 'tall',
    id: 'bulk-json',
    placeholder: '{\n  "ai_review": { ... },\n  "review_highlights": { ... }\n}\n\nAccepts either just { ai_review, review_highlights } or a full review record.',
  });
  const blockB = el('section', { class: 'panel' }, [
    el('div', { class: 'panel-title' }, [
      el('h2', {}, 'Paste LLM output'),
      el('button', { class: 'btn', onclick: () => parseBulk(pasteArea.value, review) }, 'Parse & fill'),
    ]),
    el('p', { class: 'muted' }, 'Paste the JSON the LLM returns; Block C fields will be populated. You can still edit individual fields afterward.'),
    pasteArea,
  ]);

  // Block C: structured fields
  const blockC = buildStructuredFields(review);

  // Footer
  const saveBtn = el('button', { class: 'btn btn-primary', onclick: () => saveEditor(review) }, isNew ? 'Save new review' : 'Save changes');
  const cancelBtn = el('button', { class: 'btn', onclick: () => navTo({}) }, 'Cancel');

  container.appendChild(blockA);
  container.appendChild(blockB);
  container.appendChild(blockC);
  container.appendChild(el('div', { class: 'flex gap-2', style: { justifyContent: 'flex-end' } }, [cancelBtn, saveBtn]));
  return container;
}

function buildField(label, key, value, opts = {}) {
  const id = `f-${key}`;
  const field = el('div', { class: 'field' }, [el('label', { for: id }, label)]);
  const input = opts.textarea
    ? el('textarea', { id, class: opts.tall ? 'tall' : '' }, String(value || ''))
    : el('input', { id, type: opts.type || 'text', value: value ?? '' });
  field.appendChild(input);
  return field;
}

function buildStructuredFields(review) {
  const ai = review.ai_review;
  const rh = review.review_highlights;
  const panel = el('section', { class: 'panel' }, [
    el('div', { class: 'panel-title' }, [el('h2', {}, 'Structured review')]),
    buildField('Summary (paper in 60s, LaTeX OK)', 'summary', ai.summary, { textarea: true }),
    buildField('Strengths & weaknesses (LaTeX OK)', 'strengths_weaknesses', ai.strengths_weaknesses, { textarea: true, tall: true }),

    el('h3', { style: { margin: '18px 0 8px', fontSize: '14px' } }, 'Ratings (1–4)'),
    el('div', {}, ['soundness', 'presentation', 'significance', 'originality'].map((k) => el('div', { class: 'rating-row' }, [
      el('span', {}, k),
      el('select', { id: `rating-${k}-score` }, [1, 2, 3, 4].map((n) => el('option', { value: n, selected: n === ai.ratings[k].score }, String(n)))),
      el('input', { id: `rating-${k}-note`, type: 'text', value: ai.ratings[k].note, placeholder: 'One-line justification' }),
    ]))),

    el('h3', { style: { margin: '18px 0 8px', fontSize: '14px' } }, 'Key questions'),
    el('div', { id: 'kq-list' }, (ai.key_questions.length ? ai.key_questions : [{ question: '', tag: '' }]).map((q, i) => buildKqRow(q, i))),
    el('button', { class: 'btn', type: 'button', onclick: addKqRow, style: { marginTop: '6px' } }, '+ Add question'),

    buildField('Limitations (LaTeX OK)', 'limitations', ai.limitations, { textarea: true }),

    el('div', { class: 'form-grid' }, [
      el('div', { class: 'field' }, [
        el('label', {}, 'Overall recommendation (1–6)'),
        el('select', { id: 'f-overall_recommendation' }, [1, 2, 3, 4, 5, 6].map((n) =>
          el('option', { value: n, selected: n === ai.overall_recommendation }, recommendationLabel(n))
        )),
      ]),
      el('div', { class: 'field' }, [
        el('label', {}, 'Confidence (1–5)'),
        el('select', { id: 'f-confidence' }, [1, 2, 3, 4, 5].map((n) =>
          el('option', { value: n, selected: n === ai.confidence }, String(n))
        )),
      ]),
    ]),

    el('div', { class: 'field-inline mb-2' }, [
      el('input', { type: 'checkbox', id: 'f-ethics', checked: !!ai.ethics_flag, onchange: (e) => {
        $('#f-ethics-concerns-wrap').style.display = e.target.checked ? 'block' : 'none';
      }}),
      el('label', { for: 'f-ethics', style: { margin: 0 } }, 'Flag for ethics review'),
    ]),
    el('div', { id: 'f-ethics-concerns-wrap', style: { display: ai.ethics_flag ? 'block' : 'none' } }, [
      buildField('Ethics concerns', 'ethics_concerns', ai.ethics_concerns || '', { textarea: true }),
    ]),

    el('h3', { style: { margin: '18px 0 8px', fontSize: '14px' } }, 'Feed highlights'),
    buildField('Why read (1 sentence)', 'why_read', rh.why_read),
    buildField('Why doubt (1 sentence)', 'why_doubt', rh.why_doubt),
    el('div', { class: 'field' }, [
      el('label', {}, 'Verdict leaning'),
      el('div', { class: 'flex gap-3' }, ['positive', 'mixed', 'critical'].map((val) =>
        el('label', { class: 'flex items-center gap-2', style: { margin: 0, fontWeight: 'normal' } }, [
          el('input', { type: 'radio', name: 'verdict_leaning', value: val, checked: rh.verdict_leaning === val }),
          val,
        ])
      )),
    ]),
  ]);
  return panel;
}

function buildKqRow(q, i) {
  return el('div', { class: 'rating-row kq-row' }, [
    el('span', { class: 'muted' }, `#${i + 1}`),
    el('input', { type: 'text', class: 'kq-tag', placeholder: 'tag e.g. could raise soundness', value: q.tag || '' }),
    el('div', { class: 'flex gap-2' }, [
      el('textarea', { class: 'kq-question', placeholder: 'Question text…', style: { minHeight: '60px' } }, q.question || ''),
      el('button', { class: 'btn btn-link', type: 'button', style: { color: 'var(--red)', alignSelf: 'start' }, onclick: (e) => {
        e.target.closest('.kq-row').remove();
      } }, '✕'),
    ]),
  ]);
}

function addKqRow() {
  const list = $('#kq-list');
  list.appendChild(buildKqRow({}, list.children.length));
}

function recommendationLabel(n) {
  return ({ 1: '1 · Strong Reject', 2: '2 · Reject', 3: '3 · Weak Reject', 4: '4 · Weak Accept', 5: '5 · Accept', 6: '6 · Strong Accept' })[n];
}

function parseBulk(raw, review) {
  if (!raw.trim()) { toast('Paste some JSON first', 'warn'); return; }
  let parsed;
  try { parsed = JSON.parse(raw); } catch (e) { toast(`JSON parse failed: ${e.message}`, 'err'); return; }

  const ai = parsed.ai_review || parsed;
  const rh = parsed.review_highlights;

  if (ai?.summary != null) $('#f-summary').value = ai.summary;
  if (ai?.strengths_weaknesses != null) $('#f-strengths_weaknesses').value = ai.strengths_weaknesses;
  if (ai?.limitations != null) $('#f-limitations').value = ai.limitations;

  if (ai?.ratings) {
    for (const k of ['soundness', 'presentation', 'significance', 'originality']) {
      if (ai.ratings[k]) {
        $(`#rating-${k}-score`).value = String(ai.ratings[k].score ?? 3);
        $(`#rating-${k}-note`).value = ai.ratings[k].note ?? '';
      }
    }
  }
  if (ai?.key_questions) {
    const list = $('#kq-list');
    mount(list, ...ai.key_questions.map((q, i) => buildKqRow(q, i)));
    if (!ai.key_questions.length) list.appendChild(buildKqRow({}, 0));
  }
  if (ai?.overall_recommendation != null) $('#f-overall_recommendation').value = String(ai.overall_recommendation);
  if (ai?.confidence != null) $('#f-confidence').value = String(ai.confidence);
  if (ai?.ethics_flag != null) {
    $('#f-ethics').checked = !!ai.ethics_flag;
    $('#f-ethics-concerns-wrap').style.display = ai.ethics_flag ? 'block' : 'none';
    if (ai.ethics_concerns != null) $('#f-ethics_concerns').value = ai.ethics_concerns || '';
  }

  if (rh) {
    if (rh.why_read != null) $('#f-why_read').value = rh.why_read;
    if (rh.why_doubt != null) $('#f-why_doubt').value = rh.why_doubt;
    if (rh.verdict_leaning) {
      const radio = $(`input[name="verdict_leaning"][value="${rh.verdict_leaning}"]`);
      if (radio) radio.checked = true;
    }
  }

  toast('Parsed — review fields populated');
}

function readFormAsReview(prev) {
  const title = $('#f-title').value.trim();
  const paper_url = $('#f-paper_url').value.trim();
  const abstract = $('#f-abstract').value.trim();
  const categories = $('#f-arxiv_categories').value.split(',').map((s) => s.trim()).filter(Boolean);
  const hfRankRaw = $('#f-hf_rank').value.trim();
  const hf_rank = hfRankRaw ? Number(hfRankRaw) : undefined;

  const date = prev.date || new Date().toISOString().slice(0, 10);
  const slug = prev.slug || slugify(title);
  const id = prev.id || `${date}-${slug}`;

  const ethicsFlag = $('#f-ethics').checked;
  const ethicsConcernsEl = $('#f-ethics_concerns');
  const ethicsConcerns = ethicsFlag && ethicsConcernsEl ? ethicsConcernsEl.value.trim() : null;

  const kqRows = $$('#kq-list .kq-row').map((row) => ({
    question: row.querySelector('.kq-question').value.trim(),
    tag: row.querySelector('.kq-tag').value.trim() || undefined,
  })).filter((q) => q.question);

  return {
    id,
    slug,
    date,
    title,
    paper_url,
    ...(hf_rank != null && !Number.isNaN(hf_rank) ? { hf_rank } : {}),
    ...(categories.length ? { arxiv_categories: categories } : {}),
    abstract,
    ai_review: {
      summary: $('#f-summary').value.trim(),
      strengths_weaknesses: $('#f-strengths_weaknesses').value.trim(),
      ratings: {
        soundness:    { score: Number($('#rating-soundness-score').value),    note: $('#rating-soundness-note').value.trim() },
        presentation: { score: Number($('#rating-presentation-score').value), note: $('#rating-presentation-note').value.trim() },
        significance: { score: Number($('#rating-significance-score').value), note: $('#rating-significance-note').value.trim() },
        originality:  { score: Number($('#rating-originality-score').value),  note: $('#rating-originality-note').value.trim() },
      },
      key_questions: kqRows.map((q) => q.tag ? q : { question: q.question }),
      limitations: $('#f-limitations').value.trim(),
      overall_recommendation: Number($('#f-overall_recommendation').value),
      confidence: Number($('#f-confidence').value),
      ethics_flag: ethicsFlag,
      ethics_concerns: ethicsConcerns || null,
    },
    review_highlights: {
      why_read: $('#f-why_read').value.trim(),
      why_doubt: $('#f-why_doubt').value.trim(),
      verdict_leaning: ($('input[name="verdict_leaning"]:checked')?.value) || 'mixed',
    },
    updated_at: new Date().toISOString(),
  };
}

async function saveEditor(prev) {
  const review = readFormAsReview(prev);
  try {
    const r = await api('/api/reviews', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(review),
    });
    toast(`Saved ${r.id}`, 'ok');
    navTo({});
  } catch (e) {
    toast(`Save failed: ${e.message}`, 'err', 6000);
  }
}

// ---------- boot ----------

route();
