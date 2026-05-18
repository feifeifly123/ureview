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

/** Official arxiv math subject classifications (per arxiv.org/archive/math).
 * Keep this aligned with the schema's `math\\.` regex and the rejection of
 * non-math papers at ingest. */
export const ARXIV_MATH_CATEGORIES: Record<string, string> = {
  'math.AC': 'Commutative Algebra',
  'math.AG': 'Algebraic Geometry',
  'math.AP': 'Analysis of PDEs',
  'math.AT': 'Algebraic Topology',
  'math.CA': 'Classical Analysis and ODEs',
  'math.CO': 'Combinatorics',
  'math.CT': 'Category Theory',
  'math.CV': 'Complex Variables',
  'math.DG': 'Differential Geometry',
  'math.DS': 'Dynamical Systems',
  'math.FA': 'Functional Analysis',
  'math.GM': 'General Mathematics',
  'math.GN': 'General Topology',
  'math.GR': 'Group Theory',
  'math.GT': 'Geometric Topology',
  'math.HO': 'History and Overview',
  'math.IT': 'Information Theory',
  'math.KT': 'K-Theory and Homology',
  'math.LO': 'Logic',
  'math.MG': 'Metric Geometry',
  'math.MP': 'Mathematical Physics',
  'math.NA': 'Numerical Analysis',
  'math.NT': 'Number Theory',
  'math.OA': 'Operator Algebras',
  'math.OC': 'Optimization and Control',
  'math.PR': 'Probability',
  'math.QA': 'Quantum Algebra',
  'math.RA': 'Rings and Algebras',
  'math.RT': 'Representation Theory',
  'math.SG': 'Symplectic Geometry',
  'math.SP': 'Spectral Theory',
  'math.ST': 'Statistics Theory',
};

export function categoryName(code: string): string {
  return ARXIV_MATH_CATEGORIES[code] ?? code;
}

/** Derived score used for ranking — impact × correctness numeric proxy. */
export function expectedImpact(entry: { impact_if_true: Tier; proof_correctness: Tier }): number {
  return impactMeta(entry.impact_if_true).numeric * correctnessMeta(entry.proof_correctness).numeric;
}
