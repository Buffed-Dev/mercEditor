import { hostile, type Actor } from './actor.ts';
import type { Ability } from '../data/abilities.ts';
import type { World } from './world.ts';

/** One shot in flight. */
export type Shot = {
  id: number;
  ability: Ability;
  source: Actor;
  gx: number;
  gy: number;
  dirX: number;
  dirY: number;
  size: number;
  speed: number;
  /** How far it has come, counted from the caster rather than the muzzle. */
  travelled: number;
  range: number;
  dead: boolean;
};

/**
 * Travelling shots.
 *
 * The one thing that matters here is the sub-stepping. The render loop clamps
 * dt at 0.05s, and a bolt moving 12 tiles a second covers 0.6 tiles in that —
 * comfortably far enough to start one frame in front of a grunt and finish the
 * next behind it, having passed straight through. Moving in slices no longer
 * than MAX_STEP and testing at every slice is what stops that, and the failure
 * it prevents is intermittent and frame-rate dependent, which is the worst kind
 * to find by playing.
 */

/** Longest distance, in tiles, a projectile may move between collision tests. */
const MAX_STEP = 0.25;

/** How far ahead of the caster a shot appears, so it clears their own body. */
const MUZZLE = 0.3;

let nextId = 1;

export function createProjectiles() {
  let live: Shot[] = [];

  return {
    get list() {
      return live;
    },

    spawn({
      ability,
      source,
      dirX,
      dirY,
    }: {
      ability: Ability;
      source: Actor;
      dirX: number;
      dirY: number;
    }): Shot | null {
      const length = Math.hypot(dirX, dirY);
      if (!(length > 0)) return null;

      const nx = dirX / length;
      const ny = dirY / length;

      const shot: Shot = {
        id: nextId++,
        ability,
        source,
        gx: source.pos.gx + nx * MUZZLE,
        gy: source.pos.gy + ny * MUZZLE,
        dirX: nx,
        dirY: ny,
        size: ability.size ?? 0.18,
        speed: ability.speed ?? 12,
        // Counted from the muzzle, so range means the same thing it does for a
        // melee cone: how far from the caster the ability reaches.
        travelled: MUZZLE,
        range: ability.range ?? 9,
        dead: false,
      };

      live.push(shot);
      return shot;
    },

    /**
     * @param {World} world for wall collision
     * @param {Array} actors everything that can be hit
     * @param {(shot, target) => void} onHit called once per shot, on whatever
     *   it struck — the level turns that into effects.
     */
    update(
      dt: number,
      world: World,
      actors: readonly Actor[],
      onHit: (shot: Shot, target: Actor) => void,
    ): void {
      if (!live.length) return;

      for (const shot of live) {
        const distance = shot.speed * dt;
        const steps = Math.max(1, Math.ceil(distance / MAX_STEP));
        const step = distance / steps;

        for (let i = 0; i < steps && !shot.dead; i++) {
          shot.gx += shot.dirX * step;
          shot.gy += shot.dirY * step;
          shot.travelled += step;

          if (shot.travelled > shot.range) {
            shot.dead = true;
            break;
          }

          // Walls stop it where it met them, so it never appears past one.
          if (world.hitsWall(shot.gx, shot.gy, shot.size)) {
            shot.gx -= shot.dirX * step;
            shot.gy -= shot.dirY * step;
            shot.dead = true;
            break;
          }

          const target = actors.find(
            (actor) =>
              actor !== shot.source &&
              actor.alive &&
              hostile(shot.source, actor) &&
              Math.hypot(actor.pos.gx - shot.gx, actor.pos.gy - shot.gy) <
                shot.size + (actor.radius ?? 0),
          );

          if (target) {
            shot.dead = true;
            onHit(shot, target);
          }
        }
      }

      live = live.filter((shot) => !shot.dead);
    },

    clear(): void {
      live = [];
    },
  };
}

/** Every shot currently in the air. */
export type Projectiles = ReturnType<typeof createProjectiles>;
