// Small pure utilities shared by client scripts.

/** "2026-04-09" → "April 9, 2026" */
export function formatDate(iso: string): string {
  const d = new Date(iso + 'T00:00:00');
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
}

/** "2026-04-11T09:00:00Z" → "11 Apr 2026, 09:00" */
export function formatDateTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString('en-GB', {
    year: 'numeric',
    month: 'short',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
}

export function formatScore(n: number): string {
  return n.toFixed(1);
}

/** Map a 0–10 score onto a restrained blue scale to avoid red/green verdict framing. */
export function scoreToColor(s: number): string {
  if (s >= 8) return '#1D4ED8';
  if (s >= 6) return '#3158D3';
  if (s >= 4) return '#5B7BE3';
  return '#94A3B8';
}

/** Shift a YYYY-MM-DD string by `days` (±). Returns YYYY-MM-DD. */
export function shiftDate(iso: string, days: number): string {
  const d = new Date(iso + 'T00:00:00');
  if (Number.isNaN(d.getTime())) return iso;
  d.setDate(d.getDate() + days);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/** "2026-04-09" → "Posted 3 days ago" */
export function relativeTime(iso: string): string {
  const then = new Date(iso + 'T00:00:00');
  if (Number.isNaN(then.getTime())) return iso;
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  const days = Math.floor((now.getTime() - then.getTime()) / 86_400_000);
  if (days <= 0) return 'Posted today';
  if (days === 1) return 'Posted yesterday';
  if (days < 7) return `Posted ${days} days ago`;
  if (days < 30) return `Posted ${Math.floor(days / 7)} weeks ago`;
  return `Posted ${Math.floor(days / 30)} months ago`;
}
