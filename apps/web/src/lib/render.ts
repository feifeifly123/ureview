// Client-side DOM builders used by the dynamic pages.
// Kept purely in TS so pages can `import { ... }` and compose.

import { el } from './dom';
import { formatDate, formatDateTime, formatScore, scoreToColor, relativeTime } from './utils';
import type { ReviewDetail, AuthorResponse, ThreadEntry } from './types';

type PaperLike = {
  id: string;
  title: string;
  summary: string;
  score: number;
  date?: string;
  hf_rank?: number;
  has_response?: boolean;
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
  if (r.has_response) {
    meta.push(el('span', { class: 'tag tag-response' }, 'Author reply'));
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

/** Status badge for paper cards on the homepage. */
export function statusBadge(hasResponse: boolean): HTMLElement {
  const text = hasResponse ? 'AUTHOR RESPONSE PUBLISHED' : 'AWAITING AUTHOR RESPONSE';
  const cls = hasResponse ? 'status-badge status-badge--green' : 'status-badge status-badge--amber';
  return el('span', { class: cls }, text);
}

/** Card component for the redesigned homepage. */
export function paperCard(r: PaperLike): HTMLElement {
  const linkText = r.has_response ? 'Read response \u2192' : 'View review \u2192';

  return el('div', { class: 'paper-card fade-in' }, [
    statusBadge(!!r.has_response),
    el('a', {
      class: 'card-title',
      href: `/review/?id=${encodeURIComponent(r.id)}`,
    }, r.title),
    el('div', { class: 'score-bar-row' }, [
      el('span', { class: 'score-bar-label' }, `AI Score: ${formatScore(r.score)} / 10`),
      el('div', { class: 'score-bar-track' }, [
        el('div', {
          class: 'score-bar-fill',
          style: `width: ${Math.max(0, Math.min(100, r.score * 10))}%; background: ${scoreToColor(r.score)}`,
        }),
      ]),
    ]),
    el('p', { class: 'card-summary' }, r.summary),
    el('div', { class: 'card-footer' }, [
      el('a', {
        class: 'card-link',
        href: `/review/?id=${encodeURIComponent(r.id)}`,
      }, linkText),
      r.date ? el('span', { class: 'card-time' }, relativeTime(r.date)) : null,
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

/** Vertical timeline connector between review and author response. */
export function responseTimeline(): HTMLElement {
  return el('div', { class: 'response-timeline' }, [
    el('span', { class: 'timeline-dot' }),
    el('span', { class: 'timeline-label' }, 'Author Response'),
  ]);
}

/** Author response card, visually parallels reviewBlock. */
export function responseBlock(resp: AuthorResponse): HTMLElement {
  const dateStr = resp.submitted_at.length >= 10
    ? formatDate(resp.submitted_at.slice(0, 10))
    : resp.submitted_at;

  return el('div', { class: 'response-block fade-in' }, [
    el('div', { class: 'response-block-header' }, [
      el('div', { class: 'reviewer-identity' }, [
        el('span', { class: 'reviewer-avatar reviewer-avatar--author' }, 'A'),
        el('div', { class: 'reviewer-text' }, [
          el('div', { class: 'reviewer-name' }, resp.author_name),
          el('div', { class: 'reviewer-sub' }, `Responded ${dateStr}`),
        ]),
      ]),
    ]),
    el('div', { class: 'response-block-body' }, [
      el(
        'div',
        { class: 'response-content' },
        resp.content.split('\n\n').map((para) => el('p', {}, para))
      ),
    ]),
  ]);
}

// ---------------------------------------------------------------------------
// OpenReview 1:1 replica — thread components
// ---------------------------------------------------------------------------

const BADGE_LABELS: Record<string, string> = {
  agent_review: 'Agent Review',
  rebuttal: 'Rebuttal',
  acknowledgement: 'Rebuttal Ack',
  reply_comment: 'Reply Rebuttal Comment',
};

const CONTENT_LABELS: Record<string, string> = {
  rebuttal: 'Rebuttal:',
  acknowledgement: 'Acknowledgement:',
  reply_comment: 'Comment:',
};

/** Build paragraph elements from content string. Prepend a colored label if applicable. */
export function buildParagraphs(content: string, type?: string): HTMLElement {
  const paragraphs = content.split('\n\n').map((para) => el('p', {}, para));
  const label = type && CONTENT_LABELS[type]
    ? el('span', { class: 'or-content-label' }, CONTENT_LABELS[type])
    : null;
  return el('div', { class: 'or-note-content' }, [label, ...paragraphs]);
}

/** Build the AI review body for the thread view. */
export function buildReviewBody(review: ReviewDetail): HTMLElement {
  const { score, confidence, strengths, weaknesses, final_comment } = review;

  return el('div', { class: 'or-note-content' }, [
    el('span', { class: 'or-content-label' }, 'Summary:'),
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
  ]);
}

/** OpenReview-style thread entry block. */
export function threadBlock(opts: {
  type: string;
  actor: 'agent' | 'authors';
  title: string;
  byLine: string;
  date: string;
  replyTo?: string;
  body: HTMLElement;
  searchText?: string;
}): HTMLElement {
  const dateStr = formatDateTime(opts.date);
  const badgeLabel = BADGE_LABELS[opts.type] ?? opts.type;
  const ts = Date.parse(opts.date);

  const replyEl = opts.replyTo
    ? el('div', { class: 'or-reply-to' }, [
        el('span', { class: 'or-reply-icon' }, '\u21B0'),
        `Replying to ${opts.replyTo}`,
      ])
    : null;

  return el(
    'section',
    {
      class: 'or-note-shell fade-in',
      'data-note-type': opts.type,
      'data-note-actor': opts.actor,
      'data-note-search': (opts.searchText ?? `${opts.title} ${opts.byLine}`).toLowerCase(),
      'data-note-ts': String(Number.isNaN(ts) ? 0 : ts),
    },
    [
      el('div', { class: 'or-note-rail', 'aria-hidden': 'true' }, [
        el('span', { class: 'or-rail-btn' }, '\u2212'),
        el('span', { class: 'or-rail-btn or-rail-btn--stack' }, '\u2630'),
      ]),
      el('div', { class: 'or-note-card' }, [
        replyEl,
        el('div', { class: 'or-note-head' }, [
          el('h4', { class: 'or-note-title' }, opts.title),
        ]),
        el('div', { class: 'or-note-meta' }, [
          el('span', { class: `or-badge or-badge--${opts.type}` }, badgeLabel),
          el('span', { class: 'or-meta-text' }, opts.byLine),
          el('span', { class: 'or-meta-sep' }, '\u00B7'),
          el('span', { class: 'or-meta-text' }, dateStr),
          el('span', { class: 'or-meta-sep' }, '\u00B7'),
          el('span', { class: 'or-meta-text' }, opts.actor === 'agent' ? 'AI Agent Reviewers, Authors' : 'Authors, AI Agent Reviewers'),
        ]),
        opts.body,
      ]),
    ]
  );
}

/** Full review-block panel (used by review.astro). */
export function reviewBlock(review: ReviewDetail): HTMLElement {
  const { score, confidence, strengths, weaknesses, final_comment } = review;

  return el('div', { class: 'review-block fade-in' }, [
    el('div', { class: 'review-block-header' }, [
      el('div', { class: 'reviewer-identity' }, [
        el('span', { class: 'reviewer-avatar' }, 'U'),
        el('div', { class: 'reviewer-text' }, [
          el('div', { class: 'reviewer-name' }, 'OpenAgent.review'),
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
