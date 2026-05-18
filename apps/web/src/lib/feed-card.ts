import { el } from './dom';
import { authorsCompact } from './format';
import { expectedImpact, categoryName } from './types';
import type { LatestReviewEntry } from './types';

/**
 * Score badge — two halves:
 *   left  : "max × max" coloured by tier (the trade-off, at a glance)
 *   right : "E 8.55" (the ranking key)
 * No long labels — the tier names are self-evident in context, and the
 * detail page carries the full explainer ("Solid as a one-pass read", etc.).
 */
function buildScoreBadge(entry: LatestReviewEntry): HTMLElement {
  const e = expectedImpact(entry);
  return el('div', {
    class: 'score-badge',
    'aria-label': `Impact ${entry.impact_if_true}, correctness ${entry.proof_correctness}, expected impact ${e.toFixed(1)}`,
  }, [
    el('span', { class: 'score-pair' }, [
      el('span', { class: `score-tier score-tier--impact score-tier--${entry.impact_if_true}` }, entry.impact_if_true),
      el('span', { class: 'score-times' }, '×'),
      el('span', { class: `score-tier score-tier--correct score-tier--${entry.proof_correctness}` }, entry.proof_correctness),
    ]),
    el('span', { class: 'score-expected' }, [
      el('span', { class: 'score-expected-label' }, 'E'),
      el('span', { class: 'score-expected-value' }, e.toFixed(1)),
    ]),
  ]);
}

/**
 * Kicker — id + raw category code, both tight in mono uppercase.
 * Friendly names are reserved for browse chips and detail-page headers
 * where space is ample; here the raw code (e.g. "math.DG") fits the
 * letter-spaced uppercase rhythm without wrapping.
 * Date is intentionally omitted: feed is ranked by E[impact], so date
 * is a sub-signal that lives on the detail page header.
 */
function kickerLine(entry: LatestReviewEntry): HTMLElement {
  const parts: HTMLElement[] = [el('span', { class: 'id' }, entry.id)];
  const cats = entry.arxiv_categories ?? [];
  if (cats.length > 0) {
    parts.push(el('span', { class: 'sep' }, '·'));
    parts.push(el('span', { title: categoryName(cats[0]) }, cats[0]));
  }
  return el('div', { class: 'entry-kicker' }, parts);
}

/**
 * Builds an <a class="entry"> anchor — a typeset listing for a math review.
 */
export function buildFeedCard(entry: LatestReviewEntry): HTMLElement {
  const kids: HTMLElement[] = [
    kickerLine(entry),
    el('span', { class: 'entry-title' }, entry.title),
  ];

  const authors = authorsCompact(entry.authors);
  if (authors) {
    kids.push(el('span', { class: 'entry-authors' }, authors));
  }

  kids.push(buildScoreBadge(entry));

  if (entry.review_lede) {
    kids.push(el('p', { class: 'entry-lede', 'data-typeset': 'true' }, entry.review_lede));
  }

  return el(
    'a',
    {
      class: 'entry',
      href: `/review/${entry.id}/`,
      'data-review-id': entry.id,
    },
    kids,
  );
}
