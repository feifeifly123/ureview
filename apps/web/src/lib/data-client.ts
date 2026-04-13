import type { LatestIndex, Review, DailyIndex, ThreadData } from './types';

const DATA_BASE = import.meta.env.PUBLIC_DATA_BASE ?? '/data';

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
  getThread: async (paperId: string): Promise<ThreadData | null> => {
    const url = `${DATA_BASE}/responses/${paperId}.json`;
    const res = await fetch(url);
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`fetch ${url}: ${res.status}`);
    return res.json() as Promise<ThreadData>;
  },
};
