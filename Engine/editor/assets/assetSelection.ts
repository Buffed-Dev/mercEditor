import { create } from 'zustand';
import { useSelection } from '../state/selection.ts';

/**
 * Which assets are selected in the Assets panel, and what the panel is doing.
 *
 * The inspector shows whatever was clicked last: picking an asset clears the
 * map selection, and picking something on the map clears this.
 */
type AssetSelection = {
  /** Selected entries, by path under assets/. */
  selected: string[];
  /** Where a shift-range starts. */
  anchor: string | null;
  /** The entry being named in place. */
  renaming: string | null;
  /** Whether the preview panel beside the inspector is open. */
  previewOpen: boolean;

  select(paths: string[], anchor?: string | null): void;
  clear(): void;
  setRenaming(path: string | null): void;
  togglePreview(): void;
  /** Keep selection and renaming on an entry whose path changed. */
  moved(from: string, to: string): void;
};

export const useAssetSelection = create<AssetSelection>((set) => ({
  selected: [],
  anchor: null,
  renaming: null,
  previewOpen: false,

  select(paths, anchor) {
    if (paths.length) useSelection.getState().clear();
    set((state) => ({ selected: paths, anchor: anchor === undefined ? (paths[0] ?? state.anchor) : anchor }));
  },
  clear() {
    set({ selected: [], anchor: null });
  },
  setRenaming(path) {
    set({ renaming: path });
  },
  togglePreview() {
    set((state) => ({ previewOpen: !state.previewOpen }));
  },
  moved(from, to) {
    const swap = (path: string) =>
      path === from ? to : path.startsWith(`${from}/`) ? `${to}${path.slice(from.length)}` : path;
    set((state) => ({
      selected: state.selected.map(swap),
      anchor: state.anchor ? swap(state.anchor) : null,
      renaming: state.renaming ? swap(state.renaming) : null,
    }));
  },
}));

// Something picked on the map takes the inspector back.
useSelection.subscribe((state, before) => {
  if (state.selection && state.selection !== before.selection && useAssetSelection.getState().selected.length) {
    useAssetSelection.setState({ selected: [], anchor: null });
  }
});
