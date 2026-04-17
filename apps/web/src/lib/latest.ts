import type { LatestReviewEntry } from './types';

export const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

/** Pick the most meaningful timestamp for ranking / "updated N ago" labels. */
export function latestLastActivity(review: LatestReviewEntry): string {
  return review.last_activity_at ?? review.updated_at ?? `${review.date}T00:00:00Z`;
}

/** "Updated 3 days ago" / "Updated 5h ago" / "Updated recently". */
export function activityLabel(generatedAt: string, iso?: string): string {
  const target = iso ?? generatedAt;
  const diff = Math.max(0, Date.parse(generatedAt) - Date.parse(target));
  const hours = Math.floor(diff / (60 * 60 * 1000));
  if (hours < 1) return 'Updated recently';
  if (hours < 24) return `Updated ${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days === 1) return 'Updated 1 day ago';
  return `Updated ${days} days ago`;
}

export function isRecentlyUpdated(review: LatestReviewEntry, generatedAt: string): boolean {
  return Date.parse(generatedAt) - Date.parse(latestLastActivity(review)) <= WEEK_MS;
}

export interface LatestCounts {
  totalCount: number;
  awaitingCount: number;
  respondedCount: number;
  updatedThisWeek: number;
}

export function latestCounts(reviews: LatestReviewEntry[], generatedAt: string): LatestCounts {
  const totalCount = reviews.length;
  const awaitingCount = reviews.filter((review) => !review.has_response).length;
  const respondedCount = totalCount - awaitingCount;
  const updatedThisWeek = reviews.filter((review) => isRecentlyUpdated(review, generatedAt)).length;
  return { totalCount, awaitingCount, respondedCount, updatedThisWeek };
}
