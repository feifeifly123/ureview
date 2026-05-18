import { el } from './dom';
import { authorsCompact } from './format';
import { formatDate } from './utils';
import { expectedImpact } from './types';
import type { LatestReviewEntry } from './types';

/**
 * Score badge — the headline pair every card carries.
 *   Impact: high  ·  Correctness: max  ·  E 6.65
 * Both axes are 5-tier enums (max / high / medium / low / minimal).
 * E[impact] is the numeric proxy used for ranking.
 */
function buildScoreBadge(entry: LatestReviewEntry): HTMLElement {
  const e = expectedImpact(entry);
  return el('div', {
    class: 'score-badge',
    'aria-label': `Impact ${entry.impact_if_true}, correctness ${entry.proof_correctness}, expected impact ${e.toFixed(1)}`,
  }, [
    el('span', { class: `score-cell score-cell--impact score-cell--tier-${entry.impact_if_true}` }, [
      el('span', { class: 'score-label' }, 'Impact'),
      el('span', { class: 'score-value' }, entry.impact_if_true),
    ]),
    el('span', { class: `score-cell score-cell--correct score-cell--tier-${entry.proof_correctness}` }, [
      el('span', { class: 'score-label' }, 'Correct'),
      el('span', { class: 'score-value' }, entry.proof_correctness),
    ]),
    el('span', { class: 'score-cell score-cell--expected' }, [
      el('span', { class: 'score-label' }, 'E[impact]'),
      el('span', { class: 'score-value score-value--strong' }, e.toFixed(1)),
    ]),
  ]);
}

function kickerLine(entry: LatestReviewEntry): HTMLElement {
  const parts: HTMLElement[] = [];
  parts.push(el('span', { class: 'id' }, entry.id));
  const cats = entry.arxiv_categories ?? [];
  if (cats.length > 0) {
    parts.push(el('span', { class: 'sep' }, '·'));
    parts.push(el('span', {}, cats[0]));
  }
  parts.push(el('span', { class: 'sep' }, '·'));
  parts.push(el('span', { class: 'entry-date' }, formatDate(entry.date)));
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

  kids.push(el('span', { class: 'entry-open' }, 'Read review →'));

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
