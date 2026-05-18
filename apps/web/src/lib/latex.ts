import renderMathInElement from 'katex/contrib/auto-render';
import 'katex/dist/katex.min.css';

// KaTeX renders inline math like $...$ and $$...$$ inside the given element.
// throwOnError=false keeps a malformed expression from nuking the whole page —
// the original text stays visible with the delimiters intact.
export function typeset(el: HTMLElement | null): void {
  if (!el) return;
  renderMathInElement(el, {
    delimiters: [
      { left: '$$', right: '$$', display: true },
      { left: '$', right: '$', display: false },
      { left: '\\(', right: '\\)', display: false },
      { left: '\\[', right: '\\]', display: true },
    ],
    throwOnError: false,
    errorColor: 'var(--color-danger, #B91C1C)',
  });
}

/**
 * Lazy-load KaTeX after first paint, then typeset every `[data-typeset]`
 * descendant of `container`. KaTeX is ~78 KB gzip + ~23 KB CSS and blocks the
 * main thread while typesetting; deferring lets the reader scan prose
 * immediately, formulas "bloom" in once idle.
 *
 * Fail-open: if the chunk fails to load (e.g. offline after first paint), the
 * raw LaTeX stays visible rather than blocking the page.
 */
export function scheduleTypeset(container: HTMLElement | null): void {
  if (!container) return;
  if (!container.querySelector('[data-typeset]')) return;
  const run = async () => {
    try {
      const targets = container.querySelectorAll<HTMLElement>('[data-typeset]');
      targets.forEach((e) => typeset(e));
    } catch {
      // see comment above
    }
  };
  const ric = (window as Window & {
    requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => number;
  }).requestIdleCallback;
  if (typeof ric === 'function') {
    ric(() => { void run(); }, { timeout: 1500 });
  } else {
    setTimeout(() => { void run(); }, 50);
  }
}
