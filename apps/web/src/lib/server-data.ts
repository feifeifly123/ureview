import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import type { LatestIndex, LatestReviewEntry, Review, ThreadData } from './types';

const DATA_DIR = fileURLToPath(new URL('../../../../data/', import.meta.url));

function readJson<T>(...segments: string[]): T {
  const path = join(DATA_DIR, ...segments);
  return JSON.parse(readFileSync(path, 'utf8')) as T;
}

function readOptionalJson<T>(...segments: string[]): T | null {
  try {
    return JSON.parse(readFileSync(join(DATA_DIR, ...segments), 'utf8')) as T;
  } catch (e: unknown) {
    if (e instanceof Error && 'code' in e && (e as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw e;
  }
}

export interface ReviewDigest extends LatestReviewEntry {
  paper_url?: string;
  hf_rank?: number;
  confidence?: number;
  updated_at?: string;
  last_activity_at?: string;
  response_count: number;
}

let latestCache: LatestIndex | null = null;
const digestCache = new Map<string, ReviewDigest>();

export function getLatestIndex(): LatestIndex {
  if (!latestCache) latestCache = readJson<LatestIndex>('latest.json');
  return latestCache;
}

export function getReview(id: string): Review {
  return readJson<Review>('reviews', `${id}.json`);
}

export function getThread(id: string): ThreadData | null {
  return readOptionalJson<ThreadData>('responses', `${id}.json`);
}

function maxIso(a?: string, b?: string): string | undefined {
  if (!a) return b;
  if (!b) return a;
  return Date.parse(a) >= Date.parse(b) ? a : b;
}

export function getReviewDigest(entry: LatestReviewEntry): ReviewDigest {
  const cached = digestCache.get(entry.id);
  if (cached) return cached;

  const review = getReview(entry.id);
  const thread = getThread(entry.id);
  const lastThreadAt = thread?.thread.reduce<string | undefined>((latest, item) => {
    return maxIso(latest, item.submitted_at);
  }, undefined);

  const digest: ReviewDigest = {
    ...entry,
    has_response: thread != null && thread.thread.length > 0,
    paper_url: review.paper_url,
    hf_rank: review.hf_rank,
    confidence: review.review.confidence,
    updated_at: review.updated_at,
    last_activity_at: maxIso(review.updated_at, lastThreadAt) ?? review.updated_at,
    response_count: thread?.thread.length ?? 0,
  };

  digestCache.set(entry.id, digest);
  return digest;
}

export function getLatestDigests(): ReviewDigest[] {
  return getLatestIndex().reviews.map((entry) => getReviewDigest(entry));
}

export function getRespondedDigests(limit = 4): ReviewDigest[] {
  return getLatestDigests()
    .filter((entry) => entry.has_response)
    .sort((a, b) => Date.parse(b.last_activity_at ?? b.date) - Date.parse(a.last_activity_at ?? a.date))
    .slice(0, limit);
}
