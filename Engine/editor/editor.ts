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
import { CAMERA_OFFSET } from '../src/render/isoCamera.ts';
import { buildMapView } from '../src/render/mapView.ts';
import { LEVEL_H } from '../src/data/dimensions.ts';
import { colorOf, unlit } from '../src/render/materials.ts';
import { normalizeLight } from '../src/data/lights.ts';

import { kindOf } from '../src/game/monsters.ts';
import { World } from '../src/game/world.ts';
import { createDocument } from './document.ts';
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
import type { RimRing } from '../src/data/terrain/profile.ts';
import type { TerrainGrid } from '../src/data/terrain/grid.ts';
import type { GameMap, MapObject, Placed } from '../src/data/mapFormat.ts';
import type { MapDoc, MapDocument } from './document.ts';
import type { Selection } from './state/selection.ts';

/** One tile. */
type Cell = { gx: number; gy: number };

/** The rectangle the view is cut down to. */
type Rect = { gx: number; gy: number; w: number; h: number };

/** A box in world space: where its middle is, and how big it is. */
type Box = { x: number; y: number; z: number; w: number; h: number; d: number };

/** A box the highlight draws, and how. See `cursorTarget`. */
type Target = Box & { color: number; hug?: boolean };

/** What a ray found: the tag, plus the node and the hit that carried it. */
type Pick = PickTag & { object: TransformNode; hit: PickingInfo };

/** Which handle a drag has hold of. */
type Axis = 'x' | 'z' | 'turn';

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
  drag: ((gx: number, gy: number) => void) | null;
  turn: ((heading: number) => void) | null;
  pick: ((selection: Selection) => void) | null;
};

/**
 * A map's lists, reached by a name worked out at runtime.
 *
 * The panels address a list by its name -- 'walls', 'portals' -- which an
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
const MIN_FRUSTUM = 6;
const MAX_FRUSTUM = 60;

const SPAWN_MARKER_COLOR = 0x35d07f;
/** The map's own start, told apart from the arrival points by colour. */
const START_MARKER_COLOR = 0xffc247;

/** The '@' tile, or null. Read out of the rows because that is where it lives. */
const WALL_PREVIEW_H = 1.3; // matches WALL_H in data/dimensions.ts

/**
 * Rendering groups. Babylon clears the depth buffer between them, so a higher
 * group is drawn over everything below it — which is what the overlays need:
 * a handle half-buried in a wall is a handle you cannot grab.
 */
