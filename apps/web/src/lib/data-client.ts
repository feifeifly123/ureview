import type { LatestIndex, Review } from './types';

// When served behind a path-prefix proxy like JupyterHub (/user/<u>/proxy/<port>/),
// a relative DATA_BASE like "/data" would resolve to the hub root, not the proxied
// app. Detect the prefix at runtime and prepend it. No-op in prod (DATA_BASE is
// an absolute https:// URL there) and during SSG (window undefined).
function proxyPrefix(): string {
  if (typeof window === 'undefined') return '';
  const m = window.location.pathname.match(/^(.*\/proxy\/\d+)(?:\/|$)/);
  return m ? m[1] : '';
}

const DATA_BASE_RAW = ((import.meta as ImportMeta & { env?: Record<string, string | undefined> }).env?.PUBLIC_DATA_BASE) ?? '/data';
const DATA_BASE = DATA_BASE_RAW.startsWith('/') ? proxyPrefix() + DATA_BASE_RAW : DATA_BASE_RAW;

async function fetchJSON<T>(path: string): Promise<T> {
  const url = `${DATA_BASE}${path}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`fetch ${url}: ${res.status}`);
  return res.json() as Promise<T>;
}

export const dataClient = {
  getLatest: () => fetchJSON<LatestIndex>('/latest.json'),
  getReview: (id: string) => fetchJSON<Review>(`/reviews/${id}.json`),
};
