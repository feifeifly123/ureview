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

export function confidenceBand(n: number | undefined): string {
  if (!n) return 'unknown';
  if (n >= 4) return 'high';
  if (n >= 3) return 'medium';
  return 'low';
}

function dateText(entry: FeedEntry): string {
  const anyEntry = entry as { date?: string; updated_at?: string };
  if (anyEntry.date) return formatDate(anyEntry.date);
  return '';
}

function ratingChip(label: string, value: number | undefined): HTMLElement | null {
  if (value == null) return null;
  return el('span', { class: 'rating-chip', title: `${label}: ${value}/4` }, [
    el('span', { class: 'rating-chip-label' }, label),
    el('span', { class: 'rating-chip-value' }, String(value)),
  ]);
}

function ratingsRow(ratings: FeedRatings | undefined): HTMLElement | null {
  if (!ratings) return null;
  const chips = [
    ratingChip('S', ratings.soundness),
    ratingChip('P', ratings.presentation),
    ratingChip('Sig', ratings.significance),
    ratingChip('Orig', ratings.originality),
  ].filter((n): n is HTMLElement => n != null);
  if (chips.length === 0) return null;
  return el('div', { class: 'rating-chip-row', 'aria-label': 'Dimension ratings' }, chips);
}

function topChips(entry: FeedEntry): HTMLElement {
  const chips: (HTMLElement | null)[] = [el('span', { class: 'topic-chip topic-chip--ai' }, 'AI review')];
  if (entry.hf_rank != null) {
    chips.push(el('span', { class: 'topic-chip topic-chip--ghost' }, `HF #${entry.hf_rank}`));
  }
  const cats = entry.arxiv_categories ?? [];
  if (cats.length > 0) {
    chips.push(el('span', { class: 'topic-chip topic-chip--ghost' }, cats[0]));
  }
  if (entry.ethics_flag) {
    chips.push(el('span', { class: 'topic-chip topic-chip--warning' }, '\u26A0 Ethics flag'));
  }
  return el('div', { class: 'home-card-chips' }, chips.filter((n): n is HTMLElement => n != null));
}

function whyRows(entry: FeedEntry): HTMLElement | null {
  const rows: HTMLElement[] = [];
  if (entry.why_read) {
    rows.push(
      el('div', { class: 'why-row why-row--read' }, [
        el('span', { class: 'why-row-label' }, 'Why read'),
        el('span', { class: 'why-row-text' }, entry.why_read),
      ])
    );
  }
  if (entry.why_doubt) {
    rows.push(
      el('div', { class: 'why-row why-row--doubt' }, [
        el('span', { class: 'why-row-label' }, 'Why doubt'),
        el('span', { class: 'why-row-text' }, entry.why_doubt),
      ])
    );
  }
  if (rows.length === 0) return null;
  return el('div', { class: 'why-row-stack' }, rows);
}

function footerRow(entry: FeedEntry): HTMLElement {
  const leaning = entry.verdict_leaning;
  const conf = entry.confidence;
  const kqc = entry.key_questions_count ?? 0;

  const left = el('div', { class: 'home-card-meta-row' }, [
    leaning
      ? el(
          'span',
          { class: `leaning-pill leaning-pill--${leaning}` },
          leaningLabel(leaning)
        )
      : null,
    conf
      ? el('span', { class: 'home-card-meta-dot' }, [
          el('span', { class: 'home-card-meta-sep' }, '\u00b7'),
          `Confidence ${confidenceBand(conf)}`,
        ])
      : null,
    kqc > 0
      ? el('span', { class: 'home-card-meta-dot' }, [
          el('span', { class: 'home-card-meta-sep' }, '\u00b7'),
          `${kqc} question${kqc === 1 ? '' : 's'}`,
        ])
      : null,
  ].filter((n): n is HTMLElement => n != null));

  const right = el(
    'a',
    { class: 'home-card-open', href: `/review/?id=${encodeURIComponent(entry.id)}` },
    'Open review \u2192'
  );

  return el('div', { class: 'home-card-footer' }, [left, right]);
}

export function buildFeedCard(entry: FeedEntry): HTMLElement {
  const kids: (HTMLElement | null)[] = [
    el('div', { class: 'home-card-top' }, [
      topChips(entry),
      dateText(entry)
        ? el('span', { class: 'home-card-updated' }, dateText(entry))
        : null,
    ].filter((n): n is HTMLElement => n != null)),
    el(
      'a',
      { class: 'home-card-title', href: `/review/?id=${encodeURIComponent(entry.id)}` },
      entry.title
    ),
    whyRows(entry),
    ratingsRow(entry.ratings),
    footerRow(entry),
  ];

  return el(
    'article',
    {
      class: 'home-card',
      'data-home-card': 'true',
      'data-review-id': entry.id,
    },
    kids.filter((n): n is HTMLElement => n != null)
  );
}
