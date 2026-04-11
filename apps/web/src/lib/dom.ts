// Minimal DOM builder helper. Replaces template-string HTML with safe,
// composable element construction. Text children are always set via
// textContent, so they are inherently XSS-safe.

type Attrs = Record<string, string | number | null | undefined | false>;
type Child = Node | string | null | undefined | false;

export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Attrs = {},
  children: Child[] | Child = []
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k === 'class') node.className = String(v);
    else node.setAttribute(k, String(v));
  }
  const list = Array.isArray(children) ? children : [children];
  for (const c of list) {
    if (c == null || c === false) continue;
    node.append(typeof c === 'string' ? document.createTextNode(c) : c);
  }
  return node;
}

/** Replace all children of `parent` with the given nodes. */
export function mount(parent: Element, ...nodes: Child[]): void {
  parent.replaceChildren(
    ...nodes
      .filter((n): n is Node | string => n != null && n !== false)
      .map((n) => (typeof n === 'string' ? document.createTextNode(n) : n))
  );
}
