import { create } from 'zustand';
import { persist } from 'zustand/middleware';

/**
 * How wide the panels are, and which of them are folded away.
 *
 * Per game, because a game whose maps are mostly terrain wants a different
 * shape of window from one that is mostly placed objects, and the answer is
 * worth keeping. Which folder the library is showing rides along: it is the
 * same kind of fact -- where you left the window -- and it wants the same
 * persistence rather than a second store to say one string in. It is only ever four numbers and two flags, so it is stored as
 * a plain map keyed by game id rather than as a serialized layout tree — there
 * is no format here to have to migrate later.
 */

export type PanelLayout = {
  leftWidth: number;
  inspectorWidth: number;
  leftCollapsed: boolean;
  inspectorCollapsed: boolean;
  /** Whether the tile grid is drawn in map and prefab viewports. */
  gridVisible: boolean;
  /** Which folder the library browser is in, under assets/. */
  folder: string;
};

export const DEFAULT_LAYOUT: PanelLayout = {
  leftWidth: 232,
  inspectorWidth: 288,
  leftCollapsed: false,
  inspectorCollapsed: false,
  gridVisible: true,
  folder: '',
};

/** Below this a panel is unusable, and above it the viewport is. */
export const PANEL_MIN = 168;
export const PANEL_MAX = 520;

const clamp = (value: number) => Math.round(Math.min(PANEL_MAX, Math.max(PANEL_MIN, value)));

type LayoutStore = {
  byGame: Record<string, PanelLayout>;
  set: (game: string, patch: Partial<PanelLayout>) => void;
};

const useLayoutStore = create<LayoutStore>()(
  persist(
    (set) => ({
      byGame: {},
      set: (game, patch) =>
        set((state) => ({
          byGame: {
            ...state.byGame,
            [game]: { ...DEFAULT_LAYOUT, ...state.byGame[game], ...patch },
          },
        })),
    }),
    { name: 'merc.editor.layout' },
  ),
);

/** This game's panel sizes, and the two ways of changing them. */
export function useLayout(game: string) {
  const layout = useLayoutStore((state) => state.byGame[game]) ?? DEFAULT_LAYOUT;
  const write = useLayoutStore((state) => state.set);

  return {
    ...layout,
    setLeftWidth: (width: number) => write(game, { leftWidth: clamp(width) }),
    setInspectorWidth: (width: number) => write(game, { inspectorWidth: clamp(width) }),
    toggleLeft: () => write(game, { leftCollapsed: !layout.leftCollapsed }),
    toggleInspector: () => write(game, { inspectorCollapsed: !layout.inspectorCollapsed }),
    toggleGrid: () => write(game, { gridVisible: !layout.gridVisible }),
    // Kept here rather than in component state because it has to outlive the
    // panel: going to the map and coming back should land where you were.
    setFolder: (folder: string) => write(game, { folder }),
  };
}
