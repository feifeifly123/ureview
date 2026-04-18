export interface Review {
  id: string;
  slug: string;
  date: string;
  title: string;
  paper_url: string;
  hf_rank?: number;
  abstract: string;
  ai_review: string;
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
  abstract: string;
  hf_rank?: number;
  updated_at?: string;
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
}
