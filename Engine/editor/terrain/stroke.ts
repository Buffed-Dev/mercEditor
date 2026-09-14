import { idx, type TerrainGrid } from '../../src/data/terrain/grid.ts';
import type { HistoryEntry } from '../history.ts';

/**
 * One gesture's worth of terrain edits.
 *
 * A brush stroke is one thing a person did, so it is one thing to undo —
 * however many cells it crossed and however many pointer events the browser
 * happened to deliver. The stroke collects the writes and hands back a single
 * history entry at the end.
 *
 * `set` remembers a cell's *original* value the first time it is touched and
 * never again, which is what makes re-crossing a cell mid-drag free: it records
 * nothing new, and it cannot accumulate. That one property is also what
 * replaces the old brushes' `first` flag — a brush could build a tower under a
 * slow-moving cursor, and now the second write to a cell simply overwrites the
 * first rather than adding to it.
 */
export function beginStroke(grid: TerrainGrid, label = 'terrain') {
  /** cell index -> the [level, kind] that was there before. */
  const before = new Map<number, [number, number]>();
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;

  const remember = (i: number, gx: number, gy: number) => {
    if (before.has(i)) return;
    before.set(i, [grid.level[i]!, grid.kind[i]!]);
    if (gx < x0) x0 = gx;
    if (gx > x1) x1 = gx;
    if (gy < y0) y0 = gy;
    if (gy > y1) y1 = gy;
  };

  return {
    get touched() {
      return before.size;
    },

    /** Write one cell. Out-of-bounds writes are dropped, not clamped. */
    set(gx: number, gy: number, level: number, kind: number): void {
      if (gx < 0 || gy < 0 || gx >= grid.cols || gy >= grid.rows) return;
      const i = idx(grid, gx, gy);
      remember(i, gx, gy);
      grid.level[i] = level;
      grid.kind[i] = kind;
    },

    /** Write one cell by index, for tools that work in flat indices. */
    setAt(i: number, level: number, kind: number): void {
      // An index off the end writes nowhere — a typed array drops it silently —
      // but it would still be remembered, and undo would then restore a cell
      // that was never touched from a pair of undefineds.
      if (!Number.isInteger(i) || i < 0 || i >= grid.level.length) return;
      remember(i, i % grid.cols, Math.floor(i / grid.cols));
      grid.level[i] = level;
      grid.kind[i] = kind;
    },

    /**
     * The history entry for this gesture, or null if nothing actually changed.
     *
     * Painting grass onto grass touches cells and changes none of them, and an
     * undo step that restores what is already there is a step that looks broken
     * when you press Ctrl+Z and nothing happens.
     */
    commit(): HistoryEntry | null {
      for (const [i, was] of before) {
        if (was[0] === grid.level[i] && was[1] === grid.kind[i]) {
          before.delete(i);
        }
      }
      if (!before.size) return null;

      // Undo and redo are the same operation: swap what is stored with what is
      // live. One function, so there is no direction to get backwards, and it
      // is exactly self-inverse however many times it is run.
      const swap = () => {
        for (const [i, was] of before) {
          before.set(i, [grid.level[i]!, grid.kind[i]!]);
          grid.level[i] = was[0];
          grid.kind[i] = was[1];
        }
      };

      return {
        label,
        undo: swap,
        redo: swap,
        rect: { gx: x0, gy: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 },
      };
    },
  };
}

export type Stroke = ReturnType<typeof beginStroke>;
