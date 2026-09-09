import { ATTRIBUTES } from '../data/attributes.ts';
import { ARCHETYPES, archetypeMap } from '../data/archetypes.ts';
import { PLAYER_RADIUS } from './world.js';
import { createAttributeSet } from './attributes.js';

/**
 * An actor: anything with attributes and a position. The player and every
 * monster are the same shape, which is the point — a brute differs from the
 * player by its archetype's numbers, not by a branch in the code.
 *
 * Knows nothing about rendering. `pos` is continuous grid coordinates, exactly
 * as World.move expects, so an actor can be handed straight to it.
 *
 * `cooldowns` is a map rather than the single timer this used to carry. One
 * scalar was the reason an actor could only ever have one attack; a map keyed
 * by ability id is the whole of what it takes to have several.
 */

export function createActor({
  archetype,
  gx = 0,
  gy = 0,
  radius = PLAYER_RADIUS,
  attributes = ATTRIBUTES,
  archetypes = ARCHETYPES,
}) {
  const specs = archetypes instanceof Map ? archetypes : archetypeMap(archetypes);
  const spec = specs.get(archetype) ?? specs.values().next().value;

  return {
    archetype,
    team: spec?.team ?? 'monster',
    grants: spec?.grants ?? [],
    // Ordered: position in this list is the input slot it answers to.
    abilities: spec?.abilities ?? [],
    attrs: createAttributeSet(attributes, spec?.attributes ?? {}),
    pos: { gx, gy },
    // Body half-width, in tiles. Melee range and projectile collision both
    // measure to the edge of a target rather than its centre.
    radius,
    facing: 0,
    alive: true,
    cooldowns: new Map(),
    // One shared timer for the whole ability bar. See globalRemaining().
    globalCooldown: 0,
    // The wind-up in progress, or null: { ability, aim, remaining, total, slow }.
    cast: null,
    // A finished cast's slow on its way out: { handle, value, remaining }.
    slowRelease: null,
    // The dash in progress, or null: { dirX, dirY, remaining, speed }.
    dash: null,
  };
}

/** Apply whatever the archetype hands out at spawn — regen, passives. */
export function grantStartingEffects(actor, effects) {
  for (const id of actor.grants) effects.apply(id, actor);
}

export const hostile = (a, b) => Boolean(a && b && a.team !== b.team);

/** Advance an actor's own timers. Effects are ticked by the runtime. */
export function tickActor(actor, dt) {
  if (actor.globalCooldown > 0) actor.globalCooldown = Math.max(0, actor.globalCooldown - dt);
  if (!actor.cooldowns.size) return;
  for (const [id, remaining] of actor.cooldowns) {
    const next = remaining - dt;
    if (next <= 0) actor.cooldowns.delete(id);
    else actor.cooldowns.set(id, next);
  }
}
