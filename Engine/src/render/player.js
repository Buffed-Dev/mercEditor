import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder.js';
import { TransformNode } from '@babylonjs/core/Meshes/transformNode.js';
import { PLAYER_RADIUS } from '../game/world.js';
import { LEVEL_H } from './dimensions.js';
import { surface } from './materials.js';

// The first two are exported so the dash trail can leave afterimages of the
// same silhouette rather than guessing at a capsule that nearly matches.
export const BODY_RADIUS = PLAYER_RADIUS * 1; // a hair inside the collision footprint
export const BODY_LENGTH = 0.55; // straight section; total height is this + 2 * radius
const BODY_COLOR = 0xa8c06d;

/**
 * How long the body takes to cover one level of step, in seconds.
 *
 * The ground steps and the body should not. Without this the mesh teleports a
 * whole level the instant its centre crosses a tile edge, and because the
 * camera eases toward the same height rather than snapping to it, the body
 * visibly hops away from the view that is following it.
 */
export const RISE_TIME = 0.08;

/**
 * One frame of the body climbing toward the height it stands at.
 *
 * A constant rate rather than a decay, so a step takes the time it says it
 * takes and *arrives* rather than approaching forever. Clamped to the target,
 * which is what stops a long frame overshooting and rubber-banding back.
 *
 * Without a `dt` it arrives at once: that is what a fresh level or a teleport
 * wants, where easing would show the body flying in from wherever it last was.
 */
export function riseToward(shown, target, dt) {
  if (!(dt > 0)) return target;
  const step = dt / RISE_TIME;
  const gap = target - shown;
  return Math.abs(gap) <= step ? target : shown + Math.sign(gap) * step;
}

/**
 * The player: a capsule, plus a small box on the front so its facing is
 * readable (a capsule on its own is rotationally symmetric).
 */
export function createPlayer(scene, root, shadows) {
  const group = new TransformNode('player', scene);
  group.parent = root;

  const height = BODY_RADIUS * 2 + BODY_LENGTH;

  const body = MeshBuilder.CreateCapsule('body', { radius: BODY_RADIUS, height }, scene);
  body.material = surface('player', scene, { color: BODY_COLOR, roughness: 0.6, metallic: 0.05 });
  // Babylon centres a capsule on its origin; the group's origin is the feet.
  body.position.y = height / 2;
  body.receiveShadows = true;
  body.parent = group;
  shadows.add(body);

  const visor = MeshBuilder.CreateBox('visor', { width: 0.26, height: 0.12, depth: 0.12 }, scene);
  visor.material = surface('visor', scene, { color: 0x1f2532, roughness: 0.4 });
  visor.position.set(0, BODY_RADIUS + BODY_LENGTH - 0.02, BODY_RADIUS * 0.85);
  visor.receiveShadows = true;
  visor.parent = group;
  shadows.add(visor);

  /** The height the body is drawn at, which trails the one it stands at. */
  let shown = null;

  return {
    group,
    height,

    /**
     * Place the capsule on the surface, climbing to a new step rather than
     * appearing at it.
     *
     * Without a `dt` it arrives immediately, which is what a fresh level or a
     * teleport wants: easing there would show the body flying in from whatever
     * height the last place happened to be.
     *
     * The rate is constant — one level per `RISE_TIME` — rather than a decay,
     * so a step takes the time it says it takes and finishes rather than
     * approaching forever.
     */
    sync(gx, gy, heightLevels, dt = 0) {
      shown = shown === null ? heightLevels : riseToward(shown, heightLevels, dt);
      group.position.set(gx, shown * LEVEL_H, gy);
    },

    /**
     * Turn instantly to a heading. Used when an ability fires: the swing is
     * tested against the aim direction immediately, so easing the mesh round
     * would leave the visor pointing somewhere the cone was not.
     */
    snapTo(heading) {
      group.rotation.y = heading;
    },

    /** Turn to face a movement direction, smoothly. */
    face(dx, dz, dt) {
      if (dx === 0 && dz === 0) return;
      const target = Math.atan2(dx, dz);
      const current = group.rotation.y;
      let delta = target - current;
      while (delta > Math.PI) delta -= Math.PI * 2;
      while (delta < -Math.PI) delta += Math.PI * 2;
      group.rotation.y = current + delta * Math.min(1, dt * 14);
    },

    dispose() {
      group.dispose(false, true);
    },
  };
}
