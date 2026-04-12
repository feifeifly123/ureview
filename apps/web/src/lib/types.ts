export interface Review {
  id: string;
  slug: string;
  date: string;
  title: string;
  paper_url: string;
  hf_rank?: number;
  summary: string;
  review: ReviewDetail;
  updated_at: string;
}

export interface ReviewDetail {
  score: number;
  confidence: number;
  strengths: string[];
  weaknesses: string[];
  final_comment: string;
}

export interface LatestIndex {
  generated_at: string;
  reviews: LatestReviewEntry[];
}

export interface LatestReviewEntry {
  id: string;
  date: string;
  title: string;
  summary: string;
  score: number;
  has_response?: boolean;
}

export interface DailyIndex {
  date: string;
  reviews: DailyReviewEntry[];
}

export interface DailyReviewEntry {
  id: string;
  title: string;
  summary: string;
  score: number;
  hf_rank?: number;
  has_response?: boolean;
}

export interface AuthorResponse {
  paper_id: string;
  author_name: string;
  content: string;
  submitted_at: string;
}
