import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder.js';
// Side-effect only: this is what adds `enableEdgesRendering` to Mesh.
import '@babylonjs/core/Rendering/edgesRenderer.js';
import { TransformNode } from '@babylonjs/core/Meshes/transformNode.js';
import { Matrix, Quaternion, Vector3 } from '@babylonjs/core/Maths/math.vector.js';
import { cellLine } from './terrain/shapes.ts';
// Side-effect only: this is what adds the thin-instance methods to Mesh.
import '@babylonjs/core/Meshes/thinInstanceMesh.js';
import { Plane } from '@babylonjs/core/Maths/math.plane.js';
// Side-effect only: this is what adds `createPickingRay` to Scene.
import '@babylonjs/core/Culling/ray.js';
import { Color3, Color4 } from '@babylonjs/core/Maths/math.color.js';
import { RenderTargetTexture } from '@babylonjs/core/Materials/Textures/renderTargetTexture.js';
import { CAMERA_OFFSET } from '../src/render/isoCamera.ts';
import { buildMapView } from '../src/render/mapView.ts';
import { LEVEL_H } from '../src/data/dimensions.ts';
import { colorOf, unlit } from '../src/render/materials.ts';
import { LIGHT_FIELDS, normalizeLight } from '../src/data/lights.ts';

import { World } from '../src/game/world.ts';
import { createDocument } from './document.ts';
import { expandPrefabs, normalizePrefab, prefabById, prefabObjects } from '../src/data/prefabs.ts';
import { eulerOf, scaleOf, wrapDeg, type Transform } from '../src/data/transform.ts';
import { createGizmos, snapSpot, type GizmoMode, type Snap } from './gizmos.ts';
import { pickOf, tagPick } from '../src/render/pick.ts';
import type { AbstractMesh } from '@babylonjs/core/Meshes/abstractMesh.js';
import type { Mesh } from '@babylonjs/core/Meshes/mesh.js';
import type { LinesMesh } from '@babylonjs/core/Meshes/linesMesh.js';
import type { Material } from '@babylonjs/core/Materials/material.js';
import type { Node } from '@babylonjs/core/node.js';
import type { PickingInfo } from '@babylonjs/core/Collisions/pickingInfo.js';
import type { Scene } from '@babylonjs/core/scene.js';
import type { TargetCamera } from '@babylonjs/core/Cameras/targetCamera.js';
import type { PickTag } from '../src/render/pick.ts';
import type { MapContent } from '../src/render/mapView.ts';
import type { PlacedPrefab, Prefab } from '../src/data/prefabs.ts';
import type { RimRing } from '../src/data/terrain/profile.ts';
import type { TerrainLayer } from '../src/render/terrainLayer.ts';
import type { TerrainGrid } from '../src/data/terrain/grid.ts';
import type { GameMap, MapObject, Placed } from '../src/data/mapFormat.ts';
import type { MapDoc, MapDocument } from './document.ts';
import type { Selection } from './state/selection.ts';

/** One tile. */
/**
 * A tile, and the exact point on the ground the pointer was over when there
 * is one. The tile is what terrain is painted on; the point is where a thing
 * is put down, since only terrain is tiles.
 */
type Cell = { gx: number; gy: number; x?: number; z?: number };

/** The rectangle the view is cut down to. */
type Rect = { gx: number; gy: number; w: number; h: number };

/** A box in world space: where its middle is, and how big it is. */
type Box = { x: number; y: number; z: number; w: number; h: number; d: number };

/** A box the highlight draws, and how. See `cursorTarget`. */
type Target = Box & { color: number; hug?: boolean };

/** What a ray found: the tag, plus the node and the hit that carried it. */
type Pick = PickTag & { object: TransformNode; hit: PickingInfo };

/**
 * A part of the view that an edit can change on its own.
 *
 * Named after what the *document* changed rather than after the meshes that
 * draw it, because the caller making the edit knows the first and has no
 * business knowing the second.
 *
 * - `map` — everything. Opening a map, resizing one, or a change some other
 *   domain looked at and could not reconcile.
 * - `terrain` — the ground moved. Refills instance buffers; keeps every mesh,
 *   material and shader.
 * - `lights` — a light's settings were edited. Pushed onto the live light.
 * - `grid` — the map's size changed, which is the only thing the grid draws.
 * - `markers` — the things that stand *for* something: the selection cage, the
 *   start ring, the spawn cones, the effect beads. Drawn again from the
 *   document, so this is for a change to *which* of them there are.
 * - `standing` — the same markers, still the right ones, standing on ground
 *   that has moved under them. A handful of heights rather than a few dozen
 *   meshes, which is what the terrain brush asks for on every pointer move.
 */
type Domain = 'map' | 'terrain' | 'lights' | 'grid' | 'markers' | 'standing';

/** Which tool the cursor is serving. */
export type CursorMode = 'select' | 'move' | 'terrain' | 'paint' | 'erase';

/**
 * What the panel asked to hear about.
 *
 * The editor works out where the pointer is and what it is over; what any of
 * that means to the map is the panel's to decide, which is why every one of
 * these is a report rather than an edit.
 */
type Listeners = {
  paint: ((cell: Cell, first: boolean) => void) | null;
  erase: ((cell: Cell, first: boolean) => void) | null;
  hover: ((cell: Cell | null) => void) | null;
  release: (() => void) | null;
  /**
   * The selection has been moved, turned or scaled by a handle, to this. Live,
   * on every frame of the drag: the panel writes it and asks the view to show
   * it, and `transformEnd` is where it settles.
   */
  transform: ((to: Transform) => void) | null;
  transformEnd: (() => void) | null;
  pick: ((selection: Selection) => void) | null;
};

/**
 * A map's lists, reached by a name worked out at runtime.
 *
 * The panels address a list by its name -- 'monsters', 'props' -- which an
 * object type cannot be indexed by. document.ts holds the same cast for the
 * same reason.
 */
const listsOf = (map: MapDoc): Record<string, MapObject[] | undefined> =>
  map as unknown as Record<string, MapObject[] | undefined>;

/**
 * The editing surface: a free-flying isometric view of the map being edited,
 * with a tile cursor, a grid overlay and markers for the things that have no
 * mesh of their own (named spawns, lights, monsters).
 *
 * The map is drawn by the same buildMapView() the game uses, rebuilt whenever
 * the document changes. That is deliberately the blunt approach — a 24x24 map
 * rebuilds in well under a frame — and it means the editor can never drift out
 * of sync with how the game will actually render the map.
 *
 * It draws into the application's one Scene, alongside (but never at the same
 * time as) the game's level. Everything it owns hangs off `root`.
 */

const PAN_SPEED = 12; // tiles per second with the keyboard
const DEG_ = Math.PI / 180;
const MIN_FRUSTUM = 6;
const MAX_FRUSTUM = 60;

const SPAWN_MARKER_COLOR = 0x35d07f;
/** The map's own start, told apart from the arrival points by colour. */
const START_MARKER_COLOR = 0xffc247;

/**
 * Rendering groups. Babylon clears the depth buffer between them, so a higher
 * group is drawn over everything below it — which is what the overlays need:
 * a handle half-buried in a wall is a handle you cannot grab.
 */
const GROUP_MAP = 0;
const GROUP_OVERLAY = 1;

const clamp = (value: number, low: number, high: number) =>
  Math.min(high, Math.max(low, value));

/** How strongly the tile grid is drawn. See `buildGrid`. */
const GRID_ALPHA = 0.18;

