import { ATTRIBUTES, type AttributeInput } from '../data/attributes.ts';
import {
  ARCHETYPES,
  archetypeMap,
  type Archetype,
  type ArchetypeInput,
  type Team,
} from '../data/archetypes.ts';
import type { Placed } from '../data/mapFormat.ts';
import { PLAYER_RADIUS } from './world.ts';
import { createAttributeSet, type AttributeSet } from './attributes.ts';
import type { Cast, Chain, SlowRelease } from './abilities.ts';
import type { Dash } from './dash.ts';

/**
 * Anything that stands in the world, acts, and can be knocked over.
 *
 * The player and every monster are the same shape; what differs is the
 * archetype they were built from. Everything after `alive` is the state of
 * something in progress, and is null when nothing is.
 */
export type Actor = {
  archetype: string;
  team: Team;
  /** Effect ids applied at spawn. */
  grants: readonly string[];
  /** Ability ids, in input-slot order. */
  abilities: readonly string[];
  attrs: AttributeSet;
  pos: Placed;
  /** Half the footprint, in tiles. */
  radius: number;
  facing: number;
  alive: boolean;
  /** Per-ability cooldowns still running, in seconds. */
  cooldowns: Map<string, number>;
  globalCooldown: number;
  cast: Cast | null;
  slowRelease: SlowRelease | null;
  dash: Dash | null;
  /**
   * Absent rather than null on a fresh actor: nothing sets it until a combo
   * is first used, and every reader reaches it through `?.`.
   */
  chain?: Chain | null;
};

/** What building an actor needs to know. */
export type CreateActorOptions = {
  archetype: string;
  gx?: number | undefined;
  gy?: number | undefined;
  radius?: number | undefined;
  attributes?: readonly AttributeInput[] | undefined;
  /** Either the raw list or a lookup already built from one. */
  archetypes?: readonly ArchetypeInput[] | Map<string, Archetype> | undefined;
  /** Base-value overrides over the archetype's — a prefab's, a placement's. */
  values?: Record<string, number> | undefined;
};

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
  values,
}: CreateActorOptions): Actor {
  const specs = archetypes instanceof Map ? archetypes : archetypeMap(archetypes);
  const spec = specs.get(archetype) ?? specs.values().next().value;

  return {
    archetype,
    team: spec?.team ?? 'monster',
    grants: spec?.grants ?? [],
    // Ordered: position in this list is the input slot it answers to.
    abilities: spec?.abilities ?? [],
    attrs: createAttributeSet(attributes, { ...spec?.attributes, ...values }),
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
export function grantStartingEffects(
  actor: Actor,
  // Structural on purpose: this needs the effect system only to hand it ids,
  // and naming the whole of it here would tie the actor to it.
  effects: { apply: (id: string, actor: Actor) => unknown },
): void {
  for (const id of actor.grants) effects.apply(id, actor);
}

export const hostile = (a: Actor | null | undefined, b: Actor | null | undefined): boolean =>
  Boolean(a && b && a.team !== b.team);

/** Advance an actor's own timers. Effects are ticked by the runtime. */
export function tickActor(actor: Actor, dt: number): void {
  if (actor.globalCooldown > 0) actor.globalCooldown = Math.max(0, actor.globalCooldown - dt);
  if (!actor.cooldowns.size) return;
  for (const [id, remaining] of actor.cooldowns) {
    const next = remaining - dt;
    if (next <= 0) actor.cooldowns.delete(id);
    else actor.cooldowns.set(id, next);
  }
}
