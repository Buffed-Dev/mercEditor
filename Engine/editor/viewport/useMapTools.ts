import { useEffect, useRef } from 'react';
import { toolById as terrainToolById } from '../terrain/tools.ts';
import { ASSETS } from '../document.ts';
import { say } from '../state/status';
import { useSelection, type Selection } from '../state/selection';
import { isTerrainTool, toolById, useTools, type ToolId } from '../state/tools';
import { headingToDegrees, headingToFace } from './heading';

/**
 * What a click on the map means.
 *
 * This is where the unified map screen actually lives. There is no terrain
 * mode: the tool in the rail decides whether a press shapes the ground or puts
 * something on it, and everything below reads that one value. What used to be a
 * switch that replaced the toolbar, the panels and the meaning of a click is
 * now a `switch` on the tool, in one place.
 *
 * The editor reports gestures — paint, erase, release, pick, drag, turn — and
 * this turns them into document edits. It is the same logic the old panel had;
 * what has gone is that it used to be interleaved with the code that drew the
 * panel around it.
 */

type Tile = { gx: number; gy: number };

type MapEditor = {
  doc: MapDoc | null;
  selection: Selection;
  select: (next: Selection) => void;
  invalidate: () => void;
  invalidateTerrain: () => void;
  on: (event: string, handler: (...args: never[]) => void) => void;
  setCursorMode: (mode: string) => void;
  setPreview: (kind: string | null, elevation?: number) => void;
  setInterpolate?: (on: boolean) => void;
  setRotatable?: (on: boolean) => void;
  setCellOverlay: (name: string, cells?: number[] | { gx: number; gy: number }[], grid?: object) => void;
};

type MapDoc = {
  map: Record<string, never>;
  terrain: object;
  inBounds: (gx: number, gy: number) => boolean;
  selectionAt: (gx: number, gy: number) => Selection;
  place: (gx: number, gy: number, brush: unknown, options: unknown) => string | null;
  erase: (gx: number, gy: number) => boolean;
  setStart: (gx: number, gy: number) => boolean;
  moveSpawn: (key: string, gx: number, gy: number, checkpointed?: boolean) => void;
  updateObject: (
    list: string,
    index: number,
    patch: Record<string, unknown>,
    checkpointed?: boolean,
  ) => void;
  beginStroke: (label: string) => unknown;
  commit: (stroke: unknown) => unknown;
  kindOf: (id: string) => number;
};

/** The cursor the 3D view should draw, for each tool. */
const CURSOR: Record<ToolId, string> = {
  select: 'select',
  move: 'move',
  place: 'paint',
  erase: 'erase',
  'terrain.height': 'terrain',
  'terrain.paint': 'terrain',
  'terrain.erase': 'terrain',
  'terrain.select': 'terrain',
};

/** Which field, if any, holds the selected thing's facing. */
function facingField(doc: MapDoc | null, selection: Selection): string | null {
  if (!doc || !selection) return null;
  if (selection.list === 'torches') return 'face';
  const list = (doc.map as Record<string, unknown[]>)[selection.list];
  const entry = selection.index === undefined ? null : list?.[selection.index];
  if (selection.list === 'lights' && entry && 'azimuth' in (entry as object)) return 'azimuth';
  return null;
}