export function createEditor({
  scene,
  camera,
  setFrustum,
  setAmbientOcclusion,
  content,
}: {
  scene: Scene;
  camera: TargetCamera;
  setFrustum: (frustum: number) => void;
  setAmbientOcclusion?: (strength: number) => void;
  content?: () => MapContent;
}) {
  let doc: MapDocument | null = null;

  /**
   * The map as it is *drawn*: the document's own lists with every prefab
   * placement turned into the objects it stands for.
   *
   * Kept here and never on the document, because it is derived. On the document
   * an undo would restore a snapshot with the children baked into it, and the
   * next rebuild would expand them again on top.
   *
   * It is also what the picking below has to be read against. The scene tags a
   * wall with its index in the list it was built from, and that list is this
   * one -- the document's is a different array the moment any prefab
   * contributes a wall.
   */
  let shown: GameMap | null = null;

  /**
   * The prefabs as the editor holds them, so one being drafted answers rather
   * than the version that was on disk when the page loaded.
   *
   * Rebuilt into a map rather than looked up by scanning: the document asks
   * this for every tile it tests, which is every tile under the pointer.
   */
  let drafts = new Map<string, Prefab>();
  const prefabOf = (id: string): Prefab | null => drafts.get(id) ?? prefabById(id);

  /**
   * The prefab placement that drew an object, if one did.
   *
   * A prefab's children are drawn and can be hit, but they are not things you
   * can select: there is nothing about a child to edit that is not the
   * prefab's. So a pick on one resolves to the single entry it came from.
   */
  function drawnBy(list: string, index: number | undefined): number | null {
    if (typeof index !== 'number') return null;
    const entry = (shown as Record<string, MapObject[]> | null)?.[list]?.[index];
    return typeof entry?.prefab === 'number' ? entry.prefab : null;
  }
  let mapView: ReturnType<typeof buildMapView> | null = null;
  /**
   * The ground, which outlives the view it is drawn in.
   *
   * Held here rather than by the map view, because the map view is thrown away
   * on every click and this is the one part of it that does not depend on
   * anything a click changes. See `retarget` in terrainLayer.ts for what has to
   * be pointed at the new view each time, and `rebuild` for why.
   */
  let terrain: TerrainLayer | null = null;
  // Kept from the last rebuild so the cursor can ask how high the ground is
  // under a tile without parsing the map again every frame.
  let world: World | null = null;
  /**
   * What has changed and has not been drawn yet.
   *
   * The view used to have one question — "does this need rebuilding?" — and one
   * answer, which was to throw the whole map away and build it again. That is
   * why a brush stroke, a slider and clicking a row in the object list all cost
   * the same: every mesh, every material and every light, gone and remade.
   *
   * A set instead, so an edit can say what it actually touched. `sync` below is
   * the only thing that reads it, once a frame, and each domain knows how to
   * bring itself up to date without disposing anything it does not have to.
   *
   * `'map'` is the one that still means everything, for the edits that genuinely
   * change everything — opening a map, resizing one — and as the fallback for a
   * domain that finds a change it cannot reconcile.
   */
  const dirty = new Set<Domain>();
  /** What the grid was last drawn for, so it is only redrawn when that changes. */
  let gridSize = { cols: 0, rows: 0 };
  /**
   * The rectangle the view is cut down to, or null for the whole map.
   *
   * A map made of chunks is edited a chunk at a time — a chunk is a piece you
   * will walk on its own, so it is shown on its own. The cut is four clip
   * planes rather than a second, cropped copy of the map: the document stays
   * one whole grid, every tile keeps the coordinates it had, and nothing
   * downstream — picking, painting, the marker positions, saving — has to know
   * that only part of it is on screen. What changes is what the camera can see
   * and what the pointer is allowed to touch.
   */
  let focus: Rect | null = null;

  let frustum = 22;
  const center = new Vector3();

  /**
   * What the panel has switched off, by `list:index`.
   *
   * A view concern, not a map one: nothing here is written to the file, and the
   * game never sees it. Re-applied after every rebuild because a rebuild makes
   * new nodes, which know nothing about what was hidden before them.
   */
  let hidden = new Set<string>();

  /** Everything the editor draws. Switched off wholesale when it is closed. */
  const root = new TransformNode('editor', scene);

  const groundPlane = new Plane(0, 1, 0, 0);
  /** What the pointer is over right now, for the tools that act on things. */
  let hoverPick: Pick | null = null;

  let hover: Cell | null = null;
  /** The mouse button currently held: 0 paint, 2 erase, null for neither. */
  let painting: number | null = null;
  /** Whether a drag fills in the cells between pointer samples. */
  let interpolate = false; // the mouse button currently held: 0 paint, 2 erase
  // The transform listeners are the gizmo's: the editor works out where a
  // handle was dragged to, and the panel decides what that means.
  const listeners: Listeners = {
    paint: null,
    erase: null,
    hover: null,
    release: null,
    transform: null,
    transformEnd: null,
    pick: null,
  };

  // Overlays live under their own node so a rebuild can drop the map meshes
  // without touching the cursor or the grid.
  const overlay = new TransformNode('overlay', scene);
  overlay.parent = root;

  /** Drawn over the map rather than into it. */
  function overlayMaterial(name: string, color: number, alpha = 1, group = GROUP_OVERLAY) {
    const material = unlit(name, scene, { color, alpha });
    material.disableDepthWrite = group !== GROUP_MAP;
    return material;
  }

  /**
   * A flat colour for a marker, made once and kept.
   *
   * The markers are drawn again whenever the ground moves, which while the
   * terrain brush is being dragged is every frame. They used to bring their
   * materials with them and take them away again — a dozen shaders looked up,
   * registered on the scene and unregistered, sixty times a second, to end up
   * with the same dozen colours. The meshes are cheap; this was not.
   *
   * Keyed by what it looks like rather than by what wears it, so two lights of
   * one colour share, and a light that changes colour gets a different one
   * rather than a stale one.
   */
  const markerMaterials = new Map<string, Material>();
  /** The cage's own, which is the one marker material that is not flat. */
  let cageMaterialOnce: Material | null = null;
  function markerMaterial(color: number, alpha = 1): Material {
    const key = `${color}:${alpha}`;
    const held = markerMaterials.get(key);
    if (held) return held;
    const made = unlit(`marker:${key}`, scene, { color, alpha });
    markerMaterials.set(key, made);
    return made;
  }

  const cursor = MeshBuilder.CreateBox('cursor', { width: 1, height: 0.06, depth: 1 }, scene);
  cursor.material = overlayMaterial('cursor', 0xffffff, 0.5);
  cursor.renderingGroupId = GROUP_OVERLAY;
  cursor.isPickable = false;
  cursor.parent = overlay;

  /**
   * What Select and Delete are actually pointing at.
   *
   * A flat square on the floor is the right cursor for painting, because
   * painting is about a tile. Picking is not: it is about a *thing*, and the
   * thing may be a monster standing on that tile, a wall filling it, or one
   * slab of several stacked on it. Drawing a square under all three says the
   * same thing about each, which is how you end up deleting the wrong one.
   *
   * So the picking tools draw a box around whatever they would take, at its
   * real size and height, and the flat square is kept only for when there is
   * nothing there — you should still be able to see where the pointer is.
   */
  const highlight = MeshBuilder.CreateBox('highlight', { size: 1 }, scene);
  const highlightMaterial = overlayMaterial('highlight', 0xffffff, 0.22);
  highlight.material = highlightMaterial;
  highlight.renderingGroupId = GROUP_OVERLAY;
  highlight.isPickable = false;
  highlight.parent = overlay;
  // Babylon draws the outline itself from the box's own edges, so there is no
  // second mesh to keep in step with the first.
  highlight.enableEdgesRendering();
  highlight.edgesWidth = 2;
  highlight.setEnabled(false);

  /** White to say "this is what you would pick", red to say "this would go". */
  const SELECT_COLOR = 0xffffff;
  const DELETE_COLOR = 0xe5484d;

  /**
   * How big a box to draw around each kind of object, and how far above the
   * ground it starts. Approximations of what the map view actually draws — near
   * enough to say "this one", which is all a highlight has to do.
   */
  type ObjectBounds = { size: [number, number, number]; base: number };

  /** What a list nobody gave a box to is drawn as: a tile's worth, on the floor. */
  const DEFAULT_BOUNDS: ObjectBounds = { size: [1, 1, 1], base: 0 };

  const OBJECT_BOUNDS: Record<string, ObjectBounds> = {
    lights: { size: [0.5, 0.5, 0.5], base: 0.85 },
    vfx: { size: [0.5, 0.5, 0.5], base: 0.2 },
    // Picked by its corner like everything else; the highlight marks the
    // anchor rather than the whole rectangle, which the outline already shows.
    chunks: { size: [0.9, 0.2, 0.9], base: 0 },
    spawns: { size: [0.6, 0.7, 0.6], base: 0.55 },
    // A tile's worth, which is what an object standing on one occupies. Only
    // reached for one drawn as an instance, where there is no single mesh to
    // measure — see `pickedBox`.
    props: DEFAULT_BOUNDS,
    prefabs: DEFAULT_BOUNDS,
  };

  /** The box for a list, falling back to a plain tile for one with no entry. */
  const boundsOf = (list: string): ObjectBounds => OBJECT_BOUNDS[list] ?? DEFAULT_BOUNDS;

  let cursorMode: CursorMode = 'select';

  /**
   * Where the handles stand: a node the gizmos hold, stood where the selected
   * thing is.
   *
   * Never the thing itself. An object drawn as one instance among many has no
   * node, and a prefab is several -- so the handles move this, and each frame
   * of the drag the editor reads it back as a transform and shows the thing
   * there. See gizmos.ts.
   */
  const pivot = new TransformNode('pivot', scene);
  pivot.parent = overlay;
  /**
   * How the pivot relates to the entry it stands for, taken when it is stood:
   * the offset from the entry's position to its middle, and the ground under
   * it. Read back off the pivot after a drag to get the entry's numbers.
   */
  let grab = { dx: 0.5, dz: 0.5, ground: 0 };
  let gizmoMode: GizmoMode | null = null;
  let snap: Snap = { on: true, move: 0.5, turn: 15, scale: 0.25 };
  /** How the ghost, and so the next thing put down, is turned. Degrees. */
  let placeTurn = 0;

  const gizmos = createGizmos(scene, {
    onStart: () => {},
    onChange: () => {
      const entry = selectedEntry();
      if (!entry) return;
      const round = (value: number) => Math.round(value * 100) / 100;
      listeners.transform?.({
        gx: round(pivot.position.x - grab.dx),
        gy: round(pivot.position.z - grab.dz),
        lift: round(pivot.position.y - grab.ground),
        rotX: round(wrapDeg(pivot.rotation.x / DEG_)),
        rot: round(wrapDeg(pivot.rotation.y / DEG_)),
        rotZ: round(wrapDeg(pivot.rotation.z / DEG_)),
        scaleX: round(pivot.scaling.x),
        scaleY: round(pivot.scaling.y),
        scaleZ: round(pivot.scaling.z),
      });
    },
    onEnd: () => listeners.transformEnd?.(),
  });

  /** Stand the pivot on the selected thing, as it is in the document now. */
  function standPivot(): void {
    const entry = selectedEntry();
    if (!entry || !selection) return;
    const middle = footprintOf(selection.list, entry);
    const ground = (world?.heightAt(middle.x, middle.z) ?? 0) * LEVEL_H;
    const lift = Number((entry as { lift?: unknown }).lift ?? 0) || 0;
    pivot.position.set(middle.x, ground + lift, middle.z);
    pivot.rotation.copyFrom(eulerOf(entry as Transform));
    pivot.scaling.copyFrom(scaleOf(entry as Transform));
    grab = { dx: middle.x - entry.gx, dz: middle.z - entry.gy, ground };
  }

  // Nothing is drawn until a map is opened.
  root.setEnabled(false);

  // Ghost of whatever the active brush would drop here, so a click is never a
  // guess. Built once per brush and cached: switching brushes is frequent.
  const previews = new Map<string, TransformNode | null>();
  let preview: TransformNode | null = null;
  /** What the ghost hangs off, so it can be turned about its middle. */
  const previewPivot = new TransformNode('previewPivot', scene);
  previewPivot.parent = overlay;
  let previewKind: string | null = null;
  // How high the ghost floats. A ramp drawn at level 2 has to be previewed
  // where it would actually land, not on the ground under it.
  let previewY = 0;

  let grid: LinesMesh | null = null;
  /** Whether the tile lines are drawn. Kept across rebuilds, not per map. */
  let gridShown = true;
  let markers: TransformNode | null = null;
  /** The outline round the selection, so a drag can carry it along. */
  let selectionCage: TransformNode | null = null;
  // { list, index } for the indexed lists, { list: "spawns", key } for a named
  // spawn, or null when nothing is selected.
  let selection: Selection = null;

  /**
   * How to slide each thing on the map, by `list:index`.
   *
   * A drag used to ask the view to find what it had just moved, by walking
   * every node under the map and comparing tags. That walk answered "no" far
   * more often than it answered at all -- a monster is drawn as a marker rather
   * than as part of the map, a prefab's children carry their own list and not
   * the prefab's, and an object drawn as thin instances has no node to move --
   * and every "no" was a full rebuild of the map, on every pointer move. That
   * is what made dragging cost fifteen frames a second and made everything
   * around the thing you were dragging blink: a mesh built this frame is a mesh
   * whose material has to be found ready again before it can be drawn at all.
   *
   * So it is an index instead, built once with the view. A drag is a lookup and
   * a handful of additions, and nothing is created or destroyed until you let
   * go.
   *
   * Null when it has to be built again, which is whenever the view is.
   */
  let movers: Map<string, ((dx: number, dz: number) => void)[]> | null = null;

  /**
   * Where a marker-drawn thing was last shown, so a live edit can slide it by
   * the difference. Reset with the view, which stands everything afresh.
   */
  let slid: { key: string; gx: number; gy: number } | null = null;

  /** Slide the selection's markers to where its entry now says. */
  function slideMarkers(entry: Placed): void {
    if (!selection) return;
    const key = `${selection.list}:${selection.key ?? selection.index}`;
    const from = slid?.key === key ? slid : null;
    if (!from) {
      // First move of this thing since the view was built: it is drawn where
      // the document said then, which is where the pivot was stood from.
      slid = { key, gx: pivotEntryX(), gy: pivotEntryZ() };
    }
    const dx = entry.gx - (slid?.gx ?? entry.gx);
    const dz = entry.gy - (slid?.gy ?? entry.gy);
    if (dx || dz) {
      movers ??= buildMovers();
      const at = selection.key ?? selection.index;
      for (const move of (at === undefined ? [] : movers.get(`${selection.list}:${at}`) ?? [])) {
        move(dx, dz);
      }
      restamp();
    }
    slid = { key, gx: entry.gx, gy: entry.gy };
  }

  /** The entry position the pivot was last stood from. */
  const pivotEntryX = () => pivot.position.x - grab.dx;
  const pivotEntryZ = () => pivot.position.z - grab.dz;

  /** The map entry the selection points at, or null. */
  function selectedEntry(): Placed | null {
    if (!selection || !doc) return null;
    return entryOf(doc.map, selection);
  }

  /** The entry a selection names, in whichever list it names. */
  function entryOf(map: MapDoc, at: NonNullable<Selection>): Placed | null {
    if (at.list === 'spawns') return at.key === undefined ? null : (map.spawns[at.key] ?? null);
    if (at.index === undefined) return null;
    return listsOf(map)[at.list]?.[at.index] ?? null;
  }

  /** A ray from the camera through wherever the pointer is. */
  const pickingRay = (event: PointerEvent) => {
    const rect = scene.getEngine().getRenderingCanvasClientRect();
    if (!rect) throw new Error('The editor is drawing into a scene with no canvas');
    return scene.createPickingRay(
      event.clientX - rect.left,
      event.clientY - rect.top,
      Matrix.Identity(),
      camera,
    );
  };

  /**
   * One ray against the drawn map.
   *
   * A pointer move asks the scene two questions -- which tile is under it, and
   * which object -- and they used to be two casts of the same ray through the
   * same predicate. On instanced ground a cast walks every tile, so that was
   * the whole map swept twice per mouse move, on the input path. The answer to
   * both is in one hit, so it is taken once and handed to each.
   */
  const castAt = (ray: ReturnType<typeof pickingRay>): PickingInfo | null =>
    mapView ? scene.pickWithRay(ray, isMapMesh) : null;

  /** Only the map itself answers a pick — never the cursor, grid or handles. */
  const isMapMesh = (mesh: AbstractMesh) =>
    mesh.isPickable && mesh.isEnabled() && !mesh.isDescendantOf(overlay);

  /**
   * What the pointer is actually over, or null.
   *
   * Babylon's picking answers this directly, and the answer is the thing the
   * ray hit. Working out which *tile* the hit was over and then asking what was
   * on that tile is a longer route to a worse answer, because a tall thing is
   * drawn above the tile it stands on.
   *
   * Meshes carry `metadata.pick` saying which map entry they belong to; the
   * walk up the parents is so a torch's flame answers for the torch. A wall is
   * one thin instance per block, so the instance index is looked through to the
   * wall it belongs to.
   */
  function pickAt(event: PointerEvent, hit = castAt(pickingRay(event))): Pick | null {
    if (!mapView || !doc) return null;
    if (!hit?.hit) return null;

    for (let node: Node | null = hit.pickedMesh; node; node = node.parent) {
      const pick = pickOf(node);
      // Only a transform answers, because the caller measures what it found.
      if (!pick || !(node instanceof TransformNode)) continue;
      if (pick.instances) {
        const index = pick.instances[hit.thinInstanceIndex];
        if (index === undefined) return null;
        const owner = drawnBy(pick.list, index);
        return owner === null
          ? { list: pick.list, index, object: node, hit }
          : { list: 'prefabs', index: owner, object: node, hit };
      }
      const owner = drawnBy(pick.list, pick.index);
      return owner === null
        ? { ...pick, object: node, hit }
        : { list: 'prefabs', index: owner, object: node, hit };
    }
    return null;
  }

  /**
   * A box around exactly what was picked, in world space.
   *
   * Measured off the geometry rather than looked up in a table of guessed
   * sizes: the outline is then the thing's real extent, and it cannot drift
   * when the thing it is drawn around changes size.
   */
  function pickedBox(pick: Pick | null): Box | null {
    if (!pick || !doc) return null;

    // One mesh standing in for many: its bounds cover every instance of it, so
    // measuring the geometry would draw a cage round the whole row. Where this
    // one entry stands is the answer instead.
    const many = (pick.object as { thinInstanceCount?: number }).thinInstanceCount;
    if (many) {
      const lists = doc.map as unknown as Record<string, { gx: number; gy: number }[]>;
      const entry = pick.index === undefined ? null : lists[pick.list]?.[pick.index];
      return entry ? boundsFor(pick.list, entry) : null;
    }

    const { min, max } = pick.object.getHierarchyBoundingVectors(true);
    return {
      x: (min.x + max.x) / 2,
      y: (min.y + max.y) / 2,
      z: (min.z + max.z) / 2,
      w: Math.max(max.x - min.x, 0.3),
      h: Math.max(max.y - min.y, 0.3),
      d: Math.max(max.z - min.z, 0.3),
    };
  }

  /**
   * The box that fits what is standing on a tile.
   *
   * Shared by the cage that marks the selection and the highlight that follows
   * the pointer, because they are answering the same question.
   */
  function boundsFor(list: string, at: Placed): Box {
    const spec = boundsOf(list);
    const [, own] = spec.size;
    const h = own;
    const { x, z, w, d } = footprintOf(list, at);
    // The top of the tile's own column, which is where anything standing on it
    // rests — and on a ramp tile it is the high end, so nothing is drawn sunk
    // into the slope.
    const surface = (world?.levelAt(Math.floor(at.gx), Math.floor(at.gy)) ?? 0) * LEVEL_H;
    const lift = Number((at as { lift?: unknown }).lift ?? 0) || 0;
    return { x, y: surface + lift + spec.base + h / 2, z, w, h, d };
  }

  /**
   * Where a thing's middle is on the ground, and how much ground it covers.
   *
   * Most things are a tile's worth, centred on the tile. A prefab is the box
   * its children cover, and its position is that box's corner -- so its middle,
   * where the cage and the handles belong, is half the box along.
   */
  function footprintOf(list: string, at: Placed): { x: number; z: number; w: number; d: number } {
    if (list === 'prefabs' && doc) {
      const box = doc.prefabBox(at as PlacedPrefab);
      const w = Math.max(1, box.w);
      const d = Math.max(1, box.h);
      return { x: box.gx + w / 2, z: box.gy + d / 2, w, d };
    }
    const [w, , d] = boundsOf(list).size;
    return { x: at.gx + 0.5, z: at.gy + 0.5, w, d };
  }

  /** How tall everything standing on a tile reaches, above the ground. */
  function stackHeight(gx: number, gy: number): number {
    if (!doc) return 0;
    const objects = doc
      .objectsAt(gx, gy)
      .map(({ list }) => boundsOf(list));
    const tallest = objects.reduce((top, b) => Math.max(top, b.base + b.size[1]), 0);
    return tallest;
  }

  /**
   * The box to draw around what Select or Erase is pointing at, or null when
   * there is nothing for that tool to act on.
   *
   * Each tool highlights exactly what its click would take. Select picks one
   * object, so it outlines that object. Erase clears the whole tile, so it
   * outlines the whole tile's contents. Neither draws anything over bare
   * ground, because neither does anything to bare ground.
   */
  function cursorTarget(): Target | null {
    if (!doc || !world) return null;

    // Terrain mode points at ground rather than at things standing on it, so
    // what it outlines is the block under the cursor: the top of that column,
    // one level tall. Bare ground *is* the subject here, which is why this one
    // draws where Select would draw nothing.
    if (cursorMode === 'terrain') {
      if (!hover) return null;
      const level = world.levelAt(hover.gx, hover.gy) ?? 0;
      return {
        x: hover.gx + 0.5,
        y: (level - 0.5) * LEVEL_H,
        z: hover.gy + 0.5,
        w: 1,
        h: LEVEL_H,
        d: 1,
        color: SELECT_COLOR,
        // Against the ground rather than over it: see MARK_HUG.
        hug: true,
      };
    }

    if (cursorMode !== 'select' && cursorMode !== 'erase') return null;
    if (cursorMode === 'erase' && !hover) return null;
    const { gx, gy } = hover ?? { gx: 0, gy: 0 };

    const color = cursorMode === 'erase' ? DELETE_COLOR : SELECT_COLOR;

    if (cursorMode === 'select') {
      // Whatever the ray hit, outlined at its own size. Bare ground gets no
      // cursor at all under this tool: a square on an empty tile says "you
      // could pick this", which is exactly what you cannot do.
      const box = pickedBox(hoverPick);
      return box ? { ...box, color } : null;
    }

    // The top of this tile's column, which is where anything standing on it
    // rests.
    const surface = (world.levelAt(gx, gy) ?? 0) * LEVEL_H;

    // Erase clears the whole tile in one click, so it highlights the whole
    // tile: everything standing on it, from the ground to the top of the
    // tallest thing. A box round one object would under-promise what goes.
    const height = stackHeight(gx, gy);
    if (height <= 0) return null;
    return { x: gx + 0.5, y: surface + height / 2, z: gy + 0.5, w: 1, h: height, d: 1, color };
  }

  /**
   * A translucent stand-in for one brush, positioned at the tile origin so the
   * caller only has to move the group. Returns null for brushes whose result is
   * already described by the tile cursor itself (floor, spawn).
   */
  function buildPreview(kind: string): TransformNode | null {
    const group = new TransformNode(`preview-${kind}`, scene);
    group.parent = previewPivot;

    const ghost = (color: number, alpha = 0.5) => {
      const material = unlit(`ghost-${kind}`, scene, { color, alpha });
      // A ghost never occludes the map underneath it.
      material.disableDepthWrite = true;
      return material;
    };

    const place = (mesh: Mesh, material: Material, x: number, y: number, z: number) => {
      mesh.material = material;
      mesh.position.set(x, y, z);
      mesh.isPickable = false;
      mesh.parent = group;
      return mesh;
    };

    // The ground brush is one brush per level, so its ghost is too: `ground:3`
    // stands three levels tall, which is the only way to see how high a click
    // is about to raise a tile before making it. Level 0 draws nothing, because
    // the tile cursor already says where the ground would come back down to.
    const ground = /^ground:(\d+)$/.exec(kind);
    if (ground) {
      const height = Number(ground[1]) * LEVEL_H;
      if (height <= 0) {
        group.dispose();
        return null;
      }
      place(
        MeshBuilder.CreateBox('ground', { width: 1, height, depth: 1 }, scene),
        ghost(0x9fc46a),
        0.5,
        height / 2,
        0.5,
      );
      return group;
    }

    switch (kind) {
      case 'rampE':
      case 'rampW':
      case 'rampS':
      case 'rampN':
        place(
          MeshBuilder.CreateBox('ramp', { width: 1, height: 0.5, depth: 1 }, scene),
          ghost(0x9fc46a),
          0.5,
          0.25,
          0.5,
        );
        break;

      case 'light': {
        const material = ghost(0xffb46a, 0.75);
        place(
          MeshBuilder.CreateSphere('bulb', { diameter: 0.32, segments: 8 }, scene),
          material,
          0.5,
          1.1,
          0.5,
        );
        place(
          MeshBuilder.CreateCylinder('stem', { diameter: 0.03, height: 1.1, tessellation: 5 }, scene),
          material,
          0.5,
          0.55,
          0.5,
        );
        break;
      }

      case 'vfx':
        place(
          MeshBuilder.CreateSphere('spark', { diameter: 0.28, segments: 6 }, scene),
          ghost(0xffd9a0, 0.7),
          0.5,
          0.45,
          0.5,
        );
        break;

      // One shape for every monster there will ever be. Which one it is, is
      // chosen in the inspector after it is down, so the ghost cannot know —
      // and a preview per kind would be this game's cast in the editor again.
      case 'monster':
        place(
          MeshBuilder.CreateCapsule('monster', { radius: 0.24, height: 0.88 }, scene),
          ghost(0xb4553f, 0.6),
          0.5,
          0.45,
          0.5,
        );
        break;

      default:
        group.dispose();
        return null;
    }

    return group;
  }

  /** Tile lines for the whole grid, so empty floor still reads as a grid. */
  function buildGrid(cols: number, rows: number): LinesMesh {
    const lines: Vector3[][] = [];
    for (let x = 0; x <= cols; x++) lines.push([new Vector3(x, 0, 0), new Vector3(x, 0, rows)]);
    for (let y = 0; y <= rows; y++) lines.push([new Vector3(0, 0, y), new Vector3(cols, 0, y)]);

    const mesh = MeshBuilder.CreateLineSystem('grid', { lines }, scene);
    mesh.color = Color3.Black();
    /*
     * Faint on purpose. The grid is there to be measured against when you go
     * looking for it, not to be read: at full strength the map is seen through
     * a mesh of lines, and every one of them is one more edge the eye tries to
     * make sense of.
     *
     * Both, and neither alone does anything. A line mesh's `alpha` is what its
     * shader writes out, and the material's is what decides the mesh belongs in
     * the transparent pass at all — so `mesh.alpha` by itself is a value that
     * is computed and then thrown away against an opaque blend, which is why
     * this stood at 0.05 for a long time and looked like 1.
     */
    mesh.alpha = GRID_ALPHA;
    if (mesh.material) mesh.material.alpha = GRID_ALPHA;
    mesh.position.y = 0.015;
    mesh.isPickable = false;
    mesh.parent = overlay;
    return mesh;
  }

  /**
   * Markers for the things the map view does not draw, because the game creates
   * them at level load rather than as part of the map: named arrival points,
   * lights and monster spawns.
   */
  /**
   * Cells outlined on the map, in named layers that know nothing about each
   * other: `brush` follows the cursor, `drag` is the rectangle being pulled
   * out. Each is set independently, and none of them touches the document — so
   * none of them costs a rebuild.
   */
  type OverlayLook = { color: number; alpha: number };

  /** What an unnamed overlay looks like: the brush's own plain white. */
  const BRUSH_LAYER: OverlayLook = { color: 0xffffff, alpha: 0.2 };

  const OVERLAY_LAYERS: Record<string, OverlayLook> = {
    brush: BRUSH_LAYER,
    drag: { color: 0x8be9fd, alpha: 0.28 },
    selection: { color: 0xffc247, alpha: 0.26 },
    debug: { color: 0xff5ad2, alpha: 0.3 },
  };
  const cellLayers = new Map<string, { mesh: Mesh }>();

  // Drawn into the map's own depth buffer rather than over it. Everything else
  // the editor outlines is a *thing* you may need to see through the ground to
  // find; a cell is the ground, and an outline showing you its far edges
  // through itself reads as an x-ray of a solid object.
  /**
   * How much bigger than the cell its outline is drawn.
   *
   * The two are the same box, so at the same size they fight over every pixel.
   * A hair larger and the outline sits just outside the surface: the near edges
   * are in front of it and draw, the far ones are behind it and do not.
   */
  const MARK_HUG = 1.006;

  function cellLayer(name: string): { mesh: Mesh } {
    let layer = cellLayers.get(name);
    if (layer) return layer;
    const look = OVERLAY_LAYERS[name] ?? BRUSH_LAYER;
    const mesh = MeshBuilder.CreateBox(`cells-${name}`, { size: 1 }, scene);
    mesh.material = overlayMaterial(`cells-${name}`, look.color, look.alpha, GROUP_MAP);
    mesh.renderingGroupId = GROUP_MAP;
    mesh.isPickable = false;
    mesh.parent = overlay;
    mesh.setEnabled(false);
    layer = { mesh };
    cellLayers.set(name, layer);
    return layer;
  }

  /**
   * Outline a set of cells.
   *
   * One box with a thin instance per cell, not one mesh per cell. A selection
   * can be the whole map, and four thousand meshes each with its own edge
   * renderer is a frame's worth of work to say "these cells".
   *
   * @param name which layer
   * @param cells indices into `grid`, or tiles
   * @param grid the terrain grid, when `cells` are indices
   */
  function setCellOverlay(
    name: string,
    cells: readonly (number | Cell)[] = [],
    grid: TerrainGrid | null = null,
  ): void {
    const layer = cellLayer(name);
    if (!cells.length) {
      layer.mesh.setEnabled(false);
      return;
    }

    const matrices = new Float32Array(cells.length * 16);
    cells.forEach((cell, n) => {
      const gx = typeof cell === 'number' ? cell % (grid?.cols ?? 1) : cell.gx;
      const gy = typeof cell === 'number' ? Math.floor(cell / (grid?.cols ?? 1)) : cell.gy;
      const level = world?.levelAt(gx, gy) ?? 0;
      Matrix.Compose(
        new Vector3(MARK_HUG, LEVEL_H * MARK_HUG, MARK_HUG),
        Quaternion.Identity(),
        new Vector3(gx + 0.5, (level - 0.5) * LEVEL_H, gy + 0.5),
      ).copyToArray(matrices, n * 16);
    });
    layer.mesh.thinInstanceSetBuffer('matrix', matrices, 16);
    layer.mesh.setEnabled(true);
  }

  /**
   * How high the ground is under a tile, for the things that stand on it.
   *
   * On top of whatever is on the tile rather than on the tile itself, so a
   * start put on a stack of crates is drawn on the crates rather than buried
   * in them.
   */
  const footing = (gx: number, gy: number) =>
    (world?.standAt(gx + 0.5, gy + 0.5) ?? 0) * LEVEL_H;

  /**
   * The markers that follow the ground, and how far above it each one floats.
   *
   * Kept so a terrain edit can move them rather than draw them all again. Most
   * markers are not in here: a light hangs at its own height and a monster
   * stands at a fixed one, so the brush passing under them changes nothing.
   */
  let standing: { node: TransformNode; gx: number; gy: number; lift: number }[] = [];

  /** Put the ground-standing markers back on the ground. See `standing`. */
  function restand(): void {
    for (const one of standing) one.node.position.y = footing(one.gx, one.gy) + one.lift;
    // The cage is sized from a table and stood on the terrain, so raising the
    // ground under the selection moves it and nothing else about it.
    const at = doc ? selectedTile(doc.map) : null;
    if (selectionCage && selection && at) {
      selectionCage.position.y = boundsFor(selection.list, at).y;
    }
  }

  function buildMarkers(map: MapDoc): TransformNode {
    const group = new TransformNode('markers', scene);
    group.parent = overlay;
    selectionCage = null;
    standing = [];

    /** Stand a marker on the ground, and remember that it is standing on it. */
    const stand = (node: TransformNode, gx: number, gy: number, lift: number): void => {
      node.position.y = footing(gx, gy) + lift;
      standing.push({ node, gx, gy, lift });
    };

    // Markers stand in the map and are occluded by it, the way the objects
    // they stand for would be. Only the cursor and the handles float above.
    const marker = (mesh: Mesh, material: Material, pick?: PickTag): Mesh => {
      mesh.material = material;
      mesh.parent = group;
      return pick ? tagPick(mesh, pick) : mesh;
    };


    // Where the player comes up. It is a character in the terrain, which parses
    // to ordinary ground — so without a marker the one tile that decides where
    // the map begins is the one tile you cannot see.
    const start = map.spawns.default ?? null;
    if (start) {
      const ring = MeshBuilder.CreateTorus(
        'start',
        { diameter: 0.8, thickness: 0.12, tessellation: 20 },
        scene,
      );
      ring.position.set(start.gx + 0.5, 0, start.gy + 0.5);
      stand(ring, start.gx, start.gy, 0.08);
      marker(ring, markerMaterial(START_MARKER_COLOR));
      const pin = MeshBuilder.CreateCylinder(
        'start',
        { diameterTop: 0, diameterBottom: 0.34, height: 0.55, tessellation: 4 },
        scene,
      );
      pin.position.set(start.gx + 0.5, 0, start.gy + 0.5);
      stand(pin, start.gx, start.gy, 0.5);
      marker(pin, markerMaterial(START_MARKER_COLOR));
    }

    for (const [key, spawn] of Object.entries(map.spawns)) {
      const cone = MeshBuilder.CreateCylinder(
        'spawn',
        { diameterTop: 0.44, diameterBottom: 0, height: 0.5, tessellation: 4 },
        scene,
      );
      cone.position.set(spawn.gx + 0.5, 0, spawn.gy + 0.5);
      stand(cone, spawn.gx, spawn.gy, 0.9);
      marker(cone, markerMaterial(SPAWN_MARKER_COLOR), { list: 'spawns', key });
    }

    // Lights: a bulb at the light's own height with a stem down to its tile,
    // plus a ground ring showing how far a local light actually reaches.
    (map.lights ?? []).forEach((raw, index) => {
      const def = normalizeLight(raw);
      const selected = selection?.list === 'lights' && selection.index === index;
      const material = markerMaterial(selected ? 0xffffff : (def.color ?? LIGHT_FIELDS.color.default));

      const height =
        def.type === 'directional' || def.type === 'hemisphere' ? 2.6 : (def.height ?? 2.6);
      const x = def.gx + 0.5;
      const z = def.gy + 0.5;

      // Bulb and pole under one node, so the thing a ray hits is the light
      // rather than one of the two shapes that draw it.
      const lamp = new TransformNode(`lamp${index}`, scene);
      lamp.parent = group;
      tagPick(lamp, { list: 'lights', index });

      const bulb = MeshBuilder.CreateSphere('bulb', { diameter: 0.32, segments: 8 }, scene);
      bulb.position.set(x, height, z);
      bulb.scaling.setAll(selected ? 1.5 : 1);
      marker(bulb, material).parent = lamp;

      const pole = MeshBuilder.CreateCylinder(
        'pole',
        { diameter: 0.03, height: 1, tessellation: 5 },
        scene,
      );
      pole.position.set(x, height / 2, z);
      pole.scaling.y = height;
      marker(pole, material).parent = lamp;

      if (def.type === 'point' || def.type === 'spot') {
        const radius = Math.max(def.distance ?? 0, 0.5);
        const ring = MeshBuilder.CreateTorus(
          'reach',
          { diameter: radius * 2 - 0.06, thickness: 0.06, tessellation: 48 },
          scene,
        );
        ring.position.set(x, 0.03, z);
        ring.isPickable = false;
        marker(ring, material);
      }
    });

    // Placed effects. The particles themselves are the map view's and cannot
    // be clicked, so this is the handle: a small bead standing where they come
    // out of, which is the thing you actually want to grab.
    (map.vfx ?? []).forEach((entry, index) => {
      const selected = selection?.list === 'vfx' && selection.index === index;
      const bead = MeshBuilder.CreateSphere('vfxMarker', { diameter: 0.26, segments: 6 }, scene);
      bead.position.set(entry.gx + 0.5, 0.45, entry.gy + 0.5);
      bead.scaling.setAll(selected ? 1.6 : 1);
      marker(bead, markerMaterial(0xffd9a0, 0.9), { list: 'vfx', index });
    });

    // A cage around the selected object, so a row picked in the panel is
    // findable on a map with a hundred things on it. Sized to the thing rather
    // than to a fixed box: on a four-block wall a waist-high outline points at
    // the wrong part of what you have selected.
    const at = selectedTile(map);
    if (at && selection) {
      const box = boundsFor(selection.list, at);
      const cage = MeshBuilder.CreateBox(
        'cage',
        { width: box.w + 0.02, height: box.h + 0.02, depth: box.d + 0.02 },
        scene,
      );
      cage.material = cageMaterialOnce ??= overlayMaterial('cage', 0x8be9fd, 0);
      cage.position.set(box.x, box.y, box.z);
      cage.renderingGroupId = GROUP_OVERLAY;
      cage.isPickable = false;
      cage.parent = group;
      // Only the wireframe: the fill is fully transparent, so what shows is the
      // outline Babylon draws round it.
      cage.enableEdgesRendering();
      cage.edgesWidth = 3;
      cage.edgesColor = new Color4(0.545, 0.914, 0.992, 1);
      selectionCage = cage;
    }

    return group;
  }

  /**
   * Work out how to slide everything that is drawn. See `movers`.
   *
   * Only the topmost tagged node of each thing is registered. A model's meshes
   * carry their group's tag as well -- a pick walks up the tree, so tagging the
   * leaves is belt and braces -- and moving a node *and* its children would
   * move the object twice as far as the pointer went.
   *
   * A prefab's children answer to the prefab as well as to themselves, because
   * a prefab is what you can select and its children are what is drawn.
   */
  function buildMovers(): Map<string, ((dx: number, dz: number) => void)[]> {
    const found = new Map<string, ((dx: number, dz: number) => void)[]>();
    const add = (key: string, move: (dx: number, dz: number) => void): void => {
      const held = found.get(key);
      if (held) held.push(move);
      else found.set(key, [move]);
    };

    /** Register this node if it stands for something, else look inside it. */
    const walk = (node: Node): void => {
      const pick = pickOf(node);
      const at = pick ? (pick.key ?? pick.index) : undefined;
      if (pick && at !== undefined && !pick.instances && node instanceof TransformNode) {
        const move = (dx: number, dz: number): void => {
          node.position.x += dx;
          node.position.z += dz;
        };
        add(`${pick.list}:${at}`, move);
        // A prefab's objects are stood again outright by a live edit -- see
        // `previewTransform` -- so they are kept apart from the markers that
        // can only slide, or a preview would stand them and then slide them.
        const owner = drawnBy(pick.list, pick.index);
        if (owner !== null) add(`prefabs:${owner}${pick.list === 'props' ? ':props' : ''}`, move);
        // Whatever hangs off it goes with it, so there is nothing below to
        // register and registering it would move it twice.
        return;
      }
      for (const child of node.getChildren()) walk(child);
    };

    if (mapView) for (const child of mapView.root.getChildren()) walk(child);
    // The markers are how a monster, a light or an effect is drawn at all in
    // the editor, so a drag that did not carry them moved nothing you could
    // see.
    if (markers) for (const child of markers.getChildren()) walk(child);

    // An object drawn as one instance among many has no node. The runtime that
    // made that decision is the one that knows where its matrix is.
    const view = mapView;
    if (view) {
      // `shown`, not the document: a prefab's objects are drawn too, and it is
      // the expanded list the view was built from that these indices are into.
      (shown?.props ?? []).forEach((_, index) => {
        const move = (dx: number, dz: number): void => {
          view.moveProp(index, dx, 0, dz);
        };
        // Registered blind: `moveProp` says no for a placement with a node of
        // its own, which has already registered one above. Asking first would
        // mean this file knowing which objects were worth instancing.
        add(`props:${index}`, move);
        const owner = drawnBy('props', index);
        if (owner !== null) add(`prefabs:${owner}:props`, move);
      });
    }

    // An effect is attached at a point and told to follow it: a marker slid
    // without its fire would be a lie about where the fire is.
    for (const one of mapView?.vfx ?? []) {
      const move = (dx: number, dz: number): void => {
        one.at.x += dx;
        one.at.z += dz;
        one.handle.follow(one.at);
      };
      add(`vfx:${one.index}`, move);
      const owner = drawnBy('vfx', one.index);
      if (owner !== null) add(`prefabs:${owner}`, move);
    }

    // A light is not a node in the tree either: it is a Babylon light with a
    // position of its own, and a hemisphere light has not even got that.
    (mapView?.lights ?? []).forEach((entry, index) => {
      const at = (entry.light as { position?: Vector3 }).position;
      if (!at) return;
      add(`lights:${index}`, (dx, dz) => {
        at.x += dx;
        at.z += dz;
      });
    });

    return found;
  }

  /** Where the current selection sits on the grid, if it still exists. */
  function selectedTile(map: MapDoc): Placed | null {
    return selection ? entryOf(map, selection) : null;
  }

  /** Rebuild the map meshes from the current document. */
  /**
   * Cut the scene down to the focused rectangle.
   *
   * Babylon discards whatever falls on the positive side of a clip plane, so
   * each edge is a plane facing outwards: four of them leave the rectangle and
   * nothing else. The grid and the markers are cut by the same planes, since
   * they are meshes in the same scene — which is what makes a chunk look like a
   * little map floating on its own rather than a highlighted part of a big one.
   */
  function applyFocus(): void {
    // The clip planes cut the shadow map too, so what is drawn into it changes
    // with the cut.
    restamp();
    if (!focus) {
      scene.clipPlane = null;
      scene.clipPlane2 = null;
      scene.clipPlane3 = null;
      scene.clipPlane4 = null;
      return;
    }
    const { gx, gy, w, h } = focus;
    scene.clipPlane = new Plane(-1, 0, 0, gx);
    scene.clipPlane2 = new Plane(1, 0, 0, -(gx + w));
    scene.clipPlane3 = new Plane(0, 0, -1, gy);
    scene.clipPlane4 = new Plane(0, 0, 1, -(gy + h));
  }

  /** Frame whatever is on screen: the focused chunk, or the whole grid. */
  function frame(): void {
    const { gx, gy, w, h } = focus ?? { gx: 0, gy: 0, w: doc?.cols ?? 0, h: doc?.rows ?? 0 };
    center.set(gx + w / 2, 0, gy + h / 2);
    frustum = clamp(Math.max(w, h) * 1.15, MIN_FRUSTUM, MAX_FRUSTUM);
    setFrustum(frustum);
  }

  /** Is this tile one the pointer may touch? Outside the cut, nothing is. */
  function inFocus(gx: number, gy: number): boolean {
    if (!focus) return true;
    return gx >= focus.gx && gx < focus.gx + focus.w && gy >= focus.gy && gy < focus.gy + focus.h;
  }

  /**
   * Draw the markers again from the document.
   *
   * The cage round the selection, the start ring, the spawn cones, the effect
   * beads: everything that stands *for* something rather than being it. A few
   * dozen small meshes, so it is redone whole rather than reconciled -- and it
   * is what both a terrain edit and a change of selection actually need, as
   * opposed to the map rebuild they used to ask for.
   *
   * `applyHidden` comes with it because the markers are new nodes under `root`
   * and the panel's switched-off rows are a fact about the old ones. Without
   * it a hidden spawn came back the moment you touched the ground -- which was
   * survivable while this ran once a stroke, and would not be now that it runs
   * while you paint. Skipped entirely when nothing is hidden, which is almost
   * always.
   */
  function remarkMarkers(): void {
    // Not the materials: they are shared and kept. See `markerMaterial`.
    markers?.dispose(false, false);
    if (doc) markers = buildMarkers(doc.map);
    // The index holds nodes, and these are new ones.
    movers = null;
    if (hidden.size) applyHidden();
  }

  /**
   * The grid, which only ever depends on how big the map is.
   *
   * It was rebuilt with the map because it was built inside `rebuild`, not
   * because anything about it had changed. A few hundred line vertices, redrawn
   * every time you nudged a crate.
   */
  function syncGrid(): void {
    if (!doc) return;
    if (grid && gridSize.cols === doc.cols && gridSize.rows === doc.rows) return;
    grid?.dispose(false, true);
    grid = buildGrid(doc.cols, doc.rows);
    grid.setEnabled(gridShown);
    gridSize = { cols: doc.cols, rows: doc.rows };
  }

  /**
   * Push edited definitions onto the lights that are already burning.
   *
   * `refresh` is the light's own primitive and has been here all along — it is
   * what `previewLight` uses so a slider drag does not rebuild the map. This is
   * that, for every light and for the settled value as well as the moving one.
   *
   * Returns false when the set of lights itself changed rather than their
   * settings, and the caller falls back to a rebuild. Two cases:
   *
   * - a light was added or removed;
   * - a light changed `type`, which is a different Babylon class and a
   *   different shadow map, so there is nothing to refresh in place.
   *
   * Both are a click rather than a drag. The stall this exists to remove is on
   * the sliders, and re-registering shadow casters onto a generator built after
   * the meshes it lights is real work for something nobody does twice a second.
   */
  function syncLights(): boolean {
    const defs = doc?.map.lights ?? [];
    const live = mapView?.lights ?? [];
    if (live.length !== defs.length) return false;
    for (let i = 0; i < defs.length; i += 1) {
      if (live[i]?.def?.type !== defs[i]?.type) return false;
    }
    // Same length, checked just above, so every def has its light.
    for (const [i, def] of defs.entries()) live[i]!.refresh(def);
    return true;
  }

  /**
   * Draw the shadow maps again, next frame.
   *
   * Nothing in a map being edited moves on its own: the ground, the objects and
   * the sun all sit where they were put until you put them somewhere else. So
   * the maps are drawn once and kept, rather than re-rendered sixty times a
   * second to produce the same picture — which on a sun fitted to the whole
   * level is the largest single thing a frame does.
   *
   * Called from everywhere something can move. The cost of missing one is a
   * stale shadow, so the rule is that every path that touches what is drawn
   * ends here: `sync`, a drag, and the cut. A caster arriving late re-arms
   * itself, in `shadows.add`.
   */
  function restamp(): void {
    for (const entry of mapView?.lights ?? []) {
      entry.generator?.getShadowMap()?.resetRefreshCounter();
    }
  }

  /**
   * Bring the view up to date with whatever changed, once a frame.
   *
   * Order is not arbitrary. `terrain` runs before `markers` because the markers
   * stand on the ground — `buildMarkers` asks `world.standAt` how high each one
   * sits — so moving the ground moves them, and drawing them first would put
   * them where the ground used to be.
   */
  function sync(): void {
    // Everything, and it has already drawn the rest of them.
    if (dirty.has('map')) {
      rebuild();
      dirty.clear();
      restamp();
      return;
    }

    if (dirty.has('terrain')) {
      mapView?.blocks.refresh();
      // Not `markers`: the set of them has not changed, only the ground they
      // are standing on. That distinction is the difference between moving
      // three heights and building forty meshes, on every pointer move.
      dirty.add('standing');
    }
    // A light set that cannot be reconciled asks for the big hammer instead.
    if (dirty.has('lights') && !syncLights()) {
      rebuild();
      dirty.clear();
      restamp();
      return;
    }
    if (dirty.has('grid')) syncGrid();
    // Drawn again, or just stood back up — never both, because drawing them
    // again already stands them where they go.
    if (dirty.has('markers')) remarkMarkers();
    else if (dirty.has('standing')) restand();
    dirty.clear();
    restamp();
  }

  /**
   * Throw the whole view away and build it again.
   *
   * What a full `invalidate()` means, and now only what a *click* means:
   * placing, erasing, deleting, pasting, undoing, and settling a drag once it
   * is over. A gesture that repeats does not come here any more — see `nudge`
   * for a move and `invalidateTerrain` for the brush.
   *
   * The ground is the exception: it is three quarters of what this used to
   * cost — thirty-odd meshes and their vertex buffers made again to draw a
   * grid that had not changed — and it does not depend on anything a click
   * changes, so it is kept and pointed at the new view instead. See `terrain`
   * above and `retarget` in terrainLayer.ts.
   */
  function rebuild(): void {
    if (!doc) return;
    mapView?.dispose();
    markers?.dispose(false, false);

    // What the map is drawn from: the rules as they are being edited, not as
    // they were on disk when the page loaded. Absent — a test, a check script —
    // the view falls back to the game the engine was built against.
    const now = content?.() ?? {};
    drafts = new Map(
      ((now.prefabs ?? []) as { id?: string }[])
        .map((one) => normalizePrefab(one))
        .map((one) => [one.id, one]),
    );
    shown = expandPrefabs(doc.map, prefabOf);
    world = new World(shown, 'default', now.props);
    // The slot says the ground is this file's: handed over when there is one,
    // filled in by the first build when there is not, and never disposed by
    // the view around it. See `terrain` above.
    mapView = buildMapView(scene, world, now, { blocks: terrain });
    terrain = mapView.blocks;
    mapView.root.parent = root;
    // Not part of the map's own subtree: the pipeline is the renderer's, so the
    // map can only ask for a setting rather than carry one.
    setAmbientOcclusion?.(mapView.env.aoStrength);

    // Drawn once and kept, rather than every frame. See `restamp`.
    for (const entry of mapView.lights) {
      const map = entry.generator?.getShadowMap();
      if (map) map.refreshRate = RenderTargetTexture.REFRESHRATE_RENDER_ONCE;
    }

    syncGrid();
    markers = buildMarkers(doc.map);
    // Built on the next drag rather than now: most rebuilds are not the start
    // of one, and walking the map to answer a question nobody asked is the
    // habit this whole change is about.
    movers = null;
    slid = null;

    applyHidden();
  }

  /**
   * Switch off whatever the panel has hidden.
   *
   * Everything selectable already carries `metadata.pick` so a ray can say what
   * it hit; the same tag says what to hide. A tag with no index or key is a
   * mesh standing in for many placements at once — there is no single node to
   * switch off, so those are asked at the end instead.
   *
   * A light needs its lamp marker hidden *and* the light itself switched off,
   * or the room stays lit by something you cannot see.
   */
  function applyHidden(): void {
    for (const node of root.getDescendants(false)) {
      const pick = pickOf(node);
      if (!pick) continue;
      const at = pick.key ?? pick.index;
      if (at === undefined) continue;
      // Hidden as the placement, not as the child: switching off a prefab has
      // to take everything it drew with it, and the panel only ever offers you
      // the one row.
      const owner = drawnBy(pick.list, pick.index);
      const id = owner === null ? `${pick.list}:${at}` : `prefabs:${owner}`;
      node.setEnabled(!hidden.has(id));
    }

    (mapView?.lights ?? []).forEach((entry, index) => {
      const owner = drawnBy('lights', index);
      const id = owner === null ? `lights:${index}` : `prefabs:${owner}`;
      entry.light?.setEnabled(!hidden.has(id));
    });

    // An object is drawn as one instance among many and has no node of its
    // own to switch off, so it is asked rather than found. Cheap when nothing
    // changed: the runtime only touches the ones whose answer is different.
    const view = mapView;
    if (view) {
      (shown?.props ?? []).forEach((_, index) => {
        const owner = drawnBy('props', index);
        const id = owner === null ? `props:${index}` : `prefabs:${owner}`;
        view.showProp(index, !hidden.has(id));
      });
    }
  }

  /**
   * The tile under the pointer, found by hitting what is actually drawn.
   *
   * Intersecting a flat plane at y = 0 is right only where the world is flat
   * and at ground level. Anything with height is drawn *above* the tile it
   * stands on, so the pointer over the face of a wall would land on the plane
   * some way behind it and pick a tile the wall was in front of.
   *
   * Picking the built map puts the hit on the surface you are looking at. A
   * thin-instance hit reports which instance, and reading its own matrix is
   * what makes a wall's *side* resolve to the wall rather than to whichever
   * tile the boundary happens to round towards.
   *
   * The plane is still the fallback: off the edge of the geometry, and while a
   * scene is being rebuilt, it is the only answer there is.
   */
  function tileUnderPointer(
    event: PointerEvent,
    ray = pickingRay(event),
    hit = castAt(ray),
  ): Cell | null {
    // Outside the cut there is nothing to hover: the tiles are still in the
    // document, but they are not on screen and a click that landed on one would
    // edit something invisible.
    const inBounds = (x: number, z: number): Cell | null => {
      const gx = Math.floor(x);
      const gy = Math.floor(z);
      return doc?.inBounds(gx, gy) && inFocus(gx, gy) ? { gx, gy, x, z } : null;
    };

    if (mapView) {
      if (hit?.hit) {
        if (hit.pickedPoint) {
          const found = inBounds(hit.pickedPoint.x, hit.pickedPoint.z);
          if (found) return found;
        }
      }
    }

    groundPlane.d = 0;
    const distance = ray.intersectsPlane(groundPlane);
    if (distance === null) return null;
    const at = ray.direction.scale(distance).addInPlace(ray.origin);
    return inBounds(at.x, at.z);
  }

  function onPointerMove(event: PointerEvent): void {
    // A handle has the pointer; the map does not.
    if (gizmos.dragging) return;
    const from = hover;
    // Both answers come out of one cast: see `castAt`.
    const ray = pickingRay(event);
    const hit = castAt(ray);
    hover = tileUnderPointer(event, ray, hit);
    hoverPick = pickAt(event, hit);
    listeners.hover?.(hover);
    if (painting === null || !hover) return;

    // The pointer moves in pixels and the map is made of cells, so two samples
    // one frame apart can be six cells apart. Every cell between them was swept
    // over whether or not a pointermove landed on it, and a brush that only
    // paints where the events happened to fall leaves a dotted line behind a
    // fast hand. The first cell is dropped because the previous event already
    // reported it.
    const path =
      interpolate && from ? cellLine(from, hover).slice(1) : [hover];
    for (const cell of path) {
      if (painting === 0) listeners.paint?.(cell, false);
      else listeners.erase?.(cell, false);
    }
  }

  function onPointerDown(event: PointerEvent): void {
    if (event.button !== 0 && event.button !== 2) return;

    // A handle is grabbed before anything else: it is drawn on top of the map,
    // so a click that lands on one was meant for it and not for the tile
    // behind. The gizmo layer has already taken it.
    if (event.button === 0) {
      const rect = scene.getEngine().getRenderingCanvasClientRect();
      const x = event.clientX - (rect?.left ?? 0);
      const y = event.clientY - (rect?.top ?? 0);
      if (gizmos.dragging || gizmos.underPointer(x, y)) return;
    }

    const ray = pickingRay(event);
    const hit = castAt(ray);
    hover = tileUnderPointer(event, ray, hit);
    hoverPick = pickAt(event, hit);

    // The Select tool acts on what the pointer is over, not on the tile under
    // it. Clicking nothing clears the selection, which is what clicking away
    // from everything means.
    if (event.button === 0 && cursorMode === 'select') {
      listeners.pick?.(
        hoverPick && { list: hoverPick.list, index: hoverPick.index, key: hoverPick.key },
      );
      return;
    }

    if (!hover) return;
    painting = event.button;
    if (painting === 0) listeners.paint?.(hover, true);
    else listeners.erase?.(hover, true);
  }

  const onPointerUp = () => {
    if (gizmos.dragging) return;
    if (painting !== null) listeners.release?.();
    painting = null;
  };

  function onWheel(event: WheelEvent): void {
    event.preventDefault();
    frustum = clamp(frustum * (event.deltaY > 0 ? 1.1 : 1 / 1.1), MIN_FRUSTUM, MAX_FRUSTUM);
    setFrustum(frustum);
  }

  const onContextMenu = (event: Event) => event.preventDefault();

  const canvas = scene.getEngine().getRenderingCanvas();
  let attached = false;

  function attach(): void {
    if (attached || !canvas) return;
    canvas.addEventListener('pointermove', onPointerMove);
    canvas.addEventListener('pointerdown', onPointerDown);
    window.addEventListener('pointerup', onPointerUp);
    canvas.addEventListener('wheel', onWheel, { passive: false });
    canvas.addEventListener('contextmenu', onContextMenu);
    attached = true;
  }

  function detach(): void {
    if (!attached || !canvas) return;
    canvas.removeEventListener('pointermove', onPointerMove);
    canvas.removeEventListener('pointerdown', onPointerDown);
    window.removeEventListener('pointerup', onPointerUp);
    canvas.removeEventListener('wheel', onWheel);
    canvas.removeEventListener('contextmenu', onContextMenu);
    attached = false;
    painting = null;
  }

  return {
    get doc() {
      return doc;
    },
    get hover() {
      return hover;
    },

    /**
     * Called by the UI whenever it mutates the document, saying what it
     * touched.
     *
     * Named nothing means everything, which is what it has always meant and
     * what most callers still want: an edit that adds or removes an object
     * genuinely does change the map. The narrow ones are for the gestures that
     * repeat — a slider being dragged, a brush being pulled across the ground.
     */
    invalidate(...what: Domain[]) {
      if (!what.length) dirty.add('map');
      else for (const one of what) dirty.add(one);
    },

    /**
     * Which objects the panel has switched off, by `list:index`.
     *
     * Applied at once and again after every rebuild. Nothing about it reaches
     * the document — see the note on `hidden`.
     */
    setHiddenObjects(next: Iterable<string> | null | undefined) {
      hidden = new Set(next ?? []);
      applyHidden();
    },

    /**
     * The same, for an edit that only moved terrain blocks about.
     *
     * Kept as a name of its own rather than folded into `invalidate('terrain')`
     * because it is what the brush calls on every pointer move, and a name is
     * cheaper to read at that call site than a string.
     */
    invalidateTerrain() {
      dirty.add('terrain');
    },

    /**
     * A new edge profile. Rebakes the block shapes and swaps the geometry under
     * every bucket, keeping the materials — so this is what the rim sliders
     * call while they are being dragged.
     */
    reprofile(rim: readonly RimRing[] | null | undefined) {
      mapView?.blocks.setRim(rim);
    },

    get selection() {
      return selection;
    },

    select(next: Selection) {
      const same =
        selection?.list === next?.list &&
        selection?.index === next?.index &&
        selection?.key === next?.key;
      if (same) return;
      selection = next;
      dirty.add('markers'); // the highlight moves, and only the highlight
    },

    /**
     * Slide what is already drawn, without building anything.
     *
     * The sibling of `previewLight`, for the gesture that actually stutters:
     * dragging a thing across the map wrote the document and then rebuilt the
     * whole view, once per pointer move — every mesh, every material and every
     * light thrown away and made again so that one crate could sit a tile to
     * the left.
     *
     * A move changes one thing about what is drawn, which is where it is, so
     * that is all this touches. It is given the step rather than the
     * destination because a node's position is its builder's business — a torch
     * hangs on a wall face, a prop stands on its own footing — and adding a
     * delta keeps whatever that builder worked out instead of guessing at it
     * again.
     *
     * Height is deliberately left alone. It follows the ground, and dragging
     * onto a taller tile is the one case this gets visibly wrong — for the
     * length of the drag, because `release` rebuilds and settles it.
     *
     * @returns false when nothing on screen stands for this selection, which is
     *   now only a selection that has just been deleted. Everything a map can
     *   draw has a mover; see `buildMovers`.
     */
    nudge(sel: Selection, dx: number, dz: number): boolean {
      if (!sel || !mapView) return false;
      if (!dx && !dz) return true;

      movers ??= buildMovers();
      const at = sel.key ?? sel.index;
      const here =
        at === undefined
          ? null
          : [
              ...(movers.get(`${sel.list}:${at}`) ?? []),
              ...(movers.get(`${sel.list}:${at}:props`) ?? []),
            ];
      if (!here?.length) return false;
      for (const move of here) move(dx, dz);

      // The outline round it goes with it. Moved rather than drawn again: the
      // markers are a few dozen meshes and their materials, and making them
      // afresh on every pointer move is the smaller half of the stall this
      // exists to remove.
      if (selectionCage) {
        selectionCage.position.x += dx;
        selectionCage.position.z += dz;
      }
      // What it throws goes with it.
      restamp();
      return true;
    },

    /**
     * Show a change on the live light without touching the document, so a
     * slider drag reads as continuous instead of one rebuild per pixel.
     */
    previewLight(index: number, patch: Record<string, unknown>) {
      const entry = mapView?.lights[index];
      const def = doc?.map.lights[index];
      if (!entry || !def) return;
      entry.refresh({ ...def, ...patch });
    },

    /**
     * Which tool the cursor is serving. The editor cannot know this for itself
     * but needs it in order to highlight what a click would actually take.
     */
    setCursorMode(mode: CursorMode) {
      cursorMode = mode;
    },

    setCellOverlay,

    /**
     * Whether a drag should paint every cell between pointer samples.
     *
     * Only the continuous tools want it: a rectangle wants the cell under the
     * cursor, not the path taken to reach it.
     */
    setInterpolate(on: unknown) {
      interpolate = Boolean(on);
    },

    /** Which handles to draw on the selection, or none. */
    setGizmoMode(mode: GizmoMode | null) {
      gizmoMode = mode;
      if (mode) gizmos.setMode(mode);
    },

    setSnap(next: Snap) {
      snap = next;
      gizmos.setSnap(next);
    },

    setPlaceTurn(deg: number) {
      placeTurn = deg;
    },

    /** Is a handle being dragged? The panel suppresses its own drag if so. */
    get draggingHandle() {
      return gizmos.dragging;
    },

    /**
     * Show the selected thing where the document now says it is, without
     * building the map again.
     *
     * What every live edit goes through -- a handle mid-drag, a number field
     * mid-drag -- so the thing follows the pointer at frame rate. An object is
     * stood again by the runtime that draws it; a prefab's children are worked
     * out again and each stood; anything drawn as a marker slides. The map is
     * built again when the edit settles, which is what makes the rest of it
     * (the shadows, the ground it blocks) catch up.
     */
    previewTransform() {
      const entry = selectedEntry();
      if (!entry || !selection || !mapView || !world) return;
      const { list, index } = selection;
      if (list === 'props' && index !== undefined) {
        mapView.restandProp(index, entry as MapObject, world);
      } else if (list === 'prefabs' && index !== undefined) {
        const at = entry as PlacedPrefab;
        const prefab = prefabOf(String(at.id ?? ''));
        const fresh = (prefab ? prefabObjects(prefab, at).props : []) ?? [];
        let k = 0;
        (shown?.props ?? []).forEach((child, i) => {
          if (child.prefab !== index) return;
          const now = fresh[k++];
          if (now) mapView?.restandProp(i, now, world!);
        });
        slideMarkers(entry);
      } else {
        slideMarkers(entry);
      }
      // What it throws goes with it.
      restamp();
      // The outline and the handles go with it.
      if (!gizmos.dragging) standPivot();
      if (selectionCage) {
        selectionCage.position.copyFrom(pivot.position);
        selectionCage.position.y = boundsFor(list, entry).y;
        selectionCage.rotation.copyFrom(pivot.rotation);
      }
    },

    /**
     * Choose which ghost follows the cursor. Pass null while a tool that places
     * nothing is active.
     */
    setPreview(kind: string | null, elevation = 0) {
      previewY = elevation;
      if (kind === previewKind) return;
      previewKind = kind;

      preview?.setEnabled(false);
      preview = null;
      if (!kind) return;

      if (!previews.has(kind)) previews.set(kind, buildPreview(kind));
      preview = previews.get(kind) ?? null;
      preview?.setEnabled(Boolean(hover));
    },

    /** Centre the view on a tile, for jumping to a row in the object list. */
    lookAtTile(gx: number, gy: number) {
      center.set(gx + 0.5, 0, gy + 0.5);
    },

    on<K extends keyof Listeners>(event: K, handler: Listeners[K]) {
      listeners[event] = handler;
    },

    /** Start editing a map, framing whatever is in view. */
    open(map: GameMap) {
      selection = null;
      focus = null;
      applyFocus();
      doc = createDocument(map, prefabOf);
      root.setEnabled(true);
      rebuild();
      frame();
      attach();
      return doc;
    },

    /**
     * Show one rectangle of the map and nothing else — a chunk, edited as the
     * little map it will be. Pass null for the whole grid back.
     */
    setFocus(rect: Rect | null, refit = true) {
      focus = rect ? { ...rect } : null;
      applyFocus();
      // A chunk being dragged or resized keeps the camera where it is: the view
      // jumping on every mouse-move would fight the hand doing the dragging.
      if (refit) frame();
    },

    get focus() {
      return focus;
    },

    /**
     * Show or hide everything the map editor drew, keeping the document.
     *
     * Switching workspaces is not closing one: the layout you were part way
     * through has to still be there when you come back, so this hides the
     * meshes and lets go of the pointer rather than tearing anything down.
     */
    /**
     * Show or hide the tile lines.
     *
     * On the editor rather than in the panel, because the grid is rebuilt with
     * the map on every edit and the answer has to survive that.
     */
    setGridVisible(on: unknown) {
      gridShown = Boolean(on);
      grid?.setEnabled(gridShown);
    },

    get gridVisible() {
      return gridShown;
    },

    setVisible(on: unknown) {
      root.setEnabled(Boolean(on));
      if (!on) return detach();
      // The zoom is the scene camera's, and another workspace may have moved it
      // to frame something of its own — so taking the scene back means saying
      // again how far out this view was.
      setFrustum(frustum);
      if (doc) attach();
    },

    close() {
      detach();
      // The cut is four planes on the *scene*, and the game draws into the same
      // one: leaving the editor while a chunk was focused would otherwise play
      // the level through that chunk's rectangle and clip everything else away.
      focus = null;
      applyFocus();
      for (const built of previews.values()) built?.dispose(false, true);
      previews.clear();
      preview = null;
      previewKind = null;

      mapView?.dispose();
      mapView = null;
      // Unhooked by the view's own dispose rather than taken down with it,
      // because it is this file's. See `terrain`.
      terrain?.dispose();
      terrain = null;
      grid?.dispose(false, true);
      grid = null;
      markers?.dispose(false, false);
      markers = null;
      for (const material of markerMaterials.values()) material.dispose();
      markerMaterials.clear();
      cageMaterialOnce?.dispose();
      cageMaterialOnce = null;
      world = null;
      doc = null;
      root.setEnabled(false);
    },

    /** Pan with the arrow keys / WASD, and keep the cursor on the hovered tile. */
    update(dt: number, keys: ReadonlySet<string>) {
      // Hidden: another view has the scene and has pointed the camera at
      // something of its own. Panning it from here — or rebuilding a map
      // nobody is looking at — is work that lands on somebody else's frame.
      if (!root.isEnabled()) return;
      // Widest first, and each one is the whole of what its edit needs: a
      // rebuild has already drawn the markers, and a terrain edit moves them
      // because they stand on the ground it just changed.
      if (dirty.size) sync();

      let forward = 0;
      let right = 0;
      if (keys.has('KeyW') || keys.has('ArrowUp')) forward += 1;
      if (keys.has('KeyS') || keys.has('ArrowDown')) forward -= 1;
      if (keys.has('KeyD') || keys.has('ArrowRight')) right += 1;
      if (keys.has('KeyA') || keys.has('ArrowLeft')) right -= 1;

      if (forward || right) {
        // The camera looks down the (1, 1, 1) diagonal, so on screen "right" is
        // the world direction (1, 0, -1) and "up" is (-1, 0, -1), both
        // normalised. Panning is just those two summed.
        const step = ((PAN_SPEED * dt * frustum) / 22) * Math.SQRT1_2;
        center.x += (right - forward) * step;
        center.z += (-right - forward) * step;
      }

      camera.position.copyFrom(center).addInPlace(CAMERA_OFFSET);
      camera.setTarget(center);

      // The box wins when there is something to point at; the flat square is
      // what is left when there is not, so the pointer never goes missing.
      const target = cursorTarget();
      highlight.setEnabled(Boolean(target));

      if (target) {
        // A box round a *thing* is drawn over the map, because the thing may be
        // behind something and finding it is the point. A box round a block is
        // drawn *into* the map, because the block is the map — its far edges
        // showing through itself would read as an x-ray of something solid.
        const hug = target.hug ? MARK_HUG : 1;
        highlight.renderingGroupId = target.hug ? GROUP_MAP : GROUP_OVERLAY;
        highlightMaterial.disableDepthWrite = !target.hug;
        highlight.position.set(target.x, target.y, target.z);
        highlight.scaling.set(target.w * hug, target.h * hug, target.d * hug);
        highlightMaterial.emissiveColor = colorOf(target.color);
        const edge = colorOf(target.color);
        highlight.edgesColor = new Color4(edge.r, edge.g, edge.b, 0.9);
      }

      // The handles follow the selection, and only while a tool that uses
      // them is up. Stood on the thing's middle, at its height; while a handle
      // is held the pivot is the thing being dragged, and is left alone.
      const entry = gizmoMode ? selectedEntry() : null;
      if (entry && !gizmos.dragging) standPivot();
      gizmos.attach(entry ? pivot : null);

      // The flat square is the *tile* cursor, so it belongs to the tools whose
      // subject is a tile: Terrain, which sets its height, and Paint, which
      // puts something on it. Select and Erase are about things, and say
      // nothing when there is no thing under the pointer.
      const tileTool = cursorMode === 'terrain' || cursorMode === 'paint' || cursorMode === 'move';
      if (hover && !target && tileTool) {
        cursor.setEnabled(true);
        // On top of the ground.
        // The tile's centre, because on a slope its corners are at four
        // different heights and the middle is the one the square sits over.
        const top = world?.heightAt(hover.gx + 0.5, hover.gy + 0.5) ?? 0;
        cursor.position.set(hover.gx + 0.5, top * LEVEL_H + 0.04, hover.gy + 0.5);
      } else {
        cursor.setEnabled(false);
      }

      // The ghost stands where the thing would land: on the pointer, snapped
      // the way the drop will be, turned the way it will be. Turned about its
      // middle, which is half a tile in from where its node is.
      if (preview) {
        preview.setEnabled(Boolean(hover));
        if (hover) {
          const at =
            hover.x === undefined || hover.z === undefined
              ? { gx: hover.gx, gy: hover.gy }
              : snapSpot(hover.x, hover.z, snap);
          previewPivot.position.set(at.gx + 0.5, previewY, at.gy + 0.5);
          previewPivot.rotation.y = placeTurn * DEG_;
          preview.position.set(-0.5, 0, -0.5);
        }
      }
    },

    /** Frame the whole map again. */
    frameAll() {
      frame();
    },
  };
}

/** The editing surface: one map, drawn and edited in the application's Scene. */
export type MapEditor = ReturnType<typeof createEditor>;
