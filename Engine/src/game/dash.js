/**
 * Dashing: a short burst of movement along the aim.
 *
 * It travels rather than teleporting, so it reads as a dash instead of a blink,
 * and every step goes through `World.move` — which means walls, ledges and
 * ramps constrain a dash exactly as they constrain walking, with no second set
 * of collision rules to keep in step with the first.
 *
 * The stepping is the part that matters. `World.move` only tests where a move
 * ends, so handing it the whole distance at once would carry the player through
 * a one-tile wall and over a cliff the height check never saw. Moving in slices
 * no wider than the body is what stops that.
 */

/** Longest slice, in tiles. Comfortably under a wall's width. */
const MAX_SLICE = 0.2;

/** Below this a dash has effectively arrived; avoids a zero-length last step. */
const EPSILON = 1e-6;

export function beginDash(ability, actor, aim) {
  const dash = {
    dirX: Math.sin(aim),
    dirY: Math.cos(aim),
    remaining: Math.max(0, ability.range ?? 0),
    speed: Math.max(0.1, ability.speed ?? 12),
  };
  actor.dash = dash.remaining > 0 ? dash : null;
  return actor.dash;
}

/**
 * Advance one actor's dash.
 *
 * @returns {boolean} true while it is still going.
 */
export function updateDash(actor, world, dt) {
  const dash = actor.dash;
  if (!dash) return false;

  let budget = Math.min(dash.speed * dt, dash.remaining);

  while (budget > EPSILON) {
    const step = Math.min(budget, MAX_SLICE);
    const fromX = actor.pos.gx;
    const fromY = actor.pos.gy;

    world.move(actor.pos, dash.dirX * step, dash.dirY * step);

    const moved = Math.hypot(actor.pos.gx - fromX, actor.pos.gy - fromY);
    budget -= step;
    dash.remaining -= step;

    // A diagonal dash that catches a wall keeps its other axis and slides,
    // which is what walking does and what feels right. Only a step that got
    // nowhere at all means the way is properly blocked.
    if (moved < step * 0.5) {
      actor.dash = null;
      return false;
    }
  }

  if (dash.remaining <= EPSILON) {
    actor.dash = null;
    return false;
  }
  return true;
}
