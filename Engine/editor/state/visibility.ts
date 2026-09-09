import { create } from 'zustand';

/**
 * What is hidden while you work.
 *
 * Deliberately *not* part of the map. Hiding a light to see what is under it is
 * a fact about this minute of editing, not about the level — writing it to the
 * file would hide the light in the game too, which is never what anyone meant.
 * So it lives here, the 3D view is told about it after every rebuild, and it is
 * forgotten when the map is closed.
 *
 * Nor is it persisted. Coming back tomorrow to a map with three lights missing
 * and no memory of switching them off is worse than switching them off again.
 */

type VisibilityStore = {
  hidden: Set<string>;
  toggle: (id: string) => void;
  /** When a different map opens, nothing about the last one still applies. */
  clear: () => void;
};

export const useVisibility = create<VisibilityStore>((set) => ({
  hidden: new Set(),

  toggle: (id) =>
    set((state) => {
      const next = new Set(state.hidden);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return { hidden: next };
    }),

  clear: () => set({ hidden: new Set() }),
}));
