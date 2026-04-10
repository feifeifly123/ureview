import type { LatestIndex, Review, DailyIndex } from './types';

const DATA_BASE = '/data';

async function fetchJSON<T>(path: string): Promise<T> {
  const url = `${DATA_BASE}${path}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`fetch ${url}: ${res.status}`);
  return res.json() as Promise<T>;
}

export const dataClient = {
  getLatest: () => fetchJSON<LatestIndex>('/latest.json'),
  getReview: (id: string) => fetchJSON<Review>(`/reviews/${id}.json`),
  getDaily: (date: string) => fetchJSON<DailyIndex>(`/daily/${date}.json`),
};
