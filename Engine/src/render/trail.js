import { Constants } from '@babylonjs/core/Engines/constants.js';
import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder.js';
import { SolidParticleSystem } from '@babylonjs/core/Particles/solidParticleSystem.js';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial.js';
import { DynamicTexture } from '@babylonjs/core/Materials/Textures/dynamicTexture.js';
import { Matrix } from '@babylonjs/core/Maths/math.vector.js';
import { Color3 } from '@babylonjs/core/Maths/math.color.js';
import { LEVEL_H } from '../data/dimensions.ts';
import { BILLBOARD } from './isoCamera.ts';
import { BODY_LENGTH, BODY_RADIUS } from './player.ts';

/**
 * The spark trail a dash leaves behind.
 *
 * Every particle lives in one solid particle system — a single mesh, a single
 * draw call — with the live ones packed at the front and the rest switched off.
 * A dead particle is swapped with the last live one rather than spliced, so
 * nothing allocates once the system is built.
 *
 * Fading is per-particle alpha. The material blends additively, so a spark's
 * contribution is its colour times its alpha, and an alpha of zero adds
 * nothing.
 *
 * The colour itself is on the material's emissive, not its diffuse. A material
 * with lighting switched off has no lights to gather, so its diffuse term is
 * zero and everything it draws would come out black — which, added to what is
 * already on screen, is nothing at all.
 *
 * Emission is spaced by *distance*, not time. Spaced by time, a fast dash would
 * bunch its sparks into a blob and a slow one would dot them sparsely, so the
 * effect would change character every time the dash speed was retuned.
 */

/** Ceiling on live particles. Beyond this the oldest simply stop being replaced. */
const MAX = 500;

/** Tiles between one burst and the next. */
const SPACING = 0.16;
/** Particles per burst. */
const PER_BURST = 4;
/** A stalled frame should not empty the whole budget in one go. */
const MAX_BURSTS_PER_FRAME = 12;

const LIFE_MIN = 0.22;
const LIFE_MAX = 0.45;

/** How far a spark may start from the body's centre line, in tiles. */
const SCATTER = 0.22;
/** Initial drift, tiles per second. */
const DRIFT = 0.9;
/** Fraction of velocity kept per second — sparks slow as they settle. */
const DRAG = 0.12;

const COLOR = Color3.FromInts(0x9f, 0xe4, 0xff);

/**
 * How big a spark is, in world units.
 *
 * A fixed world size rather than a fixed pixel size, which under an
 * orthographic camera is the same thing: the projection does not scale with
 * depth, so a spark is the same size on screen wherever it is on the map.
 */
const SPARK_SIZE = 0.12;

/** A soft round dot, so sparks are not visible squares. */
function softDotTexture(scene) {
  const size = 32;
  const texture = new DynamicTexture('spark', { width: size, height: size }, scene, false);
  const context = texture.getContext();

  const half = size / 2;
  const gradient = context.createRadialGradient(half, half, 0, half, half, half);
  gradient.addColorStop(0, 'rgba(255,255,255,1)');
  gradient.addColorStop(0.35, 'rgba(255,255,255,0.7)');
  gradient.addColorStop(1, 'rgba(255,255,255,0)');
  context.fillStyle = gradient;
  context.fillRect(0, 0, size, size);

  texture.update();
  texture.hasAlpha = true;
  return texture;
}

