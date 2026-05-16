import { el } from './dom';
import { formatDate } from './utils';
import type { LatestReviewEntry } from './types';

function authorsLine(authors: string[]): string {
  if (!authors || authors.length === 0) return '';
  if (authors.length === 1) return authors[0];
  if (authors.length === 2) return `${authors[0]} & ${authors[1]}`;
  if (authors.length === 3) return authors.join(', ');
  return `${authors[0]}, ${authors[1]}, ${authors[2]} et al.`;
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

  const authors = authorsLine(entry.authors ?? []);
  if (authors) {
    kids.push(el('span', { class: 'entry-authors' }, authors));
  }

  if (entry.review_lede) {
    kids.push(el('p', { class: 'entry-lede', 'data-typeset': 'true' }, entry.review_lede));
  }

  kids.push(el('span', { class: 'entry-open' }, 'Read review →'));

  return el(
    'a',
    {
      class: 'entry',
      href: `/review/?id=${encodeURIComponent(entry.id)}`,
      'data-review-id': entry.id,
    },
    kids,
  );
}
