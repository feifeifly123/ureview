import { dataClient } from './data-client';
import { el, mount } from './dom';
import { formatDate, safeHref } from './utils';
import { leaningLabel } from './feed-card';
import type { Review, AIReviewRatings } from './types';

function paragraphs(text: string): HTMLElement[] {
  return text
    .split(/\n\s*\n/)
    .map((block) => block.trim())
    .filter((block) => block.length > 0)
    .map((block) => el('p', {}, block));
}

function firstSentence(text: string): string {
  const trimmed = text.trim();
  const match = trimmed.match(/^(.+?[.!?])(\s|$)/);
  return match ? match[1] : trimmed;
}

function arxivFromUrl(url: string | undefined): string | null {
  if (!url) return null;
  const m = url.match(/arxiv\.org\/abs\/([^/?#]+)/i);
  return m ? m[1].replace(/v\d+$/, '') : null;
}

// ---------- header ----------

function buildHeader(review: Review): HTMLElement {
  const ai = review.ai_review;
  const arxiv = arxivFromUrl(review.paper_url);

  const kickerBits: HTMLElement[] = [];
  if (arxiv) {
    kickerBits.push(el('span', { class: 'id' }, arxiv));
    kickerBits.push(el('span', { class: 'sep' }, '·'));
  }
  if (review.hf_rank != null) {
    kickerBits.push(el('span', { class: 'rank' }, `HF №${String(review.hf_rank).padStart(2, '0')}`));
    kickerBits.push(el('span', { class: 'sep' }, '·'));
  }
  (review.arxiv_categories ?? []).forEach((cat, i, all) => {
    kickerBits.push(el('span', {}, cat));
    if (i < all.length - 1) kickerBits.push(el('span', { class: 'sep' }, '·'));
  });
  if (ai.ethics_flag) {
    if (kickerBits.length) kickerBits.push(el('span', { class: 'sep' }, '·'));
    kickerBits.push(el('span', { class: 'ethics' }, '⚠ Ethics flagged'));
  }

  const kicker = el('div', { class: 'review-kicker' }, kickerBits);
  const title = el('h1', { class: 'review-title' }, review.title);

  const dateline = el('div', { class: 'review-dateline' }, [
    el('span', {}, `Filed ${formatDate(review.date)}`),
    el('span', { class: 'review-dateline-sep' }, '·'),
    el('a', {
      class: 'review-action',
      href: safeHref(review.paper_url),
      target: '_blank',
      rel: 'noopener',
    }, 'Open paper →'),
    el('button', {
      class: 'review-action',
      type: 'button',
      'data-copy-link': 'true',
    }, 'Copy link'),
  ]);

  return el('header', { class: 'review-head' }, [kicker, title, dateline]);
}

function buildEthicsBanner(review: Review): HTMLElement | null {
  const ai = review.ai_review;
  if (!ai.ethics_flag) return null;
  const kids: HTMLElement[] = [el('strong', {}, '⚠  Flagged for ethics review')];
  if (ai.ethics_concerns) {
    kids.push(el('p', {}, ai.ethics_concerns));
  }
  return el('div', { class: 'ethics-banner', role: 'alert' }, kids);
}

// ---------- scorecard ----------

function buildScorecard(review: Review): HTMLElement {
  const ai = review.ai_review;
  const highlights = review.review_highlights;
  const leaning = highlights.verdict_leaning;

  const verdictWord = (leaning === 'positive' ? 'Positive' : leaning === 'critical' ? 'Critical' : 'Mixed');
  const verdictClass = leaning === 'positive' ? 'scorecard-value--verdict'
    : leaning === 'mixed' ? 'scorecard-value scorecard-value--mixed'
    : 'scorecard-value scorecard-value--critical';

  const r = ai.ratings;
  const ratingChip = (label: string, score: number) => el('span', { class: 'scorecard-rating' }, [
    el('span', { class: 'scorecard-rating-label' }, label),
    el('span', { class: 'scorecard-rating-score' }, String(score)),
  ]);

  const grid = el('div', { class: 'scorecard-grid scorecard-grid--2' }, [
    el('div', { class: 'scorecard-cell' }, [
      el('span', { class: 'scorecard-label' }, 'Verdict leaning'),
      el('div', { class: `scorecard-value ${verdictClass}` }, verdictWord),
      el('span', { class: 'scorecard-gloss' }, leaningLabel(leaning)),
    ]),
    el('div', { class: 'scorecard-cell scorecard-cell--ratings' }, [
      el('span', { class: 'scorecard-label' }, 'Ratings'),
      el('div', { class: 'scorecard-ratings' }, [
        ratingChip('Snd', r.soundness.score),
        ratingChip('Prs', r.presentation.score),
        ratingChip('Sig', r.significance.score),
        ratingChip('Org', r.originality.score),
      ]),
      el('span', { class: 'scorecard-gloss' }, 'each out of 4'),
    ]),
  ]);

  const lead = el('p', { class: 'scorecard-lead', 'data-typeset': 'true' }, firstSentence(ai.summary));
  const disclaimer = el('p', { class: 'scorecard-disclaimer' }, 'Machine-generated first-pass reading · not peer review');

  return el('section', { class: `scorecard scorecard--${leaning}`, 'aria-label': 'Verdict at a glance' }, [
    grid,
    lead,
    disclaimer,
  ]);
}

// ---------- judgment (4 dimensions) ----------

const DIMENSIONS: { key: keyof AIReviewRatings; label: string }[] = [
  { key: 'soundness', label: 'Soundness' },
  { key: 'presentation', label: 'Presentation' },
  { key: 'significance', label: 'Significance' },
  { key: 'originality', label: 'Originality' },
];

function buildJudgment(review: Review): HTMLElement {
  const ai = review.ai_review;
  const rows = DIMENSIONS.map(({ key, label }) => {
    const r = ai.ratings[key];
    return el('div', { class: 'dimension-row' }, [
      el('span', { class: 'dimension-name' }, label),
      el('span', { class: 'dimension-score' }, [
        el('span', { class: 'dimension-score-n' }, String(r.score)),
        el('span', {}, '/ 4'),
      ]),
      el('p', { class: 'dimension-note', 'data-typeset': 'true' }, r.note),
    ]);
  });

  return el('section', { class: 'review-section', id: 'judgment' }, [
    el('span', { class: 'review-section-kicker' }, 'I · Judgment'),
    el('h2', { class: 'review-section-title' }, 'Four dimensions, read separately'),
    el('p', { class: 'review-section-intro' }, 'Ratings sit side-by-side — never averaged. The shape of the reasoning matters more than a single number.'),
    el('div', { class: 'dimension-table' }, rows),
    el('details', { class: 'review-details' }, [
      el('summary', {}, 'The agent\u2019s summary in full'),
      el('div', { class: 'review-prose', 'data-typeset': 'true' }, paragraphs(ai.summary)),
      el('hr', { style: { border: 'none', borderTop: '1px dashed var(--rule)', margin: '24px 0' } }),
      el('div', { class: 'review-prose', 'data-typeset': 'true' }, paragraphs(ai.strengths_weaknesses)),
    ]),
  ]);
}

// ---------- key questions (free-form prose) ----------

function buildKeyQuestions(review: Review): HTMLElement | null {
  const text = (review.ai_review.key_questions ?? '').trim();
  if (!text) return null;

  return el('section', { class: 'review-section', id: 'questions' }, [
    el('span', { class: 'review-section-kicker' }, 'II · Follow-up'),
    el('h2', { class: 'review-section-title' }, 'What would change this verdict'),
    el('div', { class: 'review-prose', 'data-typeset': 'true' }, paragraphs(text)),
  ]);
}

// ---------- abstract + limits ----------

function buildAbstract(review: Review): HTMLElement {
  return el('section', { class: 'review-section', id: 'abstract' }, [
    el('span', { class: 'review-section-kicker' }, 'III · From arXiv'),
    el('h2', { class: 'review-section-title' }, 'Abstract'),
    el('p', { class: 'review-section-intro' }, 'Taken verbatim from the author\u2019s own arXiv submission.'),
    el('div', { class: 'review-prose review-prose--abstract', 'data-typeset': 'true' }, paragraphs(review.abstract)),
  ]);
}

function buildLimits(review: Review): HTMLElement | null {
  const text = review.ai_review.limitations?.trim();
  if (!text) return null;
  return el('section', { class: 'review-section', id: 'limits' }, [
    el('span', { class: 'review-section-kicker' }, 'IV · Caveats'),
    el('h2', { class: 'review-section-title' }, 'Limits & caveats'),
    el('div', { class: 'review-prose', 'data-typeset': 'true' }, paragraphs(text)),
  ]);
}

function buildRaw(review: Review): HTMLElement {
  const ai = review.ai_review;
  const composite = [ai.summary, ai.strengths_weaknesses, ai.limitations]
    .filter((x) => !!x && x.trim().length > 0)
    .join('\n\n');

  return el('section', { class: 'review-section review-section--raw', id: 'raw' }, [
    el('span', { class: 'review-section-kicker' }, 'Audit'),
    el('h2', { class: 'review-section-title' }, 'Raw agent prose'),
    el('p', { class: 'review-section-intro' }, 'The agent\u2019s original text, joined end-to-end with no restructuring.'),
    el('div', { class: 'review-prose review-prose--raw', 'data-typeset': 'true' }, paragraphs(composite)),
  ]);
}

// ---------- structured/raw toggle ----------

function buildModeToggle(): HTMLElement {
  return el('div', { class: 'view-toggle', role: 'tablist', 'aria-label': 'Review view mode' }, [
    el('button', {
      class: 'view-toggle-btn active', type: 'button', role: 'tab',
      'aria-selected': 'true', 'data-view-mode': 'structured',
    }, 'Structured'),
    el('button', {
      class: 'view-toggle-btn', type: 'button', role: 'tab',
      'aria-selected': 'false', 'data-view-mode': 'raw',
    }, 'Raw'),
  ]);
}

function applyViewMode(container: HTMLElement, mode: 'structured' | 'raw') {
  container.setAttribute('data-view', mode);
  container.querySelectorAll<HTMLButtonElement>('.view-toggle-btn').forEach((btn) => {
    const isActive = btn.dataset.viewMode === mode;
    btn.classList.toggle('active', isActive);
    btn.setAttribute('aria-selected', isActive ? 'true' : 'false');
  });
}

function attachModeToggle(container: HTMLElement) {
  applyViewMode(container, 'structured');
  container.querySelectorAll<HTMLButtonElement>('.view-toggle-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      const next = (btn.dataset.viewMode as 'structured' | 'raw') ?? 'structured';
      applyViewMode(container, next);
    });
  });
}

