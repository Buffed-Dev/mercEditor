import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder.js';
// Side-effect only: this is what adds `createInstance` to Mesh.
import '@babylonjs/core/Meshes/instancedMesh.js';
import { TransformNode } from '@babylonjs/core/Meshes/transformNode.js';
import { Quaternion, Vector3 } from '@babylonjs/core/Maths/math.vector.js';
import { LEVEL_H } from '../data/dimensions.ts';
import { unlit } from './materials.ts';
import type { InstancedMesh } from '@babylonjs/core/Meshes/instancedMesh.js';
import type { Scene } from '@babylonjs/core/scene.js';
import type { Shot } from '../game/projectiles.ts';

/**
 * The trail a shot drags behind it.
 *
 * Named by what a projectile does with one rather than imported from ./vfx:
 * it is carried along, stopped where the shot died, and thrown away.
 */
type TrailHandle = { follow: (where: Vector3) => void; stop: () => void; dispose: () => void };

/** All a projectile asks of the effects system. */
export type VfxAttacher = { attach: (id: string, node: TransformNode) => TrailHandle | null };

/** What the ground is, to something flying over it. */
type Overflown = { heightAt: (gx: number, gy: number) => number };

/** One pooled shot: its node, the instance drawn at it, and its trail. */
type Entry = { node: TransformNode; mesh: InstancedMesh; trail: TrailHandle | null };

/**
 * Meshes for the shots game/projectiles.js is simulating.
 *
 * Projectiles come and go constantly, so every one of them is an instance of a
 * single source sphere — one draw call for all of them — and the instances are
 * pooled: a spent shot's mesh is parked rather than disposed, and the next shot
 * takes it back. Without that, a held mouse button creates and destroys a mesh
 * several times a second.
 *
 * Each pooled shot is a node with the instance under it rather than the
 * instance alone. The node carries where the shot is and how it is turned, the
 * instance carries how big it is. Keeping those apart is what lets a trail hang
 * off the node without the shot's size scaling the effect with it — an emitter
 * on a body scaled to 0.18 would throw its particles at a fifth of their
 * authored speed — and it is what gives the trail something to be aimed by.
 */

const SEGMENTS = 10;

/**
 * An effect emits along its own up, so a shot's node is turned to put its up
 * behind it: the trail is then thrown backwards out of the body rather than
 * into the sky, and its spread opens into the space the shot came from.
 */
const UP = Vector3.Up();
const back = new Vector3();
/** How far above the surface a shot flies — roughly chest height on the capsule. */
const FLIGHT_HEIGHT = 0.55;

/**
 * @param vfx the effect runtime, for the shots that leave a trail. Optional, so
 *   nothing that only wants meshes has to have one.
 */
export function createProjectileViews(
  scene: Scene,
  root: TransformNode,
  vfx: VfxAttacher | null = null,
) {
  const source = MeshBuilder.CreateSphere('shot', { diameter: 2, segments: SEGMENTS }, scene);
  source.material = unlit('shot', scene, { color: 0xffd166 });
  source.isPickable = false;
  source.setEnabled(false);

  const pool: Entry[] = [];
  const inUse = new Map<number, Entry>();

  function take(): Entry {
    const entry = pool.pop();
    if (entry) {
      entry.mesh.setEnabled(true);
      return entry;
    }
    const node = new TransformNode('shot', scene);
    const mesh = source.createInstance('shot');
    mesh.parent = node;
    return { node, mesh, trail: null };
  }

  function give(entry: Entry): void {
    // The tail is left where the shot ended rather than following the body back
    // into the pool: pinning it to the death spot is what makes it read as
    // something the shot left behind instead of something it is dragging.
    if (entry.trail) {
      entry.trail.follow(entry.node.position.clone());
      entry.trail.stop();
      entry.trail = null;
    }
    entry.mesh.setEnabled(false);
    pool.push(entry);
  }

  return {
    /** Match the meshes to whatever is currently in flight. */
    sync(shots: readonly Shot[], world: Overflown): void {
      const seen = new Set<number>();

      for (const shot of shots) {
        seen.add(shot.id);
        let entry = inUse.get(shot.id);
        if (!entry) {
          entry = take();
          entry.node.parent = root;
          // The source sphere has unit diameter, so the shot's own size is a
          // straight scale.
          entry.mesh.scaling.setAll(shot.size);
          // Once, not per frame: a shot flies the way it was fired and never
          // turns, so the heading it trails along cannot change under it. Set
          // whether or not there is a trail, so a node coming back out of the
          // pool is never still aimed the way the last shot went.
          back.set(-shot.dirX, 0, -shot.dirY);
          entry.node.rotationQuaternion ??= new Quaternion();
          Quaternion.FromUnitVectorsToRef(UP, back, entry.node.rotationQuaternion);
          entry.trail = shot.ability.trail
            ? (vfx?.attach(shot.ability.trail, entry.node) ?? null)
            : null;
          inUse.set(shot.id, entry);
        }
        const ground = world.heightAt(shot.gx, shot.gy) * LEVEL_H;
        entry.node.position.set(shot.gx, ground + FLIGHT_HEIGHT, shot.gy);
      }

      // Anything that was flying last frame and is not now has landed.
      for (const [id, entry] of inUse) {
        if (seen.has(id)) continue;
        give(entry);
        inUse.delete(id);
      }
    },

    dispose(): void {
      for (const entry of inUse.values()) {
        entry.trail?.dispose();
        entry.node.dispose(false, true);
      }
      for (const entry of pool) entry.node.dispose(false, true);
      inUse.clear();
      pool.length = 0;
      source.dispose(false, true);
    },
  };
}

/** Every shot currently drawn. */
export type ProjectileViews = ReturnType<typeof createProjectileViews>;
