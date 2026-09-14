import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder.js';
import { TransformNode } from '@babylonjs/core/Meshes/transformNode.js';
import { Vector3 } from '@babylonjs/core/Maths/math.vector.js';
import { burstOf, spawnVfx } from '../../src/render/vfx.ts';
import type { VfxHandle } from '../../src/render/vfx.ts';
import type { VfxInput } from '../../src/data/vfx.ts';
import type { Scene } from '@babylonjs/core/scene.js';
import { unlit } from '../../src/render/materials.ts';

/**
 * An effect, running.
 *
 * Every other record can be read: a grid of tiles, a list of numbers. A
 * particle effect is neither — forty settings describe it and none of them tell
 * you what it looks like, so the stage is not a preview but the point. Every
 * change starts it again.
 *
 * Lifted out of the old VFX mode unchanged. It spawns through the game's own
 * `spawnVfx`, so the stage and the game are running the same effect, modifiers
 * and all.
 */

/** Where the stage stands. Its own patch of world, clear of any map. */
const STAGE = new Vector3(0, 0, 0);

export function createVfxPreview(game = '') {
  let scene: Scene | null = null;
  let stage: TransformNode | null = null;
  let playing: VfxHandle | null = null;

  /**
   * Play the record from scratch.
   *
   * Hoisted out of the object so `again` can fall back to it without going
   * through `this`, which would make the returned type depend on itself.
   */
  function draw(record: VfxInput | null | undefined): void {
    playing?.dispose();
    playing = null;
    if (!scene || !stage || !record) return;
    playing = spawnVfx(scene, record, STAGE, { forever: true, game });
  }

  return {
    /** About six tiles across — an effect is only a couple wide. */
    frustum: 6,

    get scene() {
      return scene;
    },

    mount(made: Scene): void {
      scene = made;
      const ground = new TransformNode('vfxStage', made);
      stage = ground;
      stage.position.copyFrom(STAGE);

      // A disc rather than a square: the effect is round, the camera is fixed,
      // and a corner in the background is one more thing to read.
      const disc = MeshBuilder.CreateDisc('vfxGround', { radius: 2.2, tessellation: 48 }, made);
      disc.material = unlit('vfxGround', made, { color: 0x161c28 });
      disc.rotation.x = Math.PI / 2;
      disc.position.y = 0.002;
      disc.isPickable = false;
      disc.parent = ground;

      const ring = MeshBuilder.CreateTorus(
        'vfxRing',
        { diameter: 2, thickness: 0.02, tessellation: 64 },
        made,
      );
      ring.material = unlit('vfxRing', made, { color: 0x3b4a63 });
      ring.position.y = 0.004;
      ring.isPickable = false;
      ring.parent = ground;
    },

    unmount(): void {
      playing?.dispose();
      playing = null;
      stage?.dispose(false, true);
      stage = null;
      scene = null;
    },

    /**
     * Throw away what is running and start this definition again.
     *
     * `forever` is the one thing the stage asks for that a map does not: a
     * one-shot that played once when the panel opened would leave you tuning
     * numbers against a still image.
     */
    draw,

    /**
     * Play it again. A burst can simply be thrown a second time; anything else
     * — a steady emitter, a sheet part way through its frames — is easier to
     * start over than to rewind.
     */
    again(record: VfxInput | null | undefined): void {
      const system = playing?.system;
      const burst = system ? burstOf(system) : undefined;
      if (system && burst) system.manualEmitCount = burst;
      else draw(record);
    },
  };
}

/** One effect on its own little stage, for the rules editor. */
export type VfxPreview = ReturnType<typeof createVfxPreview>;
