// Formatting helpers shared across feed cards and detail pages.

/**
 * Compact authors line for feed cards (tight horizontal space).
 *  1   → "A"
 *  2   → "A & B"
 *  3   → "A, B, C"
 *  4+  → "A, B, C et al."
 */
export function authorsCompact(authors: string[] | undefined | null): string {
  if (!authors || authors.length === 0) return '';
  if (authors.length === 1) return authors[0];
  if (authors.length === 2) return `${authors[0]} & ${authors[1]}`;
  if (authors.length === 3) return authors.join(', ');
  return `${authors[0]}, ${authors[1]}, ${authors[2]} et al.`;
}

/**
 * Detailed authors line for headers (more room).
 *  1-3 → "A, B, C"
 *  4+  → "A, B, C, et al. (N more)"
 */
export function authorsDetailed(authors: string[] | undefined | null): string {
  if (!authors || authors.length === 0) return '';
  if (authors.length <= 3) return authors.join(', ');
  return `${authors.slice(0, 3).join(', ')}, et al. (${authors.length - 3} more)`;
}
