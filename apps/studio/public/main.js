// OpenAgent Studio — vanilla SPA.
//
// Two views share the same root <main id="app">:
//   Dashboard: HF Daily papers, existing reviews
//   Editor:    per-paper form with LLM paste + structured fields
//
// Client-side routing via the `view` query param.

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

// ---------- theme (day / night) ----------

(function initTheme() {
  const KEY = 'studio-theme';
  const saved = localStorage.getItem(KEY);
  const prefersDay = window.matchMedia?.('(prefers-color-scheme: light)').matches;
  const initial = saved || (prefersDay ? 'day' : 'night');
  document.documentElement.setAttribute('data-theme', initial);

  function syncButton() {
    const t = document.documentElement.getAttribute('data-theme');
    const btn = document.getElementById('theme-toggle');
    if (!btn) return;
    const glyph = btn.querySelector('.theme-toggle-glyph');
    const label = btn.querySelector('.theme-toggle-label');
    if (glyph) glyph.textContent = t === 'day' ? '☀' : '☾';
    if (label) label.textContent = t === 'day' ? 'Day edition' : 'Night edition';
    btn.setAttribute('aria-label', `Switch to ${t === 'day' ? 'night' : 'day'} edition`);
  }

  document.addEventListener('click', (e) => {
    if (!e.target.closest('#theme-toggle')) return;
    const next = document.documentElement.getAttribute('data-theme') === 'day' ? 'night' : 'day';
    document.documentElement.setAttribute('data-theme', next);
    localStorage.setItem(KEY, next);
    syncButton();
  });

  // Button is in the HTML but glyph/label text is theme-dependent
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', syncButton, { once: true });
  } else {
    syncButton();
  }
})();

// ---------- masthead date ----------