function attachCopyLink(container: HTMLElement) {
  const copyButton = container.querySelector<HTMLButtonElement>('[data-copy-link]');
  copyButton?.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(window.location.href);
      copyButton.textContent = 'Copied';
      setTimeout(() => { copyButton.textContent = 'Copy link'; }, 1200);
    } catch {
      copyButton.textContent = 'Copy failed';
      setTimeout(() => { copyButton.textContent = 'Copy link'; }, 1200);
    }
  });
}

/**
 * KaTeX is ~78 KB gzip + ~23 KB CSS and blocks the main thread while typesetting.
 * Lazy-load it after first paint so the user reads text immediately; formulas
 * "bloom" in a moment later. Unrendered `$...$` is visible for ~100–500ms — the
 * tradeoff is a dramatic TTI win, especially on slow connections.
 */
function scheduleTypeset(container: HTMLElement): void {
  const run = async () => {
    try {
      const { typeset } = await import('./latex');
      container.querySelectorAll<HTMLElement>('[data-typeset]').forEach((e) => typeset(e));
    } catch {
      // Fail-open: leaving raw LaTeX visible beats blocking the page on a
      // missing chunk (e.g. offline after first paint).
    }
  };
  const ric = (window as Window & {
    requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => number;
  }).requestIdleCallback;
  if (typeof ric === 'function') {
    ric(() => { void run(); }, { timeout: 1500 });
  } else {
    setTimeout(() => { void run(); }, 50);
  }
}