export function useMapTools(editor: MapEditor | null, doc: MapDoc | null) {
  const tool = useTools((state) => state.tool);
  const brushId = useTools((state) => state.brush);
  const select = useSelection((state) => state.select);
  const selection = useSelection((state) => state.selection);

  // Handlers are registered once and read the current tool through a ref: the
  // editor keeps one handler per event, so re-registering on every keystroke
  // would be churn, and a handler closed over a stale tool would act on the
  // tool you had a moment ago.
  const live = useRef({ tool, brushId, doc, editor, select });
  live.current = { tool, brushId, doc, editor, select };

  /** State that belongs to a gesture rather than to a render. */
  const gesture = useRef<{
    dragging: (Selection & { committed?: boolean }) | null;
    handleDrag: boolean;
    stroke: unknown;
    anchor: Tile | null;
    last: Tile | null;
  }>({ dragging: null, handleDrag: false, stroke: null, anchor: null, last: null });

  // The cursor follows the tool: a ghost of the brush for Place, an outline for
  // the terrain tools, and nothing at all for the rest.
  useEffect(() => {
    if (!editor) return;
    editor.setCursorMode(CURSOR[tool]);
    editor.setPreview(tool === 'place' ? brushId : null);
    const terrain = isTerrainTool(tool) ? toolById(tool).terrainTool : null;
    editor.setInterpolate?.(Boolean(terrain && terrainToolById(terrain).continuous));
  }, [editor, tool, brushId]);

  // The turn handle is only worth drawing when there is something for it to
  // write to. A portal, a monster and a spawn look the same from every side.
  useEffect(() => {
    editor?.setRotatable?.(Boolean(facingField(doc, selection)));
  }, [editor, doc, selection]);

  // Mirror the selection into the 3D view, which draws the handles on it.
  useEffect(() => {
    editor?.select(selection);
  }, [editor, selection]);

  useEffect(() => {
    if (!editor) return;

    const terrainContext = (current: MapDoc, terrainId: string, opts: Record<string, unknown>) => ({
      grid: current.terrain,
      stroke: gesture.current.stroke,
      opts,
      // Resolved here rather than in the tool: choosing a terrain the map's
      // table does not have yet has to add it, and that is the document's
      // business rather than a brush's.
      kind: current.kindOf(terrainId),
      anchor: gesture.current.anchor,
      selection: null,
      setSelection: (rect: unknown) => {
        editor.setCellOverlay('selection', rect ? [] : [], current.terrain);
      },
      say,
    });

    const terrainDown = (current: MapDoc, tile: Tile) => {
      const { terrainId, terrainOptions } = useTools.getState();
      const spec = terrainToolById(toolById(live.current.tool).terrainTool ?? 'paint');
      gesture.current.anchor = tile;
      gesture.current.last = tile;
      gesture.current.stroke = current.beginStroke(spec.label);
      const ctx = terrainContext(current, terrainId, terrainOptions[spec.id] ?? {});
      spec.onDown?.(ctx as never, tile as never);
      marks(current, tile, ctx);
    };

    const terrainMove = (current: MapDoc, tile: Tile) => {
      if (!gesture.current.stroke) return;
      const { terrainId, terrainOptions } = useTools.getState();
      const spec = terrainToolById(toolById(live.current.tool).terrainTool ?? 'paint');
      gesture.current.last = tile ?? gesture.current.last;
      const ctx = terrainContext(current, terrainId, terrainOptions[spec.id] ?? {});
      spec.onMove?.(ctx as never, tile as never);
      marks(current, tile, ctx);
    };

    const terrainUp = (current: MapDoc) => {
      if (!gesture.current.stroke) return;
      const { terrainId, terrainOptions } = useTools.getState();
      const spec = terrainToolById(toolById(live.current.tool).terrainTool ?? 'paint');
      const ctx = terrainContext(current, terrainId, terrainOptions[spec.id] ?? {});
      spec.onUp?.(ctx as never, (gesture.current.last ?? gesture.current.anchor) as never);
      const stroke = gesture.current.stroke;
      gesture.current.stroke = null;
      gesture.current.anchor = null;
      gesture.current.last = null;
      editor.setCellOverlay('drag', []);
      if (current.commit(stroke)) editor.invalidateTerrain();
    };

    /** Outline what the tool would touch, and what a drag is sweeping out. */
    const marks = (current: MapDoc, tile: Tile, ctx: unknown) => {
      if (!tile) return;
      const spec = terrainToolById(toolById(live.current.tool).terrainTool ?? 'paint');
      editor.setCellOverlay('brush', spec.preview?.(ctx as never, tile as never) ?? [], current.terrain);
      editor.setCellOverlay('drag', spec.drag?.(ctx as never, tile as never) ?? [], current.terrain);
    };

    const placeAt = (current: MapDoc, tile: Tile) => {
      const brush = ASSETS.find((asset: { id: string }) => asset.id === live.current.brushId);
      if (!brush) {
        say('Pick something to place from the Assets tab', 'warn');
        return false;
      }

      // The start marker is a named spawn rather than a character in the grid,
      // so placing it is setting one rather than painting terrain.
      if (brush.id === 'spawn') {
        if (current.setStart(tile.gx, tile.gy)) editor.invalidate();
        return true;
      }

      // Every other brush names the list it goes into; only the start marker,
      // handled above, has none.
      if (!brush.list) return false;

      const error = current.place(tile.gx, tile.gy, brush, {
        ...useTools.getState().options[brush.id],
      });
      if (error) {
        say(error, 'error');
        return false;
      }

      // Select what was just placed, so the inspector is already on it.
      const list = (current.map as Record<string, unknown[]>)[brush.list];
      live.current.select({ list: brush.list, index: list.length - 1 });
      editor.invalidate();
      say('');
      return true;
    };

    const eraseAt = (current: MapDoc, tile: Tile, first: boolean) => {
      if (current.erase(tile.gx, tile.gy)) {
        live.current.select(null);
        editor.invalidate();
        return;
      }
      // Only on the tile the gesture started on: a sweep is expected to pass
      // over bare ground, and saying so every frame would be noise.
      if (first) say('Nothing on that tile to remove');
    };

    const moveAt = (current: MapDoc, tile: Tile, first: boolean) => {
      if (first) {
        const under = current.selectionAt(tile.gx, tile.gy);
        gesture.current.dragging = under ? { ...under, committed: false } : null;
        live.current.select(under);
        if (!under) say('Nothing on that tile to move');
        return;
      }

      const held = gesture.current.dragging;
      if (!held) return;

      // One checkpoint for the whole gesture, so an undo puts it back where it
      // started rather than stepping it back a tile at a time.
      const checkpointed = !held.committed;
      held.committed = true;

      if (held.list === 'spawns' && held.key !== undefined) {
        current.moveSpawn(held.key, tile.gx, tile.gy, checkpointed);
      } else if (held.index !== undefined) {
        current.updateObject(held.list, held.index, { gx: tile.gx, gy: tile.gy }, checkpointed);
      }
      editor.invalidate();
    };

    editor.on('paint', ((tile: Tile, first: boolean) => {
      const current = live.current.doc;
      if (!current) return;
      const active = live.current.tool;

      if (active === 'move') return moveAt(current, tile, first);
      if (active === 'erase') return eraseAt(current, tile, first);
      if (isTerrainTool(active)) {
        // A drag repeats the tool, which is how a plateau gets its shape in one
        // gesture.
        return first ? terrainDown(current, tile) : terrainMove(current, tile);
      }

      // Try to place first, and only fall back to selecting when the tile
      // refuses it. Asking "is something already here?" first was a guess at
      // what would be refused, and it guessed wrong for every brush that is
      // meant to share a tile — a torch mounts on a wall, a wall stacks on one.
      if (placeAt(current, tile)) return;

      const existing = current.selectionAt(tile.gx, tile.gy);
      if (existing) {
        live.current.select(existing);
        say('');
      }
    }) as never);

    editor.on('erase', ((tile: Tile, first: boolean) => {
      const current = live.current.doc;
      if (current) eraseAt(current, tile, first);
    }) as never);

    editor.on('release', (() => {
      const current = live.current.doc;
      // A terrain gesture ends here rather than on the last pointermove: that
      // is where a rectangle is finally written, and where one press becomes
      // one undo step.
      if (current && isTerrainTool(live.current.tool)) return terrainUp(current);
      gesture.current.dragging = null;
      gesture.current.handleDrag = false;
    }) as never);

    // Handed straight from the raycast rather than worked back from a tile, so
    // what gets selected is the thing that was under the cursor and highlighted
    // a moment before. Null is a click on nothing, which clears the selection.
    editor.on('pick', ((picked: Selection) => live.current.select(picked ?? null)) as never);

    editor.on('drag', ((gx: number, gy: number) => {
      const current = live.current.doc;
      const held = useSelection.getState().selection;
      if (!current || !held || !current.inBounds(gx, gy)) return;

      const checkpointed = !gesture.current.handleDrag;
      gesture.current.handleDrag = true;

      if (held.list === 'spawns' && held.key !== undefined) {
        current.moveSpawn(held.key, gx, gy, checkpointed);
      } else if (held.index !== undefined) {
        current.updateObject(held.list, held.index, { gx, gy }, checkpointed);
      }
      editor.invalidate();
    }) as never);

    editor.on('turn', ((heading: number) => {
      const current = live.current.doc;
      const held = useSelection.getState().selection;
      const field = facingField(current, held);
      if (!current || !held || !field || held.index === undefined) return;

      const checkpointed = !gesture.current.handleDrag;
      gesture.current.handleDrag = true;

      const value =
        field === 'face'
          ? headingToFace(heading)
          : headingToDegrees(heading, useTools.getState().snapTurns);

      current.updateObject(held.list, held.index, { [field]: value }, checkpointed);
      editor.invalidate();
    }) as never);
  }, [editor]);
}
