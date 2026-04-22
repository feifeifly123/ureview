import { el } from './dom';
import { formatDate } from './utils';
import type {
  LatestReviewEntry,
  DailyReviewEntry,
  VerdictLeaning,
  FeedRatings,
} from './types';

type FeedEntry = LatestReviewEntry | DailyReviewEntry;

export function leaningLabel(leaning: VerdictLeaning | undefined): string {
  if (leaning === 'positive') return 'Positive leaning';
  if (leaning === 'critical') return 'Critical leaning';
  return 'Mixed leaning';
}

function dateText(entry: FeedEntry): string {
  const anyEntry = entry as { date?: string; updated_at?: string };
  if (anyEntry.date) return formatDate(anyEntry.date);
  return '';
}

function arxivFromUrl(url: string | undefined): string | null {
  if (!url) return null;
  const m = url.match(/arxiv\.org\/abs\/([^/?#]+)/i);
  return m ? m[1].replace(/v\d+$/, '') : null;
}

function arxivFromId(id: string): string | null {
  // id shape: YYYY-MM-DD-slug — doesn't contain the arxiv id itself.
  return null;
}

function kickerLine(entry: FeedEntry): HTMLElement {
  const parts: HTMLElement[] = [];
  const arxiv = arxivFromUrl((entry as any).paper_url) ?? arxivFromId(entry.id);
  if (arxiv) {
    parts.push(el('span', { class: 'id' }, arxiv));
  }
  if (entry.hf_rank != null) {
    if (parts.length) parts.push(el('span', { class: 'sep' }, '·'));
    parts.push(el('span', { class: 'rank' }, `HF №${String(entry.hf_rank).padStart(2, '0')}`));
  }
  const cats = entry.arxiv_categories ?? [];
  if (cats.length > 0) {
    if (parts.length) parts.push(el('span', { class: 'sep' }, '·'));
    parts.push(el('span', {}, cats[0]));
  }
  if (entry.ethics_flag) {
    if (parts.length) parts.push(el('span', { class: 'sep' }, '·'));
    parts.push(el('span', { class: 'ethics' }, '⚠ Ethics'));
  }
  return el('div', { class: 'entry-kicker' }, parts);
}

function whyBlock(entry: FeedEntry): HTMLElement | null {
  const rows: HTMLElement[] = [];
  if (entry.why_read) {
    rows.push(el('div', { class: 'entry-why-row entry-why--read' }, [
      el('span', { class: 'entry-why-label' }, 'Why read'),
      el('span', { class: 'entry-why-text' }, entry.why_read),
    ]));
  }
  if (entry.why_doubt) {
    rows.push(el('div', { class: 'entry-why-row entry-why--doubt' }, [
      el('span', { class: 'entry-why-label' }, 'Why doubt'),
      el('span', { class: 'entry-why-text' }, entry.why_doubt),
    ]));
  }
  if (rows.length === 0) return null;
  return el('div', { class: 'entry-why' }, rows);
}

function ratingsInline(ratings: FeedRatings | undefined): HTMLElement | null {
  if (!ratings) return null;
  const pieces: Array<[string, number | undefined]> = [
    ['Snd', ratings.soundness],
    ['Prs', ratings.presentation],
    ['Sig', ratings.significance],
    ['Org', ratings.originality],
  ];
  const kids = pieces
    .filter((p): p is [string, number] => p[1] != null)
    .map(([label, value]) =>
      el('span', { class: 'entry-rating' }, [
        el('span', { class: 'entry-rating-label' }, label),
        el('span', { class: 'entry-rating-value' }, String(value)),
      ])
    );
  if (kids.length === 0) return null;
  return el('div', { class: 'entry-ratings', 'aria-label': 'Dimension ratings' }, kids);
}

function footerLine(entry: FeedEntry): HTMLElement {
  const leaning = entry.verdict_leaning;

  const bits: HTMLElement[] = [];
  if (leaning) {
    bits.push(el('span', { class: `entry-leaning entry-leaning--${leaning}` }, leaning));
  }
  const ratings = ratingsInline(entry.ratings);
  if (ratings) bits.push(ratings);

  const open = el('span', { class: 'entry-open' }, 'Read →');

  return el('div', { class: 'entry-footer' }, [
    el('div', { class: 'entry-footer-bits' }, bits),
    open,
  ]);
}

/**
 * Builds an <a class="entry"> anchor — a typeset listing (not a card).
 * Preserves the old export name so callers don't need to change imports.
 */
export function buildFeedCard(entry: FeedEntry): HTMLElement {
  const leaning = entry.verdict_leaning;
  const classes = ['entry'];
  if (leaning) classes.push(`entry--${leaning}`);

  const kids: (HTMLElement | null)[] = [
    kickerLine(entry),
    el('span', { class: 'entry-date' }, dateText(entry)),
    el('span', { class: 'entry-title' }, entry.title),
    whyBlock(entry),
    footerLine(entry),
  ];

  return el(
    'a',
    {
      class: classes.join(' '),
      href: `/review/?id=${encodeURIComponent(entry.id)}`,
      'data-review-id': entry.id,
    },
    kids.filter((n): n is HTMLElement => n != null)
  );
}
