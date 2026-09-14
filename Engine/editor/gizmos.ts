import { PositionGizmo } from '@babylonjs/core/Gizmos/positionGizmo.js';
import { RotationGizmo } from '@babylonjs/core/Gizmos/rotationGizmo.js';
import { ScaleGizmo } from '@babylonjs/core/Gizmos/scaleGizmo.js';
import { UtilityLayerRenderer } from '@babylonjs/core/Rendering/utilityLayerRenderer.js';
import type { Scene } from '@babylonjs/core/scene.js';
import type { TransformNode } from '@babylonjs/core/Meshes/transformNode.js';

/**
 * The handles on a selected thing: move, turn, or scale it where it stands.
 *
 * Babylon's own gizmos, on a utility layer of their own so they draw over the
 * map and take the pointer before it. What they are attached to is never a
 * thing on the map -- an object drawn as an instance has no node, and a prefab
 * is several -- but a pivot the editor stands where the thing is. The gizmo
 * moves the pivot; the editor reads the pivot and moves the thing.
 *
 * One mode at a time, the way every 3D tool does it: W moves, E turns, R
 * scales. Position is in world axes, which is what a map is laid out in; a
 * turn is about the thing's own axes, which is the only kind that reads.
 */

export type GizmoMode = 'move' | 'rotate' | 'scale';

/** What the handles land on when snapping is on. Degrees for the turn. */
export type Snap = { on: boolean; move: number; turn: number; scale: number };

/**
 * Where a thing put down at this point on the ground goes, as a position.
 *
 * A position is the tile corner and the thing stands half a tile in, so the
 * snap is taken about the thing's middle: a step of one lands it on tile
 * centres, which is what snapping to tiles means. To a hundredth otherwise —
 * fine enough to be free, coarse enough that a file does not fill with
 * fourteen decimals.
 */
export function snapSpot(x: number, z: number, snap: Snap): { gx: number; gy: number } {
  const step = snap.on ? snap.move : 0.01;
  return {
    gx: Math.round((x - 0.5) / step) * step,
    gy: Math.round((z - 0.5) / step) * step,
  };
}

const DEG = Math.PI / 180;

export function createGizmos(
  scene: Scene,
  listeners: {
    /** A drag has taken hold of a handle. */
    onStart: () => void;
    /** The pivot has moved under a drag. Read it and show the change. */
    onChange: () => void;
    /** The handle was let go. What the pivot says is now what the thing is. */
    onEnd: () => void;
  },
) {
  const layer = new UtilityLayerRenderer(scene);
  // Without this the layer draws before the map and the handles sink into it.
  layer.utilityLayerScene.autoClearDepthAndStencil = true;

  // Thicker than Babylon's default: a one-pixel ring is a ring you miss.
  const position = new PositionGizmo(layer, 3);
  position.planarGizmoEnabled = true;
  position.updateGizmoRotationToMatchAttachedMesh = false;

  const rotation = new RotationGizmo(layer, 32, true, 4);
  rotation.updateGizmoRotationToMatchAttachedMesh = true;

  const scale = new ScaleGizmo(layer, 3);
  scale.updateGizmoRotationToMatchAttachedMesh = true;
  // A tile of drag for a whole step of scale is a long way to pull for a little.
  scale.sensitivity = 3;
  // Steps of scale rather than multiples: 1, 1.25, 1.5 rather than 1, 1.25, 1.56.
  scale.incrementalSnap = true;

  const all = [position, rotation, scale] as const;
  let mode: GizmoMode = 'move';
  let attached: TransformNode | null = null;

  for (const gizmo of all) {
    gizmo.scaleRatio = 1.4;
    gizmo.onDragStartObservable.add(() => listeners.onStart());
    gizmo.onDragEndObservable.add(() => listeners.onEnd());
  }

  // Read off the pivot once a frame while a handle is held, rather than once
  // per pointer event: three axes' worth of drag observables all say the same
  // thing, and the change is shown once either way.
  const watch = scene.onBeforeRenderObservable.add(() => {
    if (all.some((gizmo) => gizmo.isDragging)) listeners.onChange();
  });

  const apply = () => {
    position.attachedNode = mode === 'move' ? attached : null;
    rotation.attachedNode = mode === 'rotate' ? attached : null;
    scale.attachedNode = mode === 'scale' ? attached : null;
  };

  return {
    /** Stand the handles on this node, or take them away. */
    attach(node: TransformNode | null) {
      attached = node;
      apply();
    },

    setMode(next: GizmoMode) {
      mode = next;
      apply();
    },

    setSnap(snap: Snap) {
      position.snapDistance = snap.on ? snap.move : 0;
      rotation.snapDistance = snap.on ? snap.turn * DEG : 0;
      scale.snapDistance = snap.on ? snap.scale : 0;
    },

    /**
     * Whether a press at this point lands on a handle, so it means the handle.
     *
     * Asked of the layer's own scene rather than of the hover state, which is
     * only as fresh as the last pointer move: a press that arrives without one
     * -- a tap, a scripted pointer -- would otherwise fall through to the map.
     */
    underPointer(x: number, y: number): boolean {
      if (!attached) return false;
      const hit = layer.utilityLayerScene.pick(x, y, (mesh) => mesh.isEnabled() && mesh.isVisible);
      return Boolean(hit?.hit);
    },

    get dragging(): boolean {
      return all.some((gizmo) => gizmo.isDragging);
    },

    dispose() {
      scene.onBeforeRenderObservable.remove(watch);
      for (const gizmo of all) gizmo.dispose();
      layer.dispose();
    },
  };
}

export type Gizmos = ReturnType<typeof createGizmos>;