function buildPostReadNav(review: Review): HTMLElement {
  return el('nav', { class: 'post-read-nav', 'aria-label': 'Continue reading' }, [
    el('a', { class: 'post-read-link post-read-back', href: '/' }, '← Back to feed'),
    el('div', { class: 'post-read-center' }, [
      el('a', {
        class: 'post-read-link post-read-arxiv',
        href: safeHref(review.paper_url),
        target: '_blank',
        rel: 'noopener',
      }, 'Open on arXiv →'),
      el('button', {
        class: 'post-read-link post-read-copy',
        type: 'button',
        'data-copy-link': 'true',
      }, 'Copy link'),
    ]),
    el('a', { class: 'post-read-link post-read-browse', href: '/browse/' }, 'Browse all reviews →'),
  ]);
}

function renderPage(container: HTMLElement, review: Review) {
  const header = buildHeader(review);
  const banner = buildEthicsBanner(review);
  const scorecard = buildScorecard(review);
  const toggle = buildModeToggle();
  const judgment = buildJudgment(review);
  const questions = buildKeyQuestions(review);
  const abstract = buildAbstract(review);
  const limits = buildLimits(review);
  const raw = buildRaw(review);
  const postNav = buildPostReadNav(review);

  const stack = el('div', { class: 'review-content-stack', 'data-view': 'structured' }, [
    banner,
    scorecard,
    toggle,
    judgment,
    questions,
    abstract,
    limits,
    raw,
    postNav,
  ].filter((n): n is HTMLElement => n != null));

  mount(container, header, stack);
  attachModeToggle(stack);
  attachCopyLink(container);
  scheduleTypeset(container);
}

