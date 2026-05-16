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
  /** Long-form AI evaluation of the paper's proof. Markdown + LaTeX. */
  ai_proof_review: string;
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
}
