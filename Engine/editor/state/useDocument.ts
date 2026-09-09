import { useCallback, useSyncExternalStore } from 'react';

/**
 * The bridge between the documents and React.
 *
 * The map and the rules are plain modules that are edited in place and know
 * nothing about any interface — which is exactly why they were kept rather than
 * rewritten. React cannot see an in-place edit, so each of them carries a
 * revision that changes when anything about it does, and this turns that into
 * a render.
 *
 * `useSyncExternalStore` rather than an effect and a piece of state: it is the
 * one subscription React will not tear during a concurrent render, so the
 * inspector and the object list cannot end up drawn from two different versions
 * of the same document.
 */

export type Revisioned = {
  revision: number;
  subscribe: (listener: () => void) => () => void;
};

const NEVER = () => () => {};

/**
 * Re-render whenever `doc` changes, and hand back the document itself.
 *
 * The document is returned rather than a copy of its contents: everything below
 * reads what it needs off it, and copying a map on every keystroke to satisfy
 * a comparison would cost more than the render it saves.
 */
export function useDocument<T extends Revisioned | null>(doc: T): T {
  useSyncExternalStore(
    useCallback((listener: () => void) => doc?.subscribe(listener) ?? NEVER(), [doc]),
    () => doc?.revision ?? -1,
    () => -1,
  );
  return doc;
}