function errorState(title: string, detail: string): HTMLElement {
  return el('div', { class: 'state error' }, [
    el('strong', {}, title),
    el('span', {}, detail),
  ]);
}

export async function mainReviewPage() {
  const container = document.getElementById('review-detail');
  if (!container) return;

  // Prefer pre-baked data (SSG path via /review/{id}/)
  const prebaked = (window as unknown as { __OAR_REVIEW?: Review }).__OAR_REVIEW;
  if (prebaked) {
    // title/meta already set server-side; no need to overwrite document.title
    renderPage(container, prebaked);
    if (window.location.hash === '#questions') {
      setTimeout(() => {
        document.getElementById('questions')?.scrollIntoView({ behavior: 'smooth' });
      }, 120);
    }
    return;
  }

  // Legacy path: /review/?id=xxx still fetches client-side
  const id = new URLSearchParams(window.location.search).get('id');
  if (!id) {
    // /review/ with no ?id= is a dead-end. Legacy page still has to exist
    // (iron rule: R2-only reviews without a pre-baked SSG file rely on this
    // client-fetch path), but without an id there's nothing to fetch — send
    // the user to the home feed. replace() avoids a Back-button loop.
    window.location.replace('/');
    return;
  }

  let review: Review;
  try {
    review = await dataClient.getReview(id);
  } catch (e) {
    mount(container, errorState('Failed to load review', e instanceof Error ? e.message : String(e)));
    return;
  }

  document.title = `${review.title} \u2014 OpenAgent.review`;
  renderPage(container, review);

  if (window.location.hash === '#questions') {
    setTimeout(() => {
      document.getElementById('questions')?.scrollIntoView({ behavior: 'smooth' });
    }, 120);
  }
}
