import { PLAYER_RADIUS } from '../game/world.ts';

/**
 * The stand-in capsule's shape — see `standIn` in monsters.ts. Exported so the
 * dash trail can leave afterimages of the same silhouette rather than guessing
 * at a capsule that nearly matches. The body itself lives with the other
 * actors' now: the player is a prefab like anything else that stands up.
 */
export const BODY_RADIUS = PLAYER_RADIUS * 1; // a hair inside the collision footprint
export const BODY_LENGTH = 0.55; // straight section; total height is this + 2 * radius

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
export function riseToward(shown: number, target: number, dt: number): number {
  if (!(dt > 0)) return target;
  const step = dt / RISE_TIME;
  const gap = target - shown;
  return Math.abs(gap) <= step ? target : shown + Math.sign(gap) * step;
}
