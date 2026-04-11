// Client-side DOM builders used by the dynamic pages.
// Kept purely in TS so pages can `import { ... }` and compose.

import { el } from './dom';
import { formatDate, formatScore, scoreToColor } from './utils';
import type { ReviewDetail } from './types';

type PaperLike = {
  id: string;
  title: string;
  summary: string;
  score: number;
  date?: string;
  hf_rank?: number;
};

/** Score badge: big number + 10 cells. `size` controls visual weight. */
export function scoreBadge(score: number, size: 'sm' | 'lg' = 'sm'): HTMLElement {
  const filled = Math.round(Math.max(0, Math.min(10, score)));

  const cells: HTMLElement[] = [];
  for (let i = 0; i < 10; i++) {
    cells.push(el('span', { class: i < filled ? 'cell on' : 'cell' }));
  }

  return el(
    'span',
    {
      class: size === 'lg' ? 'score-badge score-badge--lg' : 'score-badge',
      style: `--score-color: ${scoreToColor(score)}`,
      title: `Score ${formatScore(score)} / 10`,
    },
    [
      el('span', { class: 'score-cells' }, cells),
      el('span', { class: 'score-num' }, [
        formatScore(score),
        el('span', { class: 'score-denom' }, '/10'),
      ]),
    ]
  );
}

/** Filled dots out of `max`. e.g. ●●●○○ for value=3, max=5. */
export function dotScale(value: number, max: number, label?: string): HTMLElement {
  const dots: HTMLElement[] = [];
  for (let i = 0; i < max; i++) {
    dots.push(el('span', { class: i < value ? 'dot on' : 'dot' }));
  }
  return el('span', { class: 'dot-scale' }, [
    ...dots,
    label ? el('span', { class: 'label' }, label) : null,
  ]);
}

/** One item in the paper list (index + day share this). */
export function paperItem(
  r: PaperLike,
  index: number,
  opts: { showDate?: boolean } = {}
): HTMLElement {
  const meta: Array<Node | null> = [];
  if (r.hf_rank != null) {
    meta.push(el('span', { class: 'tag tag-rank' }, `HF #${r.hf_rank}`));
  }
  if (opts.showDate && r.date) {
    meta.push(el('span', { class: 'tag-date' }, formatDate(r.date)));
  }
  meta.push(scoreBadge(r.score));

  const metaWithSeps: Array<Node | null> = [];
  meta.forEach((child, i) => {
    if (i > 0) metaWithSeps.push(el('span', { class: 'sep' }, '·'));
    metaWithSeps.push(child);
  });

  return el('li', { class: 'paper-item fade-in' }, [
    el('div', { class: 'paper-row' }, [
      el('span', { class: 'paper-number' }, String(index + 1).padStart(2, '0')),
      el('div', { class: 'paper-body' }, [
        el(
          'a',
          {
            class: 'paper-title',
            href: `/review/?id=${encodeURIComponent(r.id)}`,
          },
          r.title
        ),
        el('div', { class: 'paper-meta' }, metaWithSeps),
        el('div', { class: 'paper-summary' }, r.summary),
      ]),
    ]),
  ]);
}

/** Unified state block (loading / error / empty). */
export function stateView(
  variant: 'loading' | 'error' | 'empty',
  title: string,
  message?: string
): HTMLElement {
  return el('div', { class: `state ${variant}` }, [
    el('strong', {}, title),
    message ? el('span', {}, message) : null,
  ]);
}

/** Full review-block panel (used by review.astro). */
export function reviewBlock(review: ReviewDetail): HTMLElement {
  const { score, confidence, strengths, weaknesses, final_comment } = review;

  return el('div', { class: 'review-block fade-in' }, [
    el('div', { class: 'review-block-header' }, [
      el('div', { class: 'reviewer-identity' }, [
        el('span', { class: 'reviewer-avatar' }, 'U'),
        el('div', { class: 'reviewer-text' }, [
          el('div', { class: 'reviewer-name' }, 'ureview.ai'),
          el('div', { class: 'reviewer-sub' }, 'AI-generated review'),
        ]),
      ]),
    ]),
    el('div', { class: 'review-block-body' }, [
      el('div', { class: 'review-field' }, [
        el('div', { class: 'review-field-label' }, 'Rating'),
        el('div', { class: 'rating-row' }, [
          el('div', { class: 'rating-col' }, [
            el('div', { class: 'rating-col-label' }, 'Score'),
            scoreBadge(score, 'lg'),
          ]),
          el('div', { class: 'rating-col' }, [
            el('div', { class: 'rating-col-label' }, 'Confidence'),
            dotScale(confidence, 5, `${confidence}/5`),
          ]),
        ]),
      ]),
      el('div', { class: 'review-field' }, [
        el('div', { class: 'review-field-label' }, 'Strengths'),
        el(
          'ul',
          { class: 'review-field-value' },
          strengths.map((s) => el('li', {}, s))
        ),
      ]),
      el('div', { class: 'review-field' }, [
        el('div', { class: 'review-field-label' }, 'Weaknesses'),
        el(
          'ul',
          { class: 'review-field-value' },
          weaknesses.map((s) => el('li', {}, s))
        ),
      ]),
      el('div', { class: 'review-field' }, [
        el('div', { class: 'review-field-label' }, 'Overall Assessment'),
        el('div', { class: 'review-field-value' }, final_comment),
      ]),
    ]),
  ]);
}
