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

/** Return the URL only if it uses http(s); otherwise return '#'. */
export function safeHref(url: string): string {
  try {
    const p = new URL(url);
    if (p.protocol === 'https:' || p.protocol === 'http:') return url;
  } catch {}
  return '#';
}
