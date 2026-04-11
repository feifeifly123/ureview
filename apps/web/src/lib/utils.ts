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

export function formatScore(n: number): string {
  return n.toFixed(1);
}

/** Map a 0–10 score onto the gradient orange-red → amber → deep green. */
export function scoreToColor(s: number): string {
  if (s >= 7) return '#2E7D32';
  if (s >= 5) return '#D4A017';
  return '#C44';
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
