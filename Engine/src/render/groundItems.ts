import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder.js';
// Side-effect only: this is what adds `createInstance` to Mesh.
import '@babylonjs/core/Meshes/instancedMesh.js';
import { SETTLE_SECONDS, type Drop } from '../game/ground.ts';
import type { InstancedMesh } from '@babylonjs/core/Meshes/instancedMesh.js';
import type { TransformNode } from '@babylonjs/core/Meshes/transformNode.js';
import type { Scene } from '@babylonjs/core/scene.js';
import type { Heights, Shadows } from './lights.ts';

/** Where a drop was thrown from, and when. See `flightFor`. */
type Flight = { born: number; gx: number; gy: number; y: number; still: boolean };

/** A name plate the HUD draws over a drop. */
export type Plate = { id: string; label: string; x: number; y: number; z: number };
import { LEVEL_H } from '../data/dimensions.ts';
import { surface } from './materials.ts';

/**
 * The meshes for whatever game/ground.js says is lying around.
 *
 * Deliberately small and identical: what an item *is* is written on the plate
 * above it, and a floor full of shapes that each mean something would need a
 * legend before it meant anything. What the mesh has to do is catch the eye, so
 * it turns and bobs — a still object of this size on a textured floor is very
 * easy to walk past.
 *
 * A new drop is thrown rather than placed. An item that simply appears on the
 * ground reads as a glitch, and worse, gives no hint where it came from; an arc
 * from the thrower to the tile answers both, and doubles as the beat that makes
 * a kill feel like it paid out. The flight is the view's business entirely —
 * the list holds where the item is, not where it is drawn — so a level loaded
 * mid-flight has nothing to restore.
 *
 * Every drop is an instance of one source octahedron, so a floor covered in
 * loot is still a single draw call.
 */

/** How far above the floor the item floats at the top of its bob. */
const HOVER = 0.16;
const BOB = 0.05;
/**
 * Where the name plate is anchored, above the item. Far enough that the plate
 * clears the item rather than sitting on it: at this camera a world unit is
 * about thirty pixels, and a plate is about half of one tall.
 */
const PLATE_CLEARANCE = 0.9;

/**
 * How high the throw goes at the top of its arc. How *long* it lasts is
 * SETTLE_SECONDS, which the list owns: coin cannot be picked up until it has
 * landed, so the length of this animation is a rule and not a flourish.
 */
const TOSS_HEIGHT = 1.1;
/** How high the item leaves the thrower — roughly hand height. */
const TOSS_FROM_Y = 0.6;

/** Babylon's polyhedron catalogue: 1 is the octahedron. */
const OCTAHEDRON = 1;

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

export function createGroundItemViews(scene: Scene, root: TransformNode, shadows: Shadows) {
  const source = MeshBuilder.CreatePolyhedron(
    'drop',
    { type: OCTAHEDRON, size: 0.17 },
    scene,
  );
  const material = surface('drop', scene, {
    color: 0xd7c08a,
    roughness: 0.35,
    metallic: 0.55,
  });
  material.emissiveColor = material.albedoColor.scale(0.35);
  source.material = material;
  source.setEnabled(false);
  shadows.add(source);

  /** drop id -> its mesh. */
  const meshes = new Map<string, InstancedMesh>();
  /** drop id -> where its throw started, and when. */
  const flights = new Map<string, Flight>();
  /** Reused so `anchors` allocates nothing on a frame where nothing changed. */
  const plates: Plate[] = [];

  function meshFor(drop: Drop): InstancedMesh {
    let mesh = meshes.get(drop.id);
    if (mesh) return mesh;
    mesh = source.createInstance(`drop${drop.id}`);
    mesh.parent = root;
    meshes.set(drop.id, mesh);
    return mesh;
  }

  /**
   * The throw this drop is on, started the first frame it was seen.
   *
   * Timed from here rather than from the list, because the list has no clock
   * and should not grow one: a drop is a thing on a tile, and how long it has
   * been drawn is a fact about drawing it.
   */
  function flightFor(drop: Drop, world: Heights, elapsed: number): Flight {
    const found = flights.get(drop.id);
    if (found) return found;

    const from = drop.from ?? { gx: drop.gx, gy: drop.gy };
    const flight: Flight = {
      born: elapsed,
      gx: from.gx,
      gy: from.gy,
      y: world.heightAt(from.gx, from.gy) * LEVEL_H + TOSS_FROM_Y,
      // A drop with nowhere to come from was not thrown — it is simply there,
      // which is what a saved map full of loot would look like.
      still: !drop.from,
    };
    flights.set(drop.id, flight);
    return flight;
  }

  return {
    /**
     * Match the meshes to the list, and animate them.
     *
     * Driven off the list every frame rather than by add/remove callbacks: the
     * list is the truth, and a drop that is picked up during a frame should not
     * depend on two places agreeing about it.
     */
    sync(drops: readonly Drop[], world: Heights, elapsed: number): void {
      const live = new Set<string>();

      plates.length = 0;
      for (const drop of drops) {
        live.add(drop.id);
        const mesh = meshFor(drop);
        const flight = flightFor(drop, world, elapsed);
        const floor = world.heightAt(drop.gx, drop.gy) * LEVEL_H;
        const rest = floor + HOVER;

        const t = flight.still ? 1 : Math.min(1, (elapsed - flight.born) / SETTLE_SECONDS);

        if (t < 1) {
          // Straight across, parabola up: the shape a thrown thing makes. The
          // arc term is zero at both ends, so it meets the ground exactly where
          // the resting position is and there is nothing to pop.
          mesh.position.set(
            lerp(flight.gx, drop.gx, t),
            lerp(flight.y, rest, t) + TOSS_HEIGHT * 4 * t * (1 - t),
            lerp(flight.gy, drop.gy, t),
          );
          // Tumbling, and it has stopped tumbling by the time it lands.
          mesh.rotation.set(Math.PI * 4 * t * (1 - t), elapsed * 4, 0);
          continue;
        }

        // Offset by position so two drops are not in lockstep, which reads as
        // machinery rather than as loot.
        const phase = elapsed * 2 + drop.gx * 1.7 + drop.gy * 2.3;
        mesh.position.set(drop.gx, rest + Math.sin(phase) * BOB, drop.gy);
        mesh.rotation.set(0, elapsed * 0.9 + drop.gx, 0);

        // The plate waits for the landing. A name sliding across the screen
        // under a flying item is unreadable, and cannot be clicked either.
        plates.push({
          id: drop.id,
          label: drop.item.label,
          x: drop.gx,
          y: floor + PLATE_CLEARANCE,
          z: drop.gy,
        });
      }

      for (const [id, mesh] of meshes) {
        if (live.has(id)) continue;
        mesh.dispose();
        meshes.delete(id);
        flights.delete(id);
      }
    },

    /**
     * Where each name plate belongs, in world space. Turning that into a screen
     * position is the label layer's business.
     */
    anchors: (): readonly Plate[] => plates,

    dispose(): void {
      for (const mesh of meshes.values()) mesh.dispose();
      meshes.clear();
      flights.clear();
      plates.length = 0;
      source.dispose(false, true);
    },
  };
}

/** Every item lying on the floor, as it is drawn. */
export type GroundItemViews = ReturnType<typeof createGroundItemViews>;
