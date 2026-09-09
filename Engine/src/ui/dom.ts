/**
 * Find a part of markup this module just wrote.
 *
 * Each panel builds its shell with one `innerHTML` and then reaches back into
 * it for the pieces it will keep writing to. `querySelector` answers null for
 * a selector that matches nothing, which here can only mean the markup a few
 * lines above and the selector below have drifted apart -- a mistake in this
 * file, not a state to handle. Saying so once turns that into a named failure
 * rather than a `null is not an object` somewhere later.
 */
export function part<T extends Element = HTMLElement>(root: ParentNode, selector: string): T {
  const found = root.querySelector<T>(selector);
  if (!found) throw new Error(`the panel has no ${selector}`);
  return found;
}

/** Write text into an element only when it would change. */
export function setText(element: Element | null | undefined, text: string): void {
  if (element && element.textContent !== text) element.textContent = text;
}
