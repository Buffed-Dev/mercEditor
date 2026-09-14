import { idx, EMPTY, type TerrainGrid } from '../../src/data/terrain/grid.ts';
import { brushCells, rectCells, type Cell } from './shapes.ts';
import type { Rect } from '../history.ts';
import type { Stroke } from './stroke.ts';

/**
 * The terrain tools.
 *
 * Each is a small object rather than a case in a switch, and each declares its
 * own options as field descriptors so the panel renders them without knowing
 * what any of them are. Adding a tool is a module and a line in the list below;
 * adding an option to one is a line inside it.
 *
 * **No tool lets you choose middle, side or corner.** Painting means "this cell
 * is grass" and the shape of the ground is worked out from what is next to
 * what — that is the whole point of the redesign, and a manual override would
 * be a way to fight it.
 *
 * There are four, and the list is meant to stay short. It briefly held
 * fourteen — fill, line, rectangle, eyedropper, raise, lower, three kinds of
 * ramp — and every one of them was a second way to do something the four
 * already do. Height sets a level outright rather than nudging it, because
 * "make this level 2" is the thing anyone actually wants and nudging is how you
 * build a tower by holding still.
 */

export const MAX_LEVEL = 9;

export type ToolContext = {
  grid: TerrainGrid;
  /** The open gesture. Every write goes through it so undo is per gesture. */
  stroke: Stroke;
  /** This tool's own option values, by field key. */
  opts: Record<string, string | number | boolean>;
  /** The palette's current terrain, as a grid value. 0 when Empty is chosen. */
  kind: number;
  /** Where a drag started, for the tools that need it. */
  anchor: Cell | null;
  /** The held rectangle, or null. Set by Select. */
  selection: Rect | null;
  setSelection(rect: Rect | null): void;
  say(text: string, kind?: string): void;
};

export type ToolField = {
  key: string;
  kind: 'range' | 'select' | 'bool' | 'number';
  label: string;
  min?: number;
  max?: number;
  step?: number;
  default: string | number | boolean;
  options?: [string, string][];
  /** Shown only when this returns true. */
  when?: (opts: Record<string, string | number | boolean>) => boolean;
};

export type Tool = {
  id: string;
  icon: string;
  label: string;
  fields?: ToolField[];
  /** True when a drag should paint every cell between pointer samples. */
  continuous?: boolean;
  /** The cells this tool would affect, outlined under the cursor. */
  preview?(ctx: ToolContext, cell: Cell): number[];
  /** The cells a drag is currently sweeping out, outlined until release. */
  drag?(ctx: ToolContext, cell: Cell): number[];
  onDown?(ctx: ToolContext, cell: Cell): void;
  onMove?(ctx: ToolContext, cell: Cell): void;
  onUp?(ctx: ToolContext, cell: Cell): void;
};

const SIZE: ToolField = {
  key: 'size',
  kind: 'range',
  label: 'Brush',
  min: 1,
  max: 9,
  step: 2,
  default: 1,
};

const size = (ctx: ToolContext) => Number(ctx.opts.size ?? 1);

/** Write one cell, keeping whatever of it the tool is not changing. */
function write(ctx: ToolContext, i: number, patch: { level?: number | undefined; kind?: number | undefined }) {
  const { grid } = ctx;
  ctx.stroke.setAt(i, patch.level ?? grid.level[i]!, patch.kind ?? grid.kind[i]!);
}

// --- painting --------------------------------------------------------------

export const paint: Tool = {
  id: 'paint',
  icon: 'brush',
  label: 'Paint',
  continuous: true,
  fields: [SIZE],
  preview: (ctx, cell) => brushCells(ctx.grid, cell, size(ctx)),
  onDown(ctx, cell) {
    this.onMove!(ctx, cell);
  },
  onMove(ctx, cell) {
    for (const i of brushCells(ctx.grid, cell, size(ctx))) {
      // Painting into empty space creates ground at level 0. Painting over
      // ground keeps its height: you are saying what it is made of, not how
      // tall it is, and flattening a plateau by brushing over it would be a
      // surprise every time.
      const level = ctx.grid.kind[i] === EMPTY ? 0 : ctx.grid.level[i];
      write(ctx, i, { level, kind: ctx.kind });
    }
  },
};