const GROUP_MAP = 0;
const GROUP_OVERLAY = 1;
const GROUP_GIZMO = 2;

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
  let mapView: ReturnType<typeof buildMapView> | null = null;
  // Kept from the last rebuild so the cursor can ask how high the ground is
  // under a tile without parsing the map again every frame.
  let world: World | null = null;
  let needsRebuild = false;
  /**
   * A terrain edit, which is a much smaller thing than a rebuild.
   *
   * The ground is instanced blocks, so moving a tile means refilling matrix
   * buffers — no mesh, material, texture or shader is touched. Rebuilding the
   * whole map view around that would throw all of them away and make them
   * again, which is the pause a brush stroke used to cost.
   */
  let needsTerrain = false;
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
  // The drag and turn listeners are the gizmo's: the editor works out where a
  // handle was dragged to, and the panel decides what that means.
  const listeners: Listeners = {
    paint: null,
    erase: null,
    hover: null,
    release: null,
    drag: null,
    turn: null,
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
  const OBJECT_BOUNDS: Record<string, { size: [number, number, number]; base: number }> = {
    monsters: { size: [0.75, 1, 0.75], base: 0 },
    portals: { size: [0.95, 0.8, 0.95], base: 0 },
    lights: { size: [0.5, 0.5, 0.5], base: 0.85 },
    vfx: { size: [0.5, 0.5, 0.5], base: 0.2 },
    // Mounted on the side of a wall, so measured from the ground rather than
    // from a surface you could stand on.
    torches: { size: [0.5, 0.45, 0.5], base: 0.72 },
    stations: { size: [0.9, 0.75, 0.9], base: 0 },
    // Picked by its corner like everything else; the highlight marks the
    // anchor rather than the whole rectangle, which the outline already shows.
    chunks: { size: [0.9, 0.2, 0.9], base: 0 },
    spawns: { size: [0.6, 0.7, 0.6], base: 0.55 },
    // Filled by the stack it actually is, since a wall's height is editable.
    walls: { size: [1, WALL_PREVIEW_H, 1], base: 0 },
  };

  let cursorMode: CursorMode = 'select';

  /**
   * The handles drawn on a selected object so it can be moved and turned where
   * it stands, rather than by typing coordinates into the inspector.
   *
   * Two arrows and a ring, in the plane the world is laid out on. There is no
   * Y arrow because nothing is placed at a height of its own — an object sits
   * on whatever the ground under it reaches — so an up handle would be a
   * control with nothing behind it.
   *
   * The ring only appears for things that have a facing to change. A portal and
   * a monster look the same from every side, and a handle that turned them
   * would move a number nothing reads.
   */
  const gizmo = new TransformNode('gizmo', scene);
  gizmo.parent = overlay;
  gizmo.setEnabled(false);
  // Nothing is drawn until a map is opened.
  root.setEnabled(false);

  let gizmoRotatable = false;
  /** The handle being dragged, or null. */
  let gizmoDrag: { axis: Axis } | null = null;
  /** Every mesh belonging to a handle, and which axis it drags. */
  const handleAxis = new Map<AbstractMesh, Axis>();

  const GIZMO_X = 0xe5484d;
  const GIZMO_Z = 0x3d7eff;
  const GIZMO_TURN = 0x4ade80;

  function tagHandle(mesh: Mesh, axis: Axis): Mesh {
    mesh.renderingGroupId = GROUP_GIZMO;
    handleAxis.set(mesh, axis);
    return mesh;
  }

  /** An arrow from the centre out along one axis. */
  function buildArrow(axis: Axis, color: number, rotation: Vector3): TransformNode {
    const group = new TransformNode(`arrow-${axis}`, scene);
    group.parent = gizmo;
    group.rotation.copyFrom(rotation);

    const material = overlayMaterial(`handle-${axis}`, color, 0.95, GROUP_GIZMO);

    const shaft = MeshBuilder.CreateCylinder(
      'shaft',
      { diameter: 0.07, height: 0.6, tessellation: 8 },
      scene,
    );
    shaft.material = material;
    shaft.position.y = 0.45;
    shaft.parent = group;

    const head = MeshBuilder.CreateCylinder(
      'head',
      { diameterTop: 0, diameterBottom: 0.22, height: 0.28, tessellation: 10 },
      scene,
    );
    head.material = material;
    head.position.y = 0.89;
    head.parent = group;

    tagHandle(shaft, axis);
    tagHandle(head, axis);
    return group;
  }

  buildArrow('x', GIZMO_X, new Vector3(0, 0, -Math.PI / 2));
  buildArrow('z', GIZMO_Z, new Vector3(Math.PI / 2, 0, 0));

  const turnRing = MeshBuilder.CreateTorus(
    'turn',
    { diameter: 1.44, thickness: 0.07, tessellation: 40 },
    scene,
  );
  turnRing.material = overlayMaterial('handle-turn', GIZMO_TURN, 0.95, GROUP_GIZMO);
  turnRing.parent = gizmo;
  tagHandle(turnRing, 'turn');

  // Ghost of whatever the active brush would drop here, so a click is never a
  // guess. Built once per brush and cached: switching brushes is frequent.
  const previews = new Map<string, TransformNode | null>();
  let preview: TransformNode | null = null;
  let previewKind: string | null = null;
  // How high the ghost floats. A ramp drawn at level 2 has to be previewed
  // where it would actually land, not on the ground under it.
  let previewY = 0;

  let grid: LinesMesh | null = null;
  /** Whether the tile lines are drawn. Kept across rebuilds, not per map. */
  let gridShown = true;
  let markers: TransformNode | null = null;
  // { list, index } for the indexed lists, { list: "spawns", key } for a named
  // spawn, or null when nothing is selected.
  let selection: Selection = null;

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

  /** Where on the ground the pointer is, at the height the gizmo sits at. */
  function pointerOnPlane(event: PointerEvent, y: number): Vector3 | null {
    const ray = pickingRay(event);
    groundPlane.d = -y;
    const distance = ray.intersectsPlane(groundPlane);
    if (distance === null) return null;
    return ray.direction.scale(distance).addInPlace(ray.origin);
  }

  /** Which handle, if any, is under the pointer. */
  function handleUnderPointer(event: PointerEvent): Axis | null {
    if (!gizmo.isEnabled()) return null;
    const hit = scene.pickWithRay(pickingRay(event), (mesh) => handleAxis.has(mesh));
    if (!hit?.hit || !hit.pickedMesh) return null;
    return handleAxis.get(hit.pickedMesh) ?? null;
  }

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
  function pickAt(event: PointerEvent): Pick | null {
    if (!mapView || !doc) return null;
    const hit = scene.pickWithRay(pickingRay(event), isMapMesh);
    if (!hit?.hit) return null;

    for (let node: Node | null = hit.pickedMesh; node; node = node.parent) {
      const pick = pickOf(node);
      // Only a transform answers, because the caller measures what it found.
      if (!pick || !(node instanceof TransformNode)) continue;
      if (pick.instances) {
        const index = pick.instances[hit.thinInstanceIndex];
        return index === undefined ? null : { list: pick.list, index, object: node, hit };
      }
      return { ...pick, object: node, hit };
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

    if (pick.list === 'walls') {
      // A thin instance has no object of its own to measure, and a wall may be
      // several of them, so this one is built from what the wall is.
      const wall = pick.index === undefined ? null : doc.map.walls[pick.index];
      return wall ? boundsFor('walls', wall.gx, wall.gy) : null;
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
  function boundsFor(list: string, gx: number, gy: number): Box {
    const spec = OBJECT_BOUNDS[list] ?? OBJECT_BOUNDS.monsters;
    const [w, own, d] = spec.size;
    // A wall is as tall as it has been stacked; everything else is one size.
    const h = list === 'walls' ? Math.max(1, world?.wallStack(gx, gy) ?? 1) * WALL_PREVIEW_H : own;
    // The top of the tile's own column, which is where anything standing on it
    // rests — and on a ramp tile it is the high end, so nothing is drawn sunk
    // into the slope.
    const surface = (world?.levelAt(gx, gy) ?? 0) * LEVEL_H;
    return { x: gx + 0.5, y: surface + spec.base + h / 2, z: gy + 0.5, w, h, d };
  }

  /** How tall everything standing on a tile reaches, above the ground. */
  function stackHeight(gx: number, gy: number): number {
    const walls = (world?.wallStack(gx, gy) ?? 0) * WALL_PREVIEW_H;
    if (!doc) return walls;
    const objects = doc
      .objectsAt(gx, gy)
      .map(({ list }) => OBJECT_BOUNDS[list] ?? OBJECT_BOUNDS.monsters);
    const tallest = objects.reduce((top, b) => Math.max(top, b.base + b.size[1]), 0);
    return Math.max(walls, tallest);
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
    group.parent = overlay;

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
      case 'wall':
        place(
          MeshBuilder.CreateBox('wall', { width: 1, height: WALL_PREVIEW_H, depth: 1 }, scene),
          ghost(0xd6cdb8),
          0.5,
          WALL_PREVIEW_H / 2,
          0.5,
        );
        break;

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

      case 'torch':
        place(
          MeshBuilder.CreateSphere('flame', { diameter: 0.18, segments: 8 }, scene),
          ghost(0xffd9a0, 0.8),
          0.5,
          0.94,
          0.5,
        );
        place(
          MeshBuilder.CreateCylinder(
            'bracket',
            { diameterTop: 0.1, diameterBottom: 0.14, height: 0.14, tessellation: 8 },
            scene,
          ),
          ghost(0x2a2118, 0.7),
          0.5,
          0.81,
          0.5,
        );
        break;

      case 'portal': {
        place(
          MeshBuilder.CreateTorus(
            'ring',
            { diameter: 0.68, thickness: 0.09, tessellation: 24 },
            scene,
          ),
          ghost(0x9d6bff, 0.7),
          0.5,
          0.55,
          0.5,
        );
        const disc = place(
          MeshBuilder.CreateDisc('disc', { radius: 0.42, tessellation: 28 }, scene),
          ghost(0x9d6bff, 0.35),
          0.5,
          0.02,
          0.5,
        );
        disc.rotation.x = -Math.PI / 2;
        break;
      }

      case 'grunt':
      case 'brute': {
        const spec = kindOf(kind);
        const mesh = place(
          MeshBuilder.CreateCapsule('monster', { radius: 0.24, height: 0.88 }, scene),
          ghost(spec.color, 0.6),
          0.5,
          0.45,
          0.5,
        );
        mesh.scaling.setAll(spec.scale);
        break;
      }

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
  const OVERLAY_LAYERS: Record<string, { color: number; alpha: number }> = {
    brush: { color: 0xffffff, alpha: 0.2 },
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
    const look = OVERLAY_LAYERS[name] ?? OVERLAY_LAYERS.brush;
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

  function buildMarkers(map: MapDoc): TransformNode {
    const group = new TransformNode('markers', scene);
    group.parent = overlay;

    // Markers stand in the map and are occluded by it, the way the objects
    // they stand for would be. Only the cursor and the handles float above.
    const marker = (mesh: Mesh, material: Material, pick?: PickTag): Mesh => {
      mesh.material = material;
      mesh.parent = group;
      return pick ? tagPick(mesh, pick) : mesh;
    };

    // Built on first use rather than up front: markers are rebuilt with the map
    // — which in terrain mode is every stroke of the brush — and a material for
    // a marker the map does not have is one nothing is ever attached to, so
    // nothing ever takes it down again. That leaked one material and one shader
    // per edit, on a map with no effects placed on it.
    let spawnMaterial: Material | null = null;
    let vfxMaterial: Material | null = null;

    // Where the player comes up. It is a character in the terrain, which parses
    // to ordinary ground — so without a marker the one tile that decides where
    // the map begins is the one tile you cannot see.
    // Both kinds of marker stand where the player would: on top of whatever is
    // on the tile, so a start put on a stack of crates is drawn on the crates
    // rather than buried in them.
    const footing = (gx: number, gy: number) =>
      (world?.standAt(gx + 0.5, gy + 0.5) ?? 0) * LEVEL_H;

    const start = map.spawns.default ?? null;
    if (start) {
      const ring = MeshBuilder.CreateTorus(
        'start',
        { diameter: 0.8, thickness: 0.12, tessellation: 20 },
        scene,
      );
      ring.position.set(start.gx + 0.5, footing(start.gx, start.gy) + 0.08, start.gy + 0.5);
      marker(ring, unlit('start', scene, { color: START_MARKER_COLOR }));
      const pin = MeshBuilder.CreateCylinder(
        'start',
        { diameterTop: 0, diameterBottom: 0.34, height: 0.55, tessellation: 4 },
        scene,
      );
      pin.position.set(start.gx + 0.5, footing(start.gx, start.gy) + 0.5, start.gy + 0.5);
      marker(pin, unlit('start', scene, { color: START_MARKER_COLOR }));
    }

    for (const [key, spawn] of Object.entries(map.spawns)) {
      const cone = MeshBuilder.CreateCylinder(
        'spawn',
        { diameterTop: 0.44, diameterBottom: 0, height: 0.5, tessellation: 4 },
        scene,
      );
      cone.position.set(spawn.gx + 0.5, footing(spawn.gx, spawn.gy) + 0.9, spawn.gy + 0.5);
      spawnMaterial ??= unlit('spawn', scene, { color: SPAWN_MARKER_COLOR });
      marker(cone, spawnMaterial, { list: 'spawns', key });
    }

    // Lights: a bulb at the light's own height with a stem down to its tile,
    // plus a ground ring showing how far a local light actually reaches.
    (map.lights ?? []).forEach((raw, index) => {
      const def = normalizeLight(raw);
      const selected = selection?.list === 'lights' && selection.index === index;
      const material = unlit(`light${index}`, scene, { color: selected ? 0xffffff : def.color });

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
      vfxMaterial ??= unlit('vfxMarker', scene, { color: 0xffd9a0, alpha: 0.9 });
      marker(bead, vfxMaterial, { list: 'vfx', index });
    });

    // One material per kind, so a monster reads as the colour it will be.
    const monsterMaterials = new Map<string, Material>();
    (map.monsters ?? []).forEach((monster, index) => {
      const kind = monster.kind ?? 'grunt';
      const spec = kindOf(kind);
      if (!monsterMaterials.has(kind)) {
        monsterMaterials.set(
          kind,
          unlit(`monster-${kind}`, scene, { color: spec.color, alpha: 0.8 }),
        );
      }
      const mesh = MeshBuilder.CreateCapsule('monster', { radius: 0.24, height: 0.88 }, scene);
      mesh.position.set(monster.gx + 0.5, 0.45, monster.gy + 0.5);
      mesh.scaling.setAll(spec.scale);
      const material = monsterMaterials.get(kind);
      if (material) marker(mesh, material, { list: 'monsters', index });
    });

    // A cage around the selected object, so a row picked in the panel is
    // findable on a map with a hundred things on it. Sized to the thing rather
    // than to a fixed box: on a four-block wall a waist-high outline points at
    // the wrong part of what you have selected.
    const at = selectedTile(map);
    if (at && selection) {
      const box = boundsFor(selection.list, at.gx, at.gy);
      const cage = MeshBuilder.CreateBox(
        'cage',
        { width: box.w + 0.02, height: box.h + 0.02, depth: box.d + 0.02 },
        scene,
      );
      const cageMaterial = overlayMaterial('cage', 0x8be9fd, 0);
      cage.material = cageMaterial;
      cage.position.set(box.x, box.y, box.z);
      cage.renderingGroupId = GROUP_OVERLAY;
      cage.isPickable = false;
      cage.parent = group;
      // Only the wireframe: the fill is fully transparent, so what shows is the
      // outline Babylon draws round it.
      cage.enableEdgesRendering();
      cage.edgesWidth = 3;
      cage.edgesColor = new Color4(0.545, 0.914, 0.992, 1);
    }

    return group;
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

  function rebuild(): void {
    if (!doc) return;
    mapView?.dispose();
    grid?.dispose(false, true);
    markers?.dispose(false, true);

    // What the map is drawn from: the rules as they are being edited, not as
    // they were on disk when the page loaded. Absent — a test, a check script —
    // the view falls back to the game the engine was built against.
    const now = content?.() ?? {};
    world = new World(doc.map, 'default', now.props);
    mapView = buildMapView(scene, world, now);
    mapView.root.parent = root;
    // Not part of the map's own subtree: the pipeline is the renderer's, so the
    // map can only ask for a setting rather than carry one.
    setAmbientOcclusion?.(mapView.env.aoStrength);

    grid = buildGrid(doc.cols, doc.rows);
    grid.setEnabled(gridShown);
    markers = buildMarkers(doc.map);

    applyHidden();
    needsRebuild = false;
  }

  /**
   * Switch off whatever the panel has hidden.
   *
   * Everything selectable already carries `metadata.pick` so a ray can say what
   * it hit; the same tag says what to hide. A pick with no index or key is the
   * wall mesh, which is one mesh carrying every wall as an instance — there is
   * no single node to switch off, so walls cannot be hidden and the panel does
   * not offer to.
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
      node.setEnabled(!hidden.has(`${pick.list}:${at}`));
    }

    (mapView?.lights ?? []).forEach((entry, index) => {
      entry.light?.setEnabled(!hidden.has(`lights:${index}`));
    });
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
  function tileUnderPointer(event: PointerEvent): Cell | null {
    const ray = pickingRay(event);
    // Outside the cut there is nothing to hover: the tiles are still in the
    // document, but they are not on screen and a click that landed on one would
    // edit something invisible.
    const inBounds = (gx: number, gy: number): Cell | null =>
      doc?.inBounds(gx, gy) && inFocus(gx, gy) ? { gx, gy } : null;

    if (mapView) {
      const hit = scene.pickWithRay(ray, isMapMesh);
      if (hit?.hit) {
        const instances = pickOf(hit.pickedMesh)?.instances;
        if (instances && hit.thinInstanceIndex >= 0) {
          // The wall the block belongs to, so a face shared by two tiles
          // belongs to the block it is a face of rather than to whichever tile
          // the boundary rounds towards.
          const wall = doc?.map.walls[instances[hit.thinInstanceIndex]];
          const found = wall && inBounds(wall.gx, wall.gy);
          if (found) return found;
        } else if (hit.pickedPoint) {
          const found = inBounds(Math.floor(hit.pickedPoint.x), Math.floor(hit.pickedPoint.z));
          if (found) return found;
        }
      }
    }

    groundPlane.d = 0;
    const distance = ray.intersectsPlane(groundPlane);
    if (distance === null) return null;
    const at = ray.direction.scale(distance).addInPlace(ray.origin);
    return inBounds(Math.floor(at.x), Math.floor(at.z));
  }

  function onPointerMove(event: PointerEvent): void {
    if (gizmoDrag) {
      dragHandle(event);
      return;
    }
    const from = hover;
    hover = tileUnderPointer(event);
    hoverPick = pickAt(event);
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
    // behind.
    if (event.button === 0) {
      const axis = handleUnderPointer(event);
      if (axis) {
        gizmoDrag = { axis };
        return;
      }
    }

    hover = tileUnderPointer(event);
    hoverPick = pickAt(event);

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

  /**
   * One frame of a handle drag.
   *
   * Movement snaps to tiles, because that is the only place an object can be —
   * a map entry is a pair of integers. Turning does not snap here; whoever
   * applies it decides, since a torch has four faces to choose between and a
   * light has a whole compass.
   */
  function dragHandle(event: PointerEvent): void {
    const entry = selectedEntry();
    if (!entry || !gizmoDrag) return;

    const at = pointerOnPlane(event, gizmo.position.y);
    if (!at) return;

    if (gizmoDrag.axis === 'turn') {
      // Same atan2(dx, dz) heading every actor in the game uses.
      listeners.turn?.(Math.atan2(at.x - (entry.gx + 0.5), at.z - (entry.gy + 0.5)));
      return;
    }

    const gx = gizmoDrag.axis === 'x' ? Math.floor(at.x) : entry.gx;
    const gy = gizmoDrag.axis === 'z' ? Math.floor(at.z) : entry.gy;
    if (gx === entry.gx && gy === entry.gy) return;
    listeners.drag?.(gx, gy);
  }

  const onPointerUp = () => {
    if (gizmoDrag) {
      gizmoDrag = null;
      listeners.release?.();
      return;
    }
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

    /** Called by the UI whenever it mutates the document. */
    invalidate() {
      needsRebuild = true;
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

    /** The same, for an edit that only moved terrain blocks about. */
    invalidateTerrain() {
      needsTerrain = true;
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
      needsRebuild = true; // the highlight moves
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

    /**
     * Whether the selected thing has a facing worth a turn handle. The panel
     * knows — it is the one that renders the field — so it says.
     */
    setRotatable(on: unknown) {
      gizmoRotatable = Boolean(on);
    },

    /** Is a handle being dragged? The panel suppresses its own drag if so. */
    get draggingHandle() {
      return gizmoDrag !== null;
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
      doc = createDocument(map);
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
      grid?.dispose(false, true);
      grid = null;
      markers?.dispose(false, true);
      markers = null;
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
      if (needsRebuild) rebuild();
      else if (needsTerrain) {
        mapView?.blocks.refresh();
        // Markers stand on the ground, so a height change moves them too.
        markers?.dispose(false, true);
        if (doc) markers = buildMarkers(doc.map);
        needsTerrain = false;
      }

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

      // The handles follow the selection, and only while the tool that uses
      // them is up. Anchored on the tile centre at the height of the ground
      // under it, so they sit on the object rather than through it.
      const entry = cursorMode === 'select' ? selectedEntry() : null;
      gizmo.setEnabled(Boolean(entry));
      if (entry) {
        const y = (world?.heightAt(entry.gx + 0.5, entry.gy + 0.5) ?? 0) * LEVEL_H;
        gizmo.position.set(entry.gx + 0.5, y + 0.05, entry.gy + 0.5);
      }
      turnRing.setEnabled(gizmoRotatable);

      // The flat square is the *tile* cursor, so it belongs to the tools whose
      // subject is a tile: Terrain, which sets its height, and Paint, which
      // puts something on it. Select and Erase are about things, and say
      // nothing when there is no thing under the pointer.
      const tileTool = cursorMode === 'terrain' || cursorMode === 'paint' || cursorMode === 'move';
      if (hover && !target && tileTool) {
        cursor.setEnabled(true);
        // On top of whatever is there: the ground, or the wall standing on it.
        // The tile's centre, because on a slope its corners are at four
        // different heights and the middle is the one the square sits over.
        const top = world?.heightAt(hover.gx + 0.5, hover.gy + 0.5) ?? 0;
        const stack = world?.wallStack(hover.gx, hover.gy) ?? 0;
        cursor.position.set(
          hover.gx + 0.5,
          top * LEVEL_H + stack * WALL_PREVIEW_H + 0.04,
          hover.gy + 0.5,
        );
      } else {
        cursor.setEnabled(false);
      }

      if (preview) {
        preview.setEnabled(Boolean(hover));
        if (hover) preview.position.set(hover.gx, previewY, hover.gy);
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
