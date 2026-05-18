import { el, mount } from './dom';
import { authorsDetailed } from './format';
import { scheduleTypeset } from './latex';
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

function buildHeader(review: Review): HTMLElement {
  const kickerBits: HTMLElement[] = [];
  kickerBits.push(el('span', { class: 'id' }, review.id));
  (review.arxiv_categories ?? []).forEach((cat) => {
    kickerBits.push(el('span', { class: 'sep' }, '·'));
    kickerBits.push(el('span', {}, cat));
  });

  const kicker = el('div', { class: 'review-kicker' }, kickerBits);
  const title = el('h1', { class: 'review-title' }, review.title);

  const authors = authorsDetailed(review.authors);
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

// ---------- copy link ----------

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

export function mainReviewPage() {
  const container = document.getElementById('review-detail');
  if (!container) return;

  // Detail pages are SSG (/review/{id}/) — review JSON is pre-baked inline by
  // [...id].astro into window.__OAR_REVIEW. Legacy /review/?id= URLs redirect
  // to the SSG path client-side in review.astro, so we never have to fetch
  // here.
  const prebaked = (window as unknown as { __OAR_REVIEW?: Review }).__OAR_REVIEW;
  if (!prebaked) return;
  renderPage(container, prebaked);
}
