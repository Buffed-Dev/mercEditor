import { useEffect, useRef } from 'react';
import { toolById as terrainToolById } from '../terrain/tools.ts';
import { BRUSHES } from '../document.ts';
import type { MapDocument } from '../document.ts';
import type { MapObject } from '../../src/data/mapFormat.ts';
import type { Transform } from '../../src/data/transform.ts';
import { snapSpot, type GizmoMode } from '../gizmos.ts';
import type { CursorMode, MapEditor } from '../editor.ts';
import { say } from '../state/status';
import { useSelection, type Selection } from '../state/selection';
import { isTerrainTool, toolById, useTools, type ToolId } from '../state/tools';

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

/** A tile, and the exact point on it the pointer is over. See `Cell` in editor.ts. */
type Tile = { gx: number; gy: number; x?: number; z?: number };

/**
 * Where a thing is put down: on the point under the pointer, snapped as the
 * snap settings say. Only terrain is tiles; a chunk is a rectangle of terrain,
 * so it keeps to whole ones.
 */
const spot = (tile: Tile, whole = false): { gx: number; gy: number } =>
  whole || tile.x === undefined || tile.z === undefined
    ? { gx: tile.gx, gy: tile.gy }
    : snapSpot(tile.x, tile.z, useTools.getState().snap);

/** The document, under the name this file has always called it. */
type MapDoc = MapDocument;

/** A map's lists, reached by a name worked out at runtime. See document.ts. */
const listsOf = (map: MapDoc['map']): Record<string, MapObject[] | undefined> =>
  map as unknown as Record<string, MapObject[] | undefined>;

/**
 * What of a transform a list keeps.
 *
 * Only an object and a prefab carry all nine numbers. A light turns by its
 * compass bearing rather than a rotation, so a turn about Y goes there; the
 * rest stand somewhere and that is all.
 */
function patchFor(list: string, to: Transform): Record<string, unknown> {
  if (list === 'props' || list === 'prefabs') return { ...to };
  const place = { gx: to.gx, gy: to.gy, lift: to.lift };
  if (list === 'lights') return { gx: to.gx, gy: to.gy, azimuth: to.rot };
  return place;
}

/** The cursor the 3D view should draw, for each tool. */
const CURSOR: Record<ToolId, CursorMode> = {
  select: 'select',
  move: 'move',
  rotate: 'select',
  scale: 'select',
  place: 'paint',
  erase: 'erase',
  'terrain.height': 'terrain',
  'terrain.paint': 'terrain',
  'terrain.erase': 'terrain',
  'terrain.select': 'terrain',
};

/**
 * Where a selected thing currently sits on the grid, or null if it is not the
 * kind of thing that sits anywhere.
 *
 * Read before the document is written, so a drag can work out how far the thing
 * moved and slide what is drawn by exactly that.
 */
function positionOf(doc: MapDoc, selection: Selection): { gx: number; gy: number } | null {
  if (!selection) return null;
  const entry =
    selection.list === 'spawns' && selection.key !== undefined
      ? doc.map.spawns?.[selection.key]
      : selection.index === undefined
        ? null
        : listsOf(doc.map)[selection.list]?.[selection.index];
  const at = entry as { gx?: number; gy?: number } | null | undefined;
  return at && typeof at.gx === 'number' && typeof at.gy === 'number'
    ? { gx: at.gx, gy: at.gy }
    : null;
}


/** Which handles a tool puts on the selection, if any. */
const GIZMO: Partial<Record<ToolId, GizmoMode>> = { move: 'move', rotate: 'rotate', scale: 'scale' };

