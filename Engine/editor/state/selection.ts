import { create } from 'zustand';

/**
 * What is selected on the map.
 *
 * Two different things, deliberately:
 *
 * - `selection` is the one the inspector is about, and the one the 3D view
 *   draws handles on. There is at most one.
 * - `picked` is what the object list has highlighted, which can be many — you
 *   pick a dozen rows to group them, delete them or nudge them together.
 *
 * They used to be one field and a `Set` living in the same closure, and the
 * question "what does Delete delete" had two answers depending on where you
 * last clicked. Keeping them apart is what makes that answerable: the list acts
 * on `picked`, everything else acts on `selection`, and clicking a row sets
 * both.
 */

export type Selection = { list: string; index?: number; key?: string } | null;

/** How a row is addressed in `picked` — a list and a position within it. */
export const rowId = (selection: NonNullable<Selection>) =>
  `${selection.list}:${selection.key ?? selection.index}`;

type SelectionStore = {
  selection: Selection;
  picked: Set<string>;
  /** Where a shift-range starts from. */
  anchor: string | null;

  select: (selection: Selection) => void;
  setPicked: (picked: Set<string>, anchor?: string | null) => void;
  clear: () => void;
};

export const useSelection = create<SelectionStore>((set) => ({
  selection: null,
  picked: new Set(),
  anchor: null,

  select(selection) {
    set({
      selection,
      picked: selection ? new Set([rowId(selection)]) : new Set(),
      anchor: selection ? rowId(selection) : null,
    });
  },

  setPicked(picked, anchor) {
    set((state) => ({ picked, anchor: anchor === undefined ? state.anchor : anchor }));
  },

  clear() {
    set({ selection: null, picked: new Set(), anchor: null });
  },
}));

/** Read the selection from outside a component — event handlers, mostly. */
export const currentSelection = () => useSelection.getState().selection;
