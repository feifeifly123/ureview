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
