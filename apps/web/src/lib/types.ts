/** Five symmetric tiers used for both axes — neither LLMs nor humans can
 * calibrate finer than this, and a unified scale makes the UI legible. */
export type Tier = 'max' | 'high' | 'medium' | 'low' | 'minimal';

/** Full review record (data/reviews/{id}.json). */
export interface Review {
  id: string;
  date: string;
  title: string;
  paper_url: string;
  abstract: string;
  arxiv_categories: string[];
  authors: string[];
  published?: string | null;
  /** Long-form AI evaluation of the proof. Markdown + LaTeX. */
  ai_proof_review: string;
  /** If the proof is correct, how much does the result matter. */
  impact_if_true: Tier;
  /** Probability the proof actually goes through. */
  proof_correctness: Tier;
  updated_at: string;
}

export interface LatestIndex {
  generated_at: string;
  reviews: LatestReviewEntry[];
}

export interface LatestReviewEntry {
  id: string;
  date: string;
  title: string;
  authors: string[];
  arxiv_categories: string[];
  published?: string | null;
  updated_at?: string;
  /** First sentence(s) of ai_proof_review, plain text, truncated. */
  review_lede: string;
  impact_if_true: Tier;
  proof_correctness: Tier;
}

interface TierMeta {
  /** Numeric estimate used solely for E[impact] ranking. NOT a probability. */
  numeric: number;
  /** Short pill label shown in feed cards. */
  short: string;
  /** Fuller line shown in the detail-page scorecard. */
  long: string;
}

const IMPACT_META: Record<Tier, TierMeta> = {
  max:     { numeric: 9, short: 'max',     long: 'Field-defining — Fields-medal-class' },
  high:    { numeric: 7, short: 'high',    long: 'Major — changes the field' },
  medium:  { numeric: 5, short: 'medium',  long: 'Substantial — well-cited' },
  low:     { numeric: 3, short: 'low',     long: 'Incremental — refines known' },
  minimal: { numeric: 1, short: 'minimal', long: 'Niche — technical micro-step' },
};

const CORRECT_META: Record<Tier, TierMeta> = {
  max:     { numeric: 0.95, short: 'max',     long: 'Solid as a one-pass read can be' },
  high:    { numeric: 0.80, short: 'high',    long: 'Likely sound; minor nits' },
  medium:  { numeric: 0.55, short: 'medium',  long: 'Plausible with gaps' },
  low:     { numeric: 0.25, short: 'low',     long: 'Probably not yet' },
  minimal: { numeric: 0.05, short: 'minimal', long: 'Almost certainly not' },
};

export function impactMeta(tier: Tier): TierMeta {
  return IMPACT_META[tier] ?? IMPACT_META.minimal;
}
export function correctnessMeta(tier: Tier): TierMeta {
  return CORRECT_META[tier] ?? CORRECT_META.minimal;
}

/** Tier order desc, for sort tie-breaks and rendering. */
export const TIER_ORDER: Tier[] = ['max', 'high', 'medium', 'low', 'minimal'];

/** Derived score used for ranking — impact × correctness numeric proxy. */
export function expectedImpact(entry: { impact_if_true: Tier; proof_correctness: Tier }): number {
  return impactMeta(entry.impact_if_true).numeric * correctnessMeta(entry.proof_correctness).numeric;
}
