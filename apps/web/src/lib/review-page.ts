import { dataClient } from './data-client';
import { el, mount } from './dom';
import { formatDate, safeHref } from './utils';
import type { Review } from './types';

// ---------- markdown-ish rendering ----------

/**
 * Render a block of prose into DOM nodes. Splits on blank lines; lines that
 * start with "## " / "### " become h3 / h4. Inline emphasis is not parsed —
 * raw markdown stars stay visible. LaTeX delimiters are preserved for the
 * lazy KaTeX pass to typeset.
 */
function renderProseBlocks(text: string): HTMLElement[] {
  const out: HTMLElement[] = [];
  for (const raw of text.split(/\n\s*\n/)) {
    const block = raw.trim();
    if (!block) continue;
    const headerMatch = block.match(/^(#{2,4})\s+(.+)$/);
    if (headerMatch) {
      const level = headerMatch[1].length;
      const tag = level === 2 ? 'h3' : level === 3 ? 'h4' : 'h5';
      out.push(el(tag, { class: 'review-prose-heading', 'data-typeset': 'true' }, headerMatch[2]));
      continue;
    }
    out.push(el('p', { 'data-typeset': 'true' }, block));
  }
  return out;
}

// ---------- header ----------

function authorsLine(authors: string[]): string {
  if (!authors || authors.length === 0) return '';
  if (authors.length <= 3) return authors.join(', ');
  return `${authors.slice(0, 3).join(', ')}, et al. (${authors.length - 3} more)`;
}

function buildHeader(review: Review): HTMLElement {
  const kickerBits: HTMLElement[] = [];
  kickerBits.push(el('span', { class: 'id' }, review.id));
  (review.arxiv_categories ?? []).forEach((cat) => {
    kickerBits.push(el('span', { class: 'sep' }, '·'));
    kickerBits.push(el('span', {}, cat));
  });

  const kicker = el('div', { class: 'review-kicker' }, kickerBits);
  const title = el('h1', { class: 'review-title' }, review.title);

  const authors = authorsLine(review.authors ?? []);
  const authorsEl = authors ? el('p', { class: 'review-authors' }, authors) : null;

  const datelineBits: (HTMLElement | string)[] = [];
  datelineBits.push(el('span', {}, `Filed ${formatDate(review.date)}`));
  datelineBits.push(el('span', { class: 'review-dateline-sep' }, '·'));
  datelineBits.push(el('a', {
    class: 'review-action',
    href: safeHref(review.paper_url),
    target: '_blank',
    rel: 'noopener',
  }, 'Open on arXiv →'));
  datelineBits.push(el('button', {
    class: 'review-action',
    type: 'button',
    'data-copy-link': 'true',
  }, 'Copy link'));

  const dateline = el('div', { class: 'review-dateline' }, datelineBits);

  return el(
    'header',
    { class: 'review-head' },
    [kicker, title, authorsEl, dateline].filter((n): n is HTMLElement => n != null),
  );
}

// ---------- abstract ----------

function buildAbstract(review: Review): HTMLElement {
  return el('section', { class: 'review-section review-section--abstract', id: 'abstract' }, [
    el('h2', { class: 'review-section-title' }, 'Abstract'),
    el(
      'blockquote',
      { class: 'review-prose review-prose--abstract', 'data-typeset': 'true' },
      review.abstract,
    ),
  ]);
}

// ---------- AI proof review (the main event) ----------

function buildProofReview(review: Review): HTMLElement {
  return el('section', { class: 'review-section review-section--proof', id: 'proof-review' }, [
    el('h2', { class: 'review-section-title' }, 'AI proof review'),
    el(
      'div',
      { class: 'review-prose review-prose--proof' },
      renderProseBlocks(review.ai_proof_review || ''),
    ),
  ]);
}

// ---------- post-read nav ----------

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

// ---------- copy link + KaTeX scheduling ----------

function attachCopyLink(container: HTMLElement) {
  container.querySelectorAll<HTMLButtonElement>('[data-copy-link]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(window.location.href);
        const original = btn.textContent;
        btn.textContent = 'Copied';
        setTimeout(() => { btn.textContent = original; }, 1200);
      } catch {
        const original = btn.textContent;
        btn.textContent = 'Copy failed';
        setTimeout(() => { btn.textContent = original; }, 1200);
      }
    });
  });
}

/**
 * KaTeX is ~78 KB gzip + ~23 KB CSS and blocks the main thread while typesetting.
 * Lazy-load it after first paint so the reader can scan the prose immediately;
 * formulas "bloom" in once idle.
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

// ---------- orchestration ----------

function renderPage(container: HTMLElement, review: Review) {
  const header = buildHeader(review);
  const abstract = buildAbstract(review);
  const proof = buildProofReview(review);
  const postNav = buildPostReadNav(review);

  const stack = el('div', { class: 'review-content-stack' }, [abstract, proof, postNav]);

  mount(container, header, stack);
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
    renderPage(container, prebaked);
    return;
  }

  // Legacy path: /review/?id=xxx fetches client-side
  const id = new URLSearchParams(window.location.search).get('id');
  if (!id) {
    // /review/ with no ?id= is a dead-end. Send the user to the home feed.
    // replace() avoids a Back-button loop.
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

  document.title = `${review.title} \u2014 Ureview`;
  renderPage(container, review);
}