export function createTrailViews(scene, root) {
  const velocity = new Float32Array(MAX * 3);
  const age = new Float32Array(MAX);
  const life = new Float32Array(MAX);
  let count = 0;

  const sps = new SolidParticleSystem('trail', scene, { updatable: true, isPickable: false });

  // The camera never turns, so the quads are turned to face it once, here,
  // rather than billboarded every frame against a camera that has not moved.
  const quad = MeshBuilder.CreatePlane('spark', { size: SPARK_SIZE }, scene);
  const facing = new Matrix();
  Matrix.FromQuaternionToRef(BILLBOARD, facing);
  quad.bakeTransformIntoVertices(facing);
  sps.addShape(quad, MAX);
  quad.dispose();

  const mesh = sps.buildMesh();
  mesh.parent = root;
  // The buffers are rewritten every frame, so there is no stable bounding box
  // to cull against.
  mesh.alwaysSelectAsActiveMesh = true;
  mesh.isPickable = false;

  const texture = softDotTexture(scene);
  const material = new StandardMaterial('trail', scene);
  material.disableLighting = true;
  material.emissiveColor = COLOR;
  material.diffuseColor = Color3.Black();
  material.specularColor = Color3.Black();
  // The dot shapes the spark by its alpha alone; its colour is the emissive
  // above, the same for every spark.
  material.opacityTexture = texture;
  material.alphaMode = Constants.ALPHA_ADD;
  material.disableDepthWrite = true;
  material.backFaceCulling = false;
  material.applyFog = false;
  mesh.material = material;
  // What carries the fade: without this the shader never reads the alpha the
  // particles are carrying.
  mesh.hasVertexAlpha = true;

  // Position and colour are written straight onto the particles below, so the
  // per-particle callbacks Babylon would otherwise run are dead weight.
  sps.computeParticleRotation = false;
  sps.computeParticleTexture = false;
  sps.computeParticleVertex = false;

  for (const particle of sps.particles) particle.isVisible = false;
  sps.setParticles();

  // Where each dashing actor last emitted. Cleared when its dash ends.
  const lastMark = new Map();
  let bursts = 0;

  const spread = () => (Math.random() * 2 - 1) * SCATTER;

  function emit(gx, gy, groundY) {
    if (count >= MAX) return;

    const i = count++;
    const p = i * 3;
    const particle = sps.particles[i];

    particle.position.set(
      gx + spread(),
      groundY + BODY_RADIUS + BODY_LENGTH * Math.random(),
      gy + spread(),
    );
    // White, so the emissive colour comes through untouched; the alpha is the
    // only part that moves.
    particle.color.set(1, 1, 1, 1);
    particle.isVisible = true;

    velocity[p] = (Math.random() * 2 - 1) * DRIFT;
    velocity[p + 1] = Math.random() * DRIFT * 0.6;
    velocity[p + 2] = (Math.random() * 2 - 1) * DRIFT;

    age[i] = 0;
    life[i] = LIFE_MIN + Math.random() * (LIFE_MAX - LIFE_MIN);
  }

  /** Move the last live particle into slot `i`, so the live ones stay packed. */
  function recycle(i) {
    const last = --count;
    sps.particles[last].isVisible = false;

    if (i === last) return;

    sps.particles[i].position.copyFrom(sps.particles[last].position);
    sps.particles[i].color.copyFrom(sps.particles[last].color);

    const a = i * 3;
    const b = last * 3;
    for (let k = 0; k < 3; k++) velocity[a + k] = velocity[b + k];
    age[i] = age[last];
    life[i] = life[last];
  }

  /**
   * Burst along the segment from `last` to (gx, gy), one burst every SPACING.
   *
   * Emitting only at the end of each frame's step would cap the trail at the
   * frame rate: a fast dash crossing a tile in one frame would leave a sparser
   * trail than a slow one, which is backwards.
   *
   * @returns the advanced mark, or null when the step was too short to matter.
   */
  function layAlong(world, last, gx, gy) {
    const dx = gx - last.gx;
    const dy = gy - last.gy;
    const travelled = Math.hypot(dx, dy);
    if (travelled < SPACING) return null;

    const steps = Math.min(Math.floor(travelled / SPACING), MAX_BURSTS_PER_FRAME);
    for (let i = 1; i <= steps; i++) {
      const t = (i * SPACING) / travelled;
      const px = last.gx + dx * t;
      const py = last.gy + dy * t;
      const groundY = world.heightAt(px, py) * LEVEL_H;
      for (let n = 0; n < PER_BURST; n++) emit(px, py, groundY);
      bursts++;
    }

    // Carry the remainder, so spacing does not drift with the frame rate.
    const used = (steps * SPACING) / travelled;
    return { gx: last.gx + dx * used, gy: last.gy + dy * used };
  }

  return {
    /** Live particles. */
    get count() {
      return count;
    },

    /** Cumulative bursts, which depends on distance dashed and not on speed. */
    get dropped() {
      return bursts;
    },

    /**
     * Emit for one actor. Safe to call every frame for everyone; it does
     * nothing for anyone who is not dashing.
     */
    follow(actor, world) {
      const { gx, gy } = actor.pos;
      const last = lastMark.get(actor);

      if (!actor.dash) {
        // The dash ends inside the same frame that moved it, so without one
        // last pass the whole final step goes unsparked — and the faster the
        // dash, the bigger the piece missing off the end of it.
        if (last) {
          layAlong(world, last, gx, gy);
          lastMark.delete(actor);
        }
        return;
      }

      if (!last) {
        lastMark.set(actor, { gx, gy });
        const groundY = world.heightAt(gx, gy) * LEVEL_H;
        for (let n = 0; n < PER_BURST; n++) emit(gx, gy, groundY);
        bursts++;
        return;
      }

      const next = layAlong(world, last, gx, gy);
      if (next) lastMark.set(actor, next);
    },

    update(dt) {
      if (!count) return;

      const keep = DRAG ** dt; // frame-rate independent decay

      for (let i = count - 1; i >= 0; i--) {
        age[i] += dt;
        if (age[i] >= life[i]) {
          recycle(i);
          continue;
        }

        const p = i * 3;
        const particle = sps.particles[i];
        particle.position.x += velocity[p] * dt;
        particle.position.y += velocity[p + 1] * dt;
        particle.position.z += velocity[p + 2] * dt;

        velocity[p] *= keep;
        velocity[p + 1] *= keep;
        velocity[p + 2] *= keep;

        // Additive blending: an alpha of zero adds nothing, so this is the fade.
        particle.color.a = 1 - age[i] / life[i];
      }

      sps.setParticles();
    },

    dispose() {
      sps.dispose();
      material.dispose();
      texture.dispose();
      lastMark.clear();
      count = 0;
    },
  };
}