export function useMapTools(editor: MapEditor | null, doc: MapDoc | null) {
  const tool = useTools((state) => state.tool);
  const brushId = useTools((state) => state.brush);
  const terrainOptions = useTools((state) => state.terrainOptions);
  const snap = useTools((state) => state.snap);
  const placeTurn = useTools((state) => state.placeTurn);
  const select = useSelection((state) => state.select);
  const selection = useSelection((state) => state.selection);

  // Handlers are registered once and read the current tool through a ref: the
  // editor keeps one handler per event, so re-registering on every keystroke
  // would be churn, and a handler closed over a stale tool would act on the
  // tool you had a moment ago.
  const live = useRef({ tool, brushId, doc, editor, select });
  /**
   * The brush footprint redraw, reachable from outside the handlers.
   *
   * The outline follows the settings as well as the pointer, and the settings
   * are changed in a popover standing over the map -- so at the moment the
   * brush grows, the pointer is on the popover rather than on a tile and no
   * pointermove is coming. Held here so the effect below can ask for the same
   * redraw the pointer would have.
   */
  const redrawBrush = useRef<(tile: Tile) => void>(() => {});
  live.current = { tool, brushId, doc, editor, select };

  /** State that belongs to a gesture rather than to a render. */
  const gesture = useRef<{
    dragging: (Selection & { committed?: boolean }) | null;
    handleDrag: boolean;
    stroke: ReturnType<MapDoc['beginStroke']> | null;
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

  // A brush that grew has to show it before the pointer moves again: the size
  // is changed on the tool itself, which stands over the map, so the pointer
  // is on the popover at the moment it changes. Redrawn against the tile it
  // was last over, which is where the outline already is.
  useEffect(() => {
    if (editor) redrawBrush.current(editor.hover as Tile);
  }, [editor, tool, terrainOptions]);

  // Which handles, and what they land on.
  useEffect(() => {
    editor?.setGizmoMode(GIZMO[tool] ?? null);
  }, [editor, tool]);
  useEffect(() => {
    editor?.setSnap(snap);
  }, [editor, snap]);
  useEffect(() => {
    editor?.setPlaceTurn(placeTurn);
  }, [editor, placeTurn]);

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

    /**
     * Just enough of a context to ask a tool what it *would* touch.
     *
     * `terrainContext` cannot be used for this. It resolves the chosen terrain
     * to a grid value, and resolving one the map has not used yet adds it to
     * the map's terrain table — so building one on every pointer move would
     * mean sweeping across the canvas quietly edited the document. A preview is
     * a question, not an edit, and the two tools that answer it read only the
     * grid and their own settings.
     */
    const previewContext = (current: MapDoc, opts: Record<string, unknown>) => ({
      grid: current.terrain,
      opts,
    });

    /**
     * The footprint the brush would cover, under the pointer.
     *
     * Drawn from the tool's own `preview`, which is the same function the drag
     * uses — so what is outlined cannot drift from what a click would actually
     * write, and it is clipped at the edges of the map and follows the ground
     * for free.
     *
     * Only when it covers more than the one tile the cursor already marks: at a
     * brush of one the square outline and the tile cursor are the same square,
     * drawn twice.
     */
    const hoverBrush = (tile: Tile) => {
      const current = live.current.doc;
      if (!current) return;
      // Mid-gesture the stroke is already drawing this, with an anchor this
      // does not have.
      if (gesture.current.stroke) return;

      const active = live.current.tool;
      if (!tile || !isTerrainTool(active)) {
        editor.setCellOverlay('brush', []);
        return;
      }

      const spec = terrainToolById(toolById(active).terrainTool ?? 'paint');
      const ctx = previewContext(current, useTools.getState().terrainOptions[spec.id] ?? {});
      const cells = spec.preview?.(ctx as never, tile as never) ?? [];
      editor.setCellOverlay('brush', cells.length > 1 ? cells : [], current.terrain);
    };

    redrawBrush.current = hoverBrush;

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
      // The stroke has already written the grid -- `set` mutates it on the spot
      // -- so the only thing standing between a drag and the paint appearing
      // under it was that nobody told the view. This says so. It sets a flag
      // the render loop drains once a frame, so a burst of pointer events is
      // still one refresh, and the refresh keeps its meshes and its materials.
      //
      // The undo entry still waits for `terrainUp`: one drag is one thing you
      // did, however many cells and however many events it took.
      editor.invalidateTerrain();
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
      const brush = BRUSHES.find((asset: { id: string }) => asset.id === live.current.brushId);
      if (!brush) {
        say('Pick something to place from the Assets tab', 'warn');
        return false;
      }

      // The start marker is a named spawn rather than a character in the grid,
      // so placing it is setting one rather than painting terrain.
      if (brush.id === 'spawn') {
        const at = spot(tile);
        if (current.setStart(at.gx, at.gy)) editor.invalidate();
        return true;
      }

      // Every other brush names the list it goes into; only the start marker,
      // handled above, has none.
      if (!brush.list) return false;

      const at = spot(tile, brush.list === 'chunks');
      const error = current.place(at.gx, at.gy, brush, {
        ...useTools.getState().options[brush.id],
        rot: useTools.getState().placeTurn,
      });
      if (error) {
        say(error, 'error');
        return false;
      }

      // Select what was just placed, so the inspector is already on it.
      const list = listsOf(current.map)[brush.list] ?? [];
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

      // Read before the write, so the step is the difference between the two.
      const before = positionOf(current, held);
      const at = spot(tile, held.list === 'chunks');
      if (held.list === 'spawns' && held.key !== undefined) {
        current.moveSpawn(held.key, at.gx, at.gy, checkpointed);
      } else if (held.index !== undefined) {
        current.updateObject(held.list, held.index, at, checkpointed);
      }
      // Slide what is already drawn. `release` rebuilds once at the end, which
      // is what settles the height and anything else the slide only
      // approximated -- and what a thing that cannot be slid falls back to.
      if (!before || !editor.nudge(held, at.gx - before.gx, at.gy - before.gy)) {
        editor.invalidate();
      }
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

    editor.on('hover', ((tile: Tile) => hoverBrush(tile)) as never);

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
      // A drag slid what was drawn rather than rebuilding it on every move, so
      // this is where the view is made authoritative again.
      const dragged = Boolean(gesture.current.dragging?.committed) || gesture.current.handleDrag;
      gesture.current.dragging = null;
      gesture.current.handleDrag = false;
      if (dragged) editor.invalidate();
    }) as never);

    // Handed straight from the raycast rather than worked back from a tile, so
    // what gets selected is the thing that was under the cursor and highlighted
    // a moment before. Null is a click on nothing, which clears the selection.
    editor.on('pick', ((picked: Selection) => live.current.select(picked ?? null)) as never);

    // A handle mid-drag: the document is written every frame and the view is
    // asked to show it without being built again. One checkpoint for the whole
    // drag, so undo puts it back where it started.
    editor.on('transform', ((to: Transform) => {
      const current = live.current.doc;
      const held = useSelection.getState().selection;
      if (!current || !held) return;
      if (!current.inBounds(Math.floor(to.gx), Math.floor(to.gy))) return;

      const checkpointed = !gesture.current.handleDrag;
      gesture.current.handleDrag = true;

      if (held.list === 'spawns' && held.key !== undefined) {
        current.moveSpawn(held.key, to.gx, to.gy, checkpointed);
      } else if (held.index !== undefined) {
        current.updateObject(held.list, held.index, patchFor(held.list, to), checkpointed);
      }
      editor.previewTransform();
    }) as never);

    // Let go: the map is built again, so everything that follows from where a
    // thing stands -- its shadow, the tiles it blocks -- catches up.
    editor.on('transformEnd', (() => {
      if (!gesture.current.handleDrag) return;
      gesture.current.handleDrag = false;
      editor.invalidate();
    }) as never);
  }, [editor]);
}
