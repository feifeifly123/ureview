// Ureview Studio — vanilla SPA.
//
// Two views share the same root <main id="app">:
//   Dashboard: arxiv-id entry form + existing reviews list
//   Editor:    arxiv-passthrough block (read-only) + AI proof review textarea
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

async function renderDashboard() {
  const root = $('#app');
  const grid = el('div', { class: 'dashboard-grid' }, [
    buildNewReviewPanel(),
    buildReviewsPanel(),
  ]);
  mount(root, grid);
  await loadReviewsList();
}

function buildNewReviewPanel() {
  return el('section', { class: 'board board--daily', id: 'new-review-panel' }, [
    el('div', { class: 'board-head' }, [
      el('div', {}, [
        el('h2', { class: 'board-title' }, 'New review'),
        el('span', { class: 'board-subtitle' }, 'Paste an arxiv math paper id · we fetch the rest'),
      ]),
    ]),
    el('div', { class: 'new-review-form' }, [
      el('div', { class: 'inline-field' }, [
        el('input', {
          type: 'text', id: 'arxiv-input',
          placeholder: 'e.g. 2401.12345  or  math/0211159  or full arxiv URL',
          onkeydown: (e) => { if (e.key === 'Enter') startEditorByArxiv(); },
        }),
        el('button', { class: 'btn btn-primary', onclick: startEditorByArxiv }, 'Fetch metadata →'),
      ]),
      el('p', { class: 'new-review-hint' },
        "We accept arxiv new-style ids (YYYY.NNNNN) and old-style (math/NNNNNNN). Once fetched, you'll see the paper's title, abstract, authors, and categories pre-filled; the only thing you write is the AI proof review."),
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
  if (!raw) { toast('Paste an arxiv id first', 'warn'); return; }
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
      mount(list, el('p', { class: 'skel' }, 'No reviews yet. Paste an arxiv id above to start.'));
      return;
    }
    const rows = reviews.map((r) => {
      const cats = (r.arxiv_categories || []).slice(0, 2).join(' · ');
      const authors = (r.authors || []);
      const authorLine = authors.length === 0 ? ''
        : authors.length <= 2 ? authors.join(', ')
        : `${authors[0]}, ${authors[1]} et al.`;
      return el('a', {
        class: 'listing listing--review',
        href: `?review=${encodeURIComponent(r.id)}`,
        onclick: (e) => { e.preventDefault(); navTo({ review: r.id }); },
      }, [
        el('span', { class: 'listing-meta' }, [
          el('span', { class: 'id' }, r.id),
        ]),
        el('span', { class: 'listing-right' }, r.date),
        el('span', { class: 'listing-title' }, r.title),
        el('span', { class: 'listing-status' }, [
          el('span', {}, authorLine || '—'),
          cats ? el('span', { class: 'cats' }, ` · ${cats}`) : null,
        ].filter((n) => n != null)),
      ]);
    });
    mount(list, ...rows);
  } catch (e) {
    mount(list, el('div', { class: 'error-box' }, `Failed to load reviews: ${e.message}`));
  }
}

// ---------- editor ----------

const EMPTY_REVIEW = () => ({
  id: '',
  date: new Date().toISOString().slice(0, 10),
  title: '',
  paper_url: '',
  arxiv_categories: [],
  authors: [],
  published: null,
  abstract: '',
  ai_proof_review: '',
  updated_at: new Date().toISOString(),
});

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
      review.authors = meta.authors || [];
      review.published = meta.published || null;
      review.id = arxivId;
      // Heads-up if the paper isn't math.* — schema will reject on save.
      const cats = review.arxiv_categories || [];
      if (!cats.some((c) => c.startsWith('math.'))) {
        toast(`Warning: no math.* category found (got ${cats.join(', ') || 'none'}). Save will fail.`, 'warn', 6000);
      }
    } catch (e) {
      toast(`arxiv fetch failed: ${e.message}`, 'err', 5000);
    }
  }

  mount(root, buildEditorView(review, isNew));
}

