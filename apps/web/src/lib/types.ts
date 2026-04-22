export type VerdictLeaning = 'positive' | 'mixed' | 'critical';

export interface RatingDetail {
  score: 1 | 2 | 3 | 4;
  note: string;
}

export interface AIReviewRatings {
  soundness: RatingDetail;
  presentation: RatingDetail;
  significance: RatingDetail;
  originality: RatingDetail;
}

export interface KeyQuestion {
  question: string;
  tag?: string;
}

export interface AIReview {
  summary: string;
  strengths_weaknesses: string;
  ratings: AIReviewRatings;
  key_questions: KeyQuestion[];
  limitations: string;
  overall_recommendation: 1 | 2 | 3 | 4 | 5 | 6;
  ethics_flag: boolean;
  ethics_concerns?: string | null;
}

export interface ReviewHighlights {
  why_read: string;
  why_doubt: string;
  verdict_leaning: VerdictLeaning;
}

export interface Review {
  id: string;
  slug: string;
  date: string;
  title: string;
  paper_url: string;
  hf_rank?: number;
  arxiv_categories?: string[];
  abstract: string;
  ai_review: AIReview;
  review_highlights: ReviewHighlights;
  updated_at: string;
}

// Flat numeric ratings for feed-card rendering.
export interface FeedRatings {
  soundness?: number;
  presentation?: number;
  significance?: number;
  originality?: number;
}

export interface LatestIndex {
  generated_at: string;
  reviews: LatestReviewEntry[];
}

export interface LatestReviewEntry {
  id: string;
  date: string;
  title: string;
  abstract: string;
  hf_rank?: number;
  arxiv_categories?: string[];
  updated_at?: string;
  why_read?: string;
  why_doubt?: string;
  verdict_leaning?: VerdictLeaning;
  overall_recommendation?: number;
  ratings?: FeedRatings;
  key_questions_count?: number;
  ethics_flag?: boolean;
}

export interface DailyIndex {
  date: string;
  reviews: DailyReviewEntry[];
}

export interface DailyReviewEntry {
  id: string;
  title: string;
  abstract: string;
  hf_rank?: number;
  arxiv_categories?: string[];
  why_read?: string;
  why_doubt?: string;
  verdict_leaning?: VerdictLeaning;
  overall_recommendation?: number;
  ratings?: FeedRatings;
  key_questions_count?: number;
  ethics_flag?: boolean;
}
