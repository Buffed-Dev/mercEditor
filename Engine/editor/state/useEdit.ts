import { useRef } from 'react';

type Editable = {
  checkpoint: (checkpointed?: boolean) => void;
};

import type { MapEditor } from '../editor.ts';

/**
 * The parts of the view an edit can say it touched.
 *
 * Read off the editor rather than written out again, so a domain added there
 * cannot quietly fail to be sayable from here.
 */
type Domain = Parameters<MapEditor['invalidate']>[number];

type Invalidatable = {
  invalidate: (...what: Domain[]) => void;
} | null;

/**
 * One gesture, one undo step.
 *
 * A drag across a slider is forty writes and one decision. The documents
 * already support saying that — every mutator takes a `checkpointed` flag, and
 * the convention is that the caller snapshots once before the gesture and
 * writes everything after it uncheckpointed. This is that convention, held on
 * behalf of whichever control is being dragged.
 *
 * `preview` is what a control calls while its value is still moving; `commit`
 * is what it calls when the value settles. A control that never previews — a
 * toggle, a dropdown — only ever commits, and gets its own snapshot then.
 *
 * Only `commit` rebuilds the 3D view. `preview` writes the value and leaves the
 * picture alone, because a rebuild is the whole map view — its meshes, its
 * materials, its lights — and asking for one per animation frame while a slider
 * moves is a stall, not a preview. What you watch while dragging is the number
 * and its fill, which are live either way. A caller that *can* show its change
 * without a rebuild passes `redraw` and does it itself.
 */
export function useEdit(doc: Editable | null, editor: Invalidatable) {
  const inGesture = useRef(false);

  return {
    /** Live, while the value is still moving. Does not rebuild the view. */
    preview(write: () => void, redraw?: () => void) {
      if (!doc) return;
      if (!inGesture.current) {
        doc.checkpoint();
        inGesture.current = true;
      }
      write();
      redraw?.();
    },

    /**
     * Settled. Ends the gesture, if one was running.
     *
     * `what` says which part of the view the write actually changed. Named
     * nothing still means the whole map, which is right for most fields --
     * only a control that knows its edit is confined to one domain should say
     * so, and be wrong about it at its peril.
     */
    commit(write: () => void, ...what: Domain[]) {
      if (!doc) return;
      if (!inGesture.current) doc.checkpoint();
      inGesture.current = false;
      write();
      editor?.invalidate(...what);
    },
  };
}