function buildEditorView(review, isNew) {
  const container = el('div', { class: 'editor-root' });

  // Build a PDF URL from the arxiv paper_url (https://arxiv.org/abs/{id} → /pdf/{id})
  const pdfUrl = (() => {
    const m = (review.paper_url || '').match(/arxiv\.org\/abs\/([^/?#]+)/i);
    if (!m) return null;
    const id = m[1].replace(/v\d+$/, '');
    return `https://arxiv.org/pdf/${id}.pdf`;
  })();

  // Chapter I — Paper metadata (arxiv passthrough, read-only by default)
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
      'Passthrough from arxiv. Read-only by default — click ✎ Edit to override.'),
    el('div', { class: 'field-grid' }, [
      buildProtectedField('Title', 'title', review.title),
      buildProtectedField('arxiv URL', 'paper_url', review.paper_url),
    ]),
    buildProtectedField('Abstract (arxiv)', 'abstract', review.abstract, { textarea: true, tall: true }),
    el('div', { class: 'field-grid' }, [
      buildProtectedField('Authors (comma-separated)', 'authors', (review.authors || []).join(', ')),
      buildProtectedField('Categories (comma-separated, math.* only)', 'arxiv_categories', (review.arxiv_categories || []).join(', ')),
    ]),
  ]);

  // Chapter II — AI proof review (the only field the human types)
  const chapterB = el('section', { class: 'chapter chapter--proof' }, [
    el('header', { class: 'chapter-head' }, [
      el('span', { class: 'chapter-num' }, 'II · AI proof review'),
      el('h2', { class: 'chapter-title' }, [el('em', {}, 'one long-form reading')]),
    ]),
    el('p', { class: 'chapter-lede' },
      'Paste / write the AI evaluation of the proof. Markdown headings (## Setup / ## Lemma 2.1 / ## Overall) are honoured. LaTeX inline ($...$) and display ($$...$$) are typeset on the public page.'),
    el('div', { class: 'field' }, [
      el('label', { for: 'f-ai_proof_review', class: 'field-label' }, 'AI proof review (Markdown + LaTeX)'),
      el('textarea', {
        id: 'f-ai_proof_review',
        class: 'tall tall--xl',
        placeholder: '## Setup\n\nThe paper claims …\n\n## Lemma 2.1\n\nThe argument uses …\n\n## Overall\n\n…',
      }, review.ai_proof_review || ''),
      el('p', { class: 'field-hint' }, 'Minimum 50 characters.'),
    ]),
  ]);

  const saveBtn = el('button', { class: 'btn btn-primary', onclick: () => saveEditor(review) }, isNew ? 'Save new review' : 'Save changes');
  const cancelBtn = el('button', { class: 'btn', onclick: () => navTo({}) }, 'Cancel');

  container.appendChild(chapterA);
  container.appendChild(chapterB);
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
// source (arxiv) per PHILOSOPHY §4 — it shouldn't be casually edited.
// It renders readonly with a small ✎ Edit button; clicking the button flips
// readonly off for just that field.
function buildProtectedField(label, key, value, opts = {}) {
  const id = `f-${key}`;
  const input = opts.textarea
    ? el('textarea', { id, class: opts.tall ? 'tall' : '', readonly: '' }, String(value || ''))
    : el('input', { id, type: opts.type || 'text', value: value ?? '', readonly: '' });

  const unlockBtn = el('button', {
    type: 'button',
    class: 'field-unlock',
    'aria-label': `Unlock ${label}`,
    title: 'Unlock to edit (default: passthrough from arxiv)',
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

function readFormAsReview(prev) {
  const title = $('#f-title').value.trim();
  const paper_url = $('#f-paper_url').value.trim();
  const abstract = $('#f-abstract').value.trim();
  const categories = $('#f-arxiv_categories').value.split(',').map((s) => s.trim()).filter(Boolean);
  const authors = $('#f-authors').value.split(',').map((s) => s.trim()).filter(Boolean);
  const ai_proof_review = $('#f-ai_proof_review').value.trim();

  const date = prev.date || new Date().toISOString().slice(0, 10);
  // Canonical id = arxiv id extracted from paper_url (strip any version suffix).
  const arxivMatch = (paper_url || '').match(/arxiv\.org\/abs\/([^/?#]+)/i);
  const arxivId = arxivMatch ? arxivMatch[1].replace(/v\d+$/, '') : '';
  const id = prev.id || arxivId;

  const out = {
    id,
    date,
    title,
    paper_url,
    arxiv_categories: categories,
    authors,
    abstract,
    ai_proof_review,
    updated_at: new Date().toISOString(),
  };
  if (prev.published) out.published = prev.published;
  return out;
}

async function saveEditor(prev) {
  const review = readFormAsReview(prev);
  if ((review.ai_proof_review || '').length < 50) {
    toast('AI proof review must be at least 50 characters.', 'warn', 5000);
    return;
  }
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