export const erase: Tool = {
  id: 'erase',
  icon: 'eraser',
  label: 'Erase',
  continuous: true,
  fields: [SIZE],
  preview: (ctx, cell) => brushCells(ctx.grid, cell, size(ctx)),
  onDown(ctx, cell) {
    this.onMove!(ctx, cell);
  },
  onMove(ctx, cell) {
    // Back to nothing, not to level-0 ground: the cell stops existing, which is
    // what makes holes and island edges possible at all.
    for (const i of brushCells(ctx.grid, cell, size(ctx))) {
      write(ctx, i, { level: 0, kind: EMPTY });
    }
  },
};

// --- height ----------------------------------------------------------------

/**
 * Put every cell you touch at one stated level.
 *
 * Absolute rather than relative, and that is the whole design: to raise a
 * level-1 tile you set the field to 2 and click it. A relative nudge needs to
 * know how many times it has already fired on the cell under a slow cursor,
 * which is a bug waiting behind every brush; an absolute set is idempotent by
 * construction and reads the same whether you click once or scrub.
 */
export const height: Tool = {
  id: 'height',
  icon: 'stack-2',
  label: 'Height',
  continuous: true,
  fields: [
    SIZE,
    { key: 'level', kind: 'range', label: 'Level', min: 0, max: MAX_LEVEL, step: 1, default: 1 },
  ],
  preview: (ctx, cell) => brushCells(ctx.grid, cell, size(ctx)),
  onDown(ctx, cell) {
    this.onMove!(ctx, cell);
  },
  onMove(ctx, cell) {
    for (const i of brushCells(ctx.grid, cell, size(ctx))) {
      if (ctx.grid.kind[i] === EMPTY) continue; // raising a hole would invent ground
      write(ctx, i, { level: Number(ctx.opts.level ?? 0) });
    }
  },
};

// --- selection -------------------------------------------------------------

const rectOf = (a: Cell, b: Cell): Rect => ({
  gx: Math.min(a.gx, b.gx),
  gy: Math.min(a.gy, b.gy),
  w: Math.abs(b.gx - a.gx) + 1,
  h: Math.abs(b.gy - a.gy) + 1,
});

/**
 * Hold a rectangle of cells, so copy and delete have something to act on.
 *
 * Selecting is not an edit: it takes no stroke, dirties nothing and cannot be
 * undone, because there is nothing to put back.
 */
export const select: Tool = {
  id: 'select',
  icon: 'pointer',
  label: 'Select',
  drag: (ctx, cell) => (ctx.anchor ? rectCells(ctx.grid, ctx.anchor, cell, true) : []),
  preview: (ctx, cell) => brushCells(ctx.grid, cell, 1),
  onUp(ctx, cell) {
    if (!ctx.anchor) return;
    const rect = rectOf(ctx.anchor, cell);
    // A click rather than a drag clears, which is how you put a selection down.
    ctx.setSelection(rect.w === 1 && rect.h === 1 ? null : rect);
  },
};

export type Region = { w: number; h: number; level: Uint8Array; kind: Uint8Array };

/** A rectangle's cells, lifted out of the grid. */
export function readRegion(grid: TerrainGrid, rect: Rect): Region {
  const region: Region = {
    w: rect.w,
    h: rect.h,
    level: new Uint8Array(rect.w * rect.h),
    kind: new Uint8Array(rect.w * rect.h),
  };
  for (let y = 0; y < rect.h; y += 1) {
    for (let x = 0; x < rect.w; x += 1) {
      const gx = rect.gx + x;
      const gy = rect.gy + y;
      if (gx < 0 || gy < 0 || gx >= grid.cols || gy >= grid.rows) continue;
      const from = idx(grid, gx, gy);
      const to = y * rect.w + x;
      region.level[to] = grid.level[from]!;
      region.kind[to] = grid.kind[from]!;
    }
  }
  return region;
}

/** Write a lifted region down with its top-left corner at (gx, gy). */
export function stampRegion(ctx: ToolContext, region: Region, gx: number, gy: number): void {
  for (let y = 0; y < region.h; y += 1) {
    for (let x = 0; x < region.w; x += 1) {
      const at = y * region.w + x;
      ctx.stroke.set(gx + x, gy + y, region.level[at]!, region.kind[at]!);
    }
  }
}

/** Non-empty on purpose: an unknown id falls back to the first. */
export const TOOLS: [Tool, ...Tool[]] = [select, height, paint, erase];

export const toolById = (id: string): Tool => TOOLS.find((tool) => tool.id === id) ?? TOOLS[0];

/** A tool's option values, filled in from its own defaults. */
export function toolDefaults(tool: Tool): Record<string, string | number | boolean> {
  return Object.fromEntries((tool.fields ?? []).map((field) => [field.key, field.default]));
}
