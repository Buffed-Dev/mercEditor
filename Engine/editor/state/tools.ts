import { create } from 'zustand';
import { TOOLS as TERRAIN_TOOLS } from '../terrain/tools.ts';

/**
 * One tool list for the whole map screen.
 *
 * There is no terrain *mode* any more. The editor used to have a switch that
 * replaced the toolbar, the panels and the meaning of a click all at once,
 * which meant every panel carried a branch for which of the two it was drawing
 * and the ground and the things standing on it could not be worked on in the
 * same breath. Now the tool is the mode: pick a terrain tool and a click means
 * ground, pick an object tool and it means what stands on it.
 *
 * The dividers between groups in the rail are load-bearing rather than
 * decorative — they are the only thing on screen that says which tools sculpt
 * and which place.
 */

export type ToolGroup = 'navigate' | 'objects' | 'terrain';

export type ToolId =
  | 'select'
  | 'move'
  | 'place'
  | 'erase'
  | 'terrain.height'
  | 'terrain.paint'
  | 'terrain.erase'
  | 'terrain.select';

export type ToolDef = {
  id: ToolId;
  label: string;
  hint: string;
  group: ToolGroup;
  /** A single key, in the convention every tool of this kind uses. */
  shortcut: string;
  /**
   * The tool in terrain/tools.ts this one drives, for the terrain group.
   *
   * Those ids are `select`, `height`, `paint` and `erase`, three of which
   * collide with an object tool's name — which is exactly why the ids here are
   * qualified and the mapping is written down rather than assumed.
   */
  terrainTool?: 'select' | 'height' | 'paint' | 'erase';
};

/**
 * The brushes the number row reaches, in order: 1..9 then 0.
 *
 * Positional over the catalogue rather than assignable, so the digit a brush
 * answers to is a fact about where it sits and not a second thing to remember.
 * The swatches wear their digit, because a shortcut nobody can see is one
 * nobody uses.
 */
export const SLOT_KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '0'];

export const TOOLS: readonly ToolDef[] = [
  { id: 'select', label: 'Select', hint: 'Pick and edit what is on the map', group: 'navigate', shortcut: 'v' },
  { id: 'move', label: 'Move', hint: 'Drag the selection about', group: 'navigate', shortcut: 'm' },
  { id: 'place', label: 'Place', hint: 'Put the current brush down', group: 'objects', shortcut: 'b' },
  { id: 'erase', label: 'Erase', hint: 'Take what is on a tile away', group: 'objects', shortcut: 'e' },
  { id: 'terrain.height', label: 'Sculpt', hint: 'Raise and lower the ground', group: 'terrain', shortcut: 'h', terrainTool: 'height' },
  { id: 'terrain.paint', label: 'Paint ground', hint: 'Lay a terrain down', group: 'terrain', shortcut: 't', terrainTool: 'paint' },
  { id: 'terrain.erase', label: 'Cut ground', hint: 'Take the ground away', group: 'terrain', shortcut: 'r', terrainTool: 'erase' },
  { id: 'terrain.select', label: 'Region', hint: 'Select a rectangle of ground', group: 'terrain', shortcut: 'k', terrainTool: 'select' },
] as const;

/**
 * The terrain tools by id, so a panel can ask one what settings it takes
 * without knowing anything about terrain itself.
 */
export const TOOLS_BY_TERRAIN = Object.fromEntries(
  TERRAIN_TOOLS.map((tool) => [tool.id, tool]),
);

export const toolById = (id: ToolId): ToolDef => TOOLS.find((tool) => tool.id === id) ?? TOOLS[0];

/** Which half of the screen a tool acts on — the ground, or what stands on it. */
export const isTerrainTool = (id: ToolId) => toolById(id).group === 'terrain';

/** A brush's own settings — a portal's destination, a torch's wall face. */
export type BrushOptions = Record<string, string | number>;

type ToolStore = {
  tool: ToolId;
  setTool: (tool: ToolId) => void;

  /** What Place puts down. Shown in the rail so it survives a tab switch. */
  brush: string | null;
  setBrush: (brush: string | null) => void;

  /**
   * Per brush, because they are not the same question: a portal's destination
   * and a torch's facing have nothing to do with each other, and switching
   * between the two brushes must not carry one's answer over to the other.
   */
  options: Record<string, BrushOptions>;
  setOption: (brush: string, key: string, value: string | number) => void;

  /** Which terrain the terrain tools lay down. */
  terrainId: string;
  setTerrainId: (id: string) => void;

  /** Per terrain tool — a brush width means nothing to the rectangle tool. */
  terrainOptions: Record<string, BrushOptions>;
  setTerrainOption: (tool: string, key: string, value: string | number) => void;

  /**
   * Whether the turn handle lands on quarter-hours of the compass.
   *
   * On by default, because every heading anyone has authored by hand is a whole
   * number and a dragged one is not — `azimuth: 309.437284` is what a free
   * handle writes into the map file. Off is for the cases where the exact angle
   * is the point.
   */
  snapTurns: boolean;
  setSnapTurns: (on: boolean) => void;
};

export const useTools = create<ToolStore>((set) => ({
  tool: 'select',
  setTool: (tool) => set({ tool }),

  brush: null,
  setBrush: (brush) => set({ brush }),

  options: {},
  setOption: (brush, key, value) =>
    set((state) => ({
      options: { ...state.options, [brush]: { ...state.options[brush], [key]: value } },
    })),

  terrainId: '',
  setTerrainId: (terrainId) => set({ terrainId }),

  snapTurns: true,
  setSnapTurns: (snapTurns) => set({ snapTurns }),

  terrainOptions: {},
  setTerrainOption: (tool, key, value) =>
    set((state) => ({
      terrainOptions: {
        ...state.terrainOptions,
        [tool]: { ...state.terrainOptions[tool], [key]: value },
      },
    })),
}));