(function setMastheadDate() {
  const d = new Date();
  const wd = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'][d.getDay()];
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  const yy = String(d.getFullYear()).slice(2);
  const target = document.getElementById('masthead-date');
  if (target) target.textContent = `MS · ${mm}·${dd}·${yy} · ${wd}`;
})();

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
  // Strip leading slash so fetch resolves relative to document.baseURI.
  // This lets Studio work both at http://host:4311/ (direct) and under a
  // path-prefix proxy like JupyterHub's /user/<u>/proxy/4311/.
  const res = await fetch(path.replace(/^\//, ''), opts);
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

let dailyCache = null;

async function renderDashboard() {
  const root = $('#app');
  const grid = el('div', { class: 'dashboard-grid' }, [
    buildDailyPanel(),
    buildReviewsPanel(),
  ]);
  mount(root, grid);
  await Promise.all([loadReviewsList(), dailyCache ? renderDailyList(dailyCache) : null]);
}

function buildDailyPanel() {
  return el('section', { class: 'board board--daily', id: 'daily-panel' }, [
    el('div', { class: 'board-head' }, [
      el('div', {}, [
        el('h2', { class: 'board-title' }, 'HF Daily'),
        el('span', { class: 'board-subtitle' }, "Today's papers · hugging face"),
      ]),
      el('div', { class: 'board-actions' }, [
        el('div', { class: 'inline-field' }, [
          el('input', {
            type: 'text', id: 'arxiv-input', placeholder: 'arXiv ID…',
            onkeydown: (e) => { if (e.key === 'Enter') startEditorByArxiv(); },
          }),
          el('button', { class: 'btn-link', onclick: startEditorByArxiv }, 'Open →'),
        ]),
        el('button', { class: 'btn btn-primary', id: 'sync-btn', onclick: syncDaily }, 'Sync daily'),
      ]),
    ]),
    el('div', { id: 'daily-list' }, [
      el('p', { class: 'skel' }, 'Click "Sync daily" to pull today\'s HF Daily papers.'),
    ]),
  ]);
}

function buildReviewsPanel() {
  return el('section', { class: 'board board--reviews' }, [
    el('div', { class: 'board-head' }, [
      el('div', {}, [
        el('h2', { class: 'board-title' }, 'Existing reviews'),
        el('span', { class: 'board-subtitle' }, 'Filed · on disk'),
      ]),
      el('span', { class: 'board-count', id: 'reviews-count' }, '—'),
    ]),
    el('div', { id: 'reviews-list' }, [el('p', { class: 'skel' }, 'Loading…')]),
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
    count.textContent = `${reviews.length} ON FILE`;
    if (reviews.length === 0) {
      mount(list, el('p', { class: 'skel' }, 'No reviews yet. Add one from today\'s HF Daily or by arXiv ID above.'));
      return;
    }
    const rows = reviews.map((r) => {
      const leaning = r.verdict_leaning || null;
      const classes = ['listing', 'listing--review'];
      if (leaning) classes.push(`listing--${leaning}`);
      return el('a', {
        class: classes.join(' '),
        href: `?review=${encodeURIComponent(r.id)}`,
        onclick: (e) => { e.preventDefault(); navTo({ review: r.id }); },
      }, [
        el('span', { class: 'listing-meta' }, [
          el('span', { class: 'id' }, r.arxiv_id || r.id.slice(0, 16)),
        ]),
        el('span', { class: 'listing-right' }, r.date),
        el('span', { class: 'listing-title' }, r.title),
        el('span', { class: 'listing-status' }, [
          leaning
            ? el('span', { class: `leaning leaning--${leaning}` }, leaning)
            : el('span', {}, '—'),
          r.ethics_flag ? el('span', { class: 'ethics' }, '⚠ ethics') : null,
        ]),
      ]);
    });
    mount(list, ...rows);
  } catch (e) {
    mount(list, el('div', { class: 'error-box' }, `Failed to load reviews: ${e.message}`));
  }
}

async function syncDaily() {
  const btn = $('#sync-btn');
  btn.disabled = true;
  btn.textContent = 'Syncing…';
  try {
    dailyCache = await api('/api/daily');
    renderDailyList(dailyCache);
    toast(`Fetched ${dailyCache.length} daily papers`);
  } catch (e) {
    mount($('#daily-list'), el('div', { class: 'error-box' }, `HF sync failed:\n${e.message}`));
    toast('HF sync failed — see panel', 'err');
  } finally {
    btn.disabled = false;
    btn.textContent = 'Sync daily';
  }
}

async function renderDailyList(papers) {
  const list = $('#daily-list');
  if (!list) return;
  let reviewedSet = new Set();
  try {
    const reviews = await api('/api/reviews');
    reviewedSet = new Set(reviews.map((r) => r.arxiv_id).filter(Boolean));
  } catch {}

  if (!papers.length) {
    mount(list, el('p', { class: 'skel' }, 'No papers in today\'s HF Daily.'));
    return;
  }

  const rows = papers.slice(0, 30).map((p) => {
    const arxivId = p.arxiv_id || (p.url?.match(/arxiv\.org\/abs\/(.+)/)?.[1] ?? '').replace(/v\d+$/, '');
    const reviewed = reviewedSet.has(arxivId);
    const rank = String(p.rank).padStart(2, '0');
    return el('a', {
      class: 'listing listing--daily',
      href: `?paper=${encodeURIComponent(arxivId)}`,
      onclick: (e) => { e.preventDefault(); navTo(reviewed ? { review: null } : { paper: arxivId }); },
    }, [
      el('span', { class: 'listing-meta' }, [
        el('span', { class: 'rank' }, `№ ${rank}`),
        el('span', { class: 'id' }, arxivId),
      ]),
      el('span', { class: 'listing-right' }, p.upvotes != null ? `↑ ${p.upvotes}` : ''),
      el('span', { class: 'listing-title' }, p.title),
      el('span', { class: 'listing-status' }, [
        reviewed
          ? el('span', { class: 'status--reviewed' }, '✓ Reviewed')
          : el('span', { class: 'status--new' }, '○ New'),
      ]),
    ]);
  });
  mount(list, ...rows);
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
    key_questions: '',
    limitations: '',
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
      // Canonical id = arxiv id (already normalized by /api/arxiv).
      review.id = arxivId;

      // HF rank comes from the Daily list, not the arXiv API. If we
      // already synced today's Daily and this paper is in it, pre-fill
      // the rank so the author doesn't have to look it up by hand.
      if (dailyCache) {
        const hit = dailyCache.find((p) => {
          const pid = (p.arxiv_id || '').replace(/v\d+$/, '');
          return pid === arxivId;
        });
        if (hit && hit.rank != null) review.hf_rank = hit.rank;
      }
    } catch (e) {
      toast(`arXiv fetch failed: ${e.message}`, 'err', 5000);
    }
  }

  mount(root, buildEditorView(review, isNew));
}

function buildEditorView(review, isNew) {
  const container = el('div', { class: 'editor-root' });

  // Chapter I — Paper metadata
  // Build a PDF URL from the arxiv paper_url (https://arxiv.org/abs/{id} → /pdf/{id})
  const pdfUrl = (() => {
    const m = (review.paper_url || '').match(/arxiv\.org\/abs\/([^/?#]+)/i);
    if (!m) return null;
    const id = m[1].replace(/v\d+$/, '');
    return `https://arxiv.org/pdf/${id}.pdf`;
  })();

  const chapterA = el('section', { class: 'chapter chapter--paper' }, [
    el('header', { class: 'chapter-head' }, [
      el('span', { class: 'chapter-num' }, 'I · Paper'),
      el('h2', { class: 'chapter-title' },
        isNew ? [el('em', {}, 'new record')] : [review.id],
      ),
      el('div', { class: 'chapter-action' }, [
        pdfUrl
          ? el('a', {
              class: 'btn-link',
              href: pdfUrl,
              target: '_blank',
              rel: 'noopener',
              title: 'Open the paper PDF on arxiv.org (new tab)',
            }, '↗ Open PDF')
          : null,
        el('button', { class: 'btn-link', onclick: () => navTo({}) }, '← Back'),
      ].filter((n) => n != null)),
    ]),
    el('p', { class: 'chapter-lede' },
      'Passthrough from arXiv and HF Daily. All fields in this block are read-only by default — click ✎ Edit to override if you really need to fix something at the source layer.'),
    el('div', { class: 'field-grid' }, [
      buildProtectedField('Title', 'title', review.title),
      buildProtectedField('arXiv URL', 'paper_url', review.paper_url),
    ]),
    buildProtectedField('Abstract (arXiv)', 'abstract', review.abstract, { textarea: true, tall: true }),
    el('div', { class: 'field-grid' }, [
      buildProtectedField('Categories (comma-separated)', 'arxiv_categories', (review.arxiv_categories || []).join(', ')),
      buildProtectedField('HF rank', 'hf_rank', review.hf_rank ?? '', { type: 'number' }),
    ]),
  ]);

  // Chapter II — Structured judgment (hand-filled; the Paste LLM shortcut
  // was removed when authoring switched to fully manual entry).
  const chapterC = buildStructuredFields(review);

  // Footer
  const saveBtn = el('button', { class: 'btn btn-primary', onclick: () => saveEditor(review) }, isNew ? 'Save new review' : 'Save changes');
  const cancelBtn = el('button', { class: 'btn', onclick: () => navTo({}) }, 'Cancel');

  container.appendChild(chapterA);
  container.appendChild(chapterC);
  container.appendChild(el('div', { class: 'footer-bar' }, [cancelBtn, saveBtn]));
  return container;
}

function buildField(label, key, value, opts = {}) {
  const id = `f-${key}`;
  const field = el('div', { class: 'field' }, [el('label', { for: id, class: 'field-label' }, label)]);
  const input = opts.textarea
    ? el('textarea', { id, class: opts.tall ? 'tall' : '' }, String(value || ''))
    : el('input', { id, type: opts.type || 'text', value: value ?? '' });
  field.appendChild(input);
  return field;
}

// A "protected" field is one whose value is passthrough from an upstream
// source (arXiv / HF) per PHILOSOPHY §4 — it shouldn't be casually edited.
// It renders readonly with a small ✎ Edit button; clicking the button flips
// readonly off for just that field. Everything else is identical to buildField.
function buildProtectedField(label, key, value, opts = {}) {
  const id = `f-${key}`;
  const input = opts.textarea
    ? el('textarea', { id, class: opts.tall ? 'tall' : '', readonly: '' }, String(value || ''))
    : el('input', { id, type: opts.type || 'text', value: value ?? '', readonly: '' });

  const unlockBtn = el('button', {
    type: 'button',
    class: 'field-unlock',
    'aria-label': `Unlock ${label}`,
    title: 'Unlock to edit (default: passthrough from upstream)',
  }, '✎ Edit');

  unlockBtn.addEventListener('click', () => {
    if (input.hasAttribute('readonly')) {
      input.removeAttribute('readonly');
      field.classList.remove('field--locked');
      unlockBtn.textContent = '✕ Lock';
      input.focus();
    } else {
      input.setAttribute('readonly', '');
      field.classList.add('field--locked');
      unlockBtn.textContent = '✎ Edit';
    }
  });

  const labelRow = el('div', { class: 'field-label-row' }, [
    el('label', { for: id, class: 'field-label' }, label),
    unlockBtn,
  ]);

  const field = el('div', { class: 'field field--locked' }, [labelRow, input]);
  return field;
}

// ----- stepper / tick / verdict widgets -----

function buildDotStepper(hiddenId, value, max, ariaLabel) {
  const hidden = el('input', { type: 'hidden', id: hiddenId, value: String(value || 3) });
  const group = el('div', { class: hiddenId.startsWith('rating-') ? 'rating-dots' : 'conf-dots', role: 'radiogroup', 'aria-label': ariaLabel });
  for (let i = 1; i <= max; i++) {
    const dot = el('button', {
      type: 'button',
      class: hiddenId.startsWith('rating-') ? 'rating-dot' : 'conf-dot',
      role: 'radio',
      'aria-checked': String(i === value),
      'aria-label': `${ariaLabel} ${i}`,
      'data-value': String(i),
      onclick: () => setStepperValue(hiddenId, i),
    });
    group.appendChild(dot);
  }
  group.appendChild(hidden);
  return group;
}

function setStepperValue(hiddenId, value) {
  const hidden = $(`#${hiddenId}`);
  if (!hidden) return;
  hidden.value = String(value);
  const group = hidden.parentElement;
  if (!group) return;
  group.querySelectorAll('[role="radio"]').forEach((b) => {
    b.setAttribute('aria-checked', b.dataset.value === String(value) ? 'true' : 'false');
  });
}

function buildVerdictCards(value) {
  const options = [
    { val: 'positive', name: 'Positive', gloss: 'The agent is net-optimistic.' },
    { val: 'mixed',    name: 'Mixed',    gloss: 'Strengths and concerns offset.' },
    { val: 'critical', name: 'Critical', gloss: 'Serious doubts dominate.' },
  ];
  const group = el('div', { class: 'verdict-cards' });
  options.forEach((o) => {
    const card = el('label', { class: `verdict-card verdict-card--${o.val}` }, [
      el('input', { type: 'radio', name: 'verdict_leaning', value: o.val, checked: value === o.val }),
      el('span', { class: 'verdict-card-name' }, o.name),
      el('span', { class: 'verdict-card-gloss' }, o.gloss),
    ]);
    group.appendChild(card);
  });
  return group;
}

function buildStructuredFields(review) {
  const ai = review.ai_review;
  const rh = review.review_highlights;

  return el('section', { class: 'chapter chapter--judgment' }, [
    el('header', { class: 'chapter-head' }, [
      el('span', { class: 'chapter-num' }, 'II · Judgment'),
      el('h2', { class: 'chapter-title' }, [el('em', {}, 'structured review')]),
    ]),
    el('p', { class: 'chapter-lede' },
      'Four dimensions, open questions, a single recommendation on the conference scale, and a feed-ready one-line verdict.'),

    buildField('Summary (paper in 60 s, LaTeX OK)', 'summary', ai.summary, { textarea: true }),
    buildField('Strengths & weaknesses (LaTeX OK)', 'strengths_weaknesses', ai.strengths_weaknesses, { textarea: true, tall: true }),

    // Ratings
    el('h3', { class: 'sub-heading' }, 'Dimensions · 1–4'),
    el('div', { class: 'rating-table' }, ['soundness', 'presentation', 'significance', 'originality'].map((k) =>
      el('div', { class: 'rating-row' }, [
        el('span', { class: 'rating-name' }, k),
        buildDotStepper(`rating-${k}-score`, ai.ratings[k].score, 4, `${k} score`),
        el('input', {
          id: `rating-${k}-note`, class: 'rating-note', type: 'text',
          value: ai.ratings[k].note, placeholder: 'One-line justification',
        }),
      ])
    )),

    // Key questions (free-form prose; LLM output uses blank lines between items)
    buildField('Key questions for authors (LaTeX OK)', 'key_questions', ai.key_questions || '', { textarea: true, tall: true }),

    buildField('Limitations (LaTeX OK)', 'limitations', ai.limitations, { textarea: true }),

    // Ethics
    el('h3', { class: 'sub-heading' }, 'Ethics'),
    el('label', { class: 'ethics-toggle', for: 'f-ethics' }, [
      el('input', {
        type: 'checkbox', id: 'f-ethics', checked: !!ai.ethics_flag,
        onchange: (e) => { $('#f-ethics-concerns-wrap').style.display = e.target.checked ? 'block' : 'none'; },
      }),
      'Flag for ethics review',
    ]),
    el('div', { id: 'f-ethics-concerns-wrap', class: 'ethics-wrap', style: { display: ai.ethics_flag ? 'block' : 'none' } }, [
      buildField('Ethics concerns', 'ethics_concerns', ai.ethics_concerns || '', { textarea: true }),
    ]),

    // Feed highlights
    el('h3', { class: 'sub-heading' }, 'Feed highlights'),
    el('div', { class: 'field-grid' }, [
      buildField('Why read · 1 sentence', 'why_read', rh.why_read),
      buildField('Why doubt · 1 sentence', 'why_doubt', rh.why_doubt),
    ]),
    el('div', { class: 'field' }, [
      el('span', { class: 'field-label' }, 'Verdict leaning'),
      buildVerdictCards(rh.verdict_leaning),
    ]),
  ]);
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
  // Canonical id = arxiv id extracted from paper_url (strip any version suffix).
  const arxivMatch = (paper_url || '').match(/arxiv\.org\/abs\/([^/?#]+)/i);
  const arxivId = arxivMatch ? arxivMatch[1].replace(/v\d+$/, '') : '';
  const id = prev.id || arxivId;

  const ethicsFlag = $('#f-ethics').checked;
  const ethicsConcernsEl = $('#f-ethics_concerns');
  const ethicsConcerns = ethicsFlag && ethicsConcernsEl ? ethicsConcernsEl.value.trim() : null;

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
      key_questions: $('#f-key_questions').value.trim(),
      limitations: $('#f-limitations').value.trim(),
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
