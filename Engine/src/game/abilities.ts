import { GLOBAL_COOLDOWN, type Ability } from '../data/abilities.ts';
import type { AttributeSet } from './attributes.ts';
import type { Cast, Chain, SlowRelease } from './actor.ts';

/** Whether an ability may fire, and if not, what stopped it. */
export type Activation = { ok: boolean; reason: string };

/**
 * The parts of an actor a wind-up touches.
 *
 * Named separately from `Actor` because that is all these functions read or
 * write: a cast needs somewhere to hang itself, the attributes it slows, and
 * a facing to turn. An `Actor` satisfies it, and so does anything else that
 * can be cast from -- which is what keeps this from being a promise the
 * functions do not keep.
 */
export type Caster = {
  attrs: AttributeSet;
  cast: Cast | null;
  slowRelease: SlowRelease | null;
  facing: number;
};

/** The one field a combo reads and writes. See `Caster` for why. */
export type Chainer = { chain?: Chain | null };
import { hostile, type Actor } from './actor.ts';

/**
 * The rules an ability is gated by, and the melee geometry.
 *
 * Everything here is pure: it reads an actor's attributes and cooldowns and
 * answers questions, but it does not know about scenes, effects or projectiles.
 * The level owns activation, because that is where the actor list, the world
 * and the effect runtime all are.
 */

/** Below this the division blows up; a cooldown rate of zero means "as fast as possible". */
const MIN_RATE = 0.05;

/**
 * How long this ability locks its own slot for.
 *
 * `cooldownRate` divides, so an attribute that gets bigger makes the ability
 * fire more often — attackSpeed 1.2 turns a 1 second cooldown into 0.833. That
 * is exactly the `1 / attackSpeed` the hardcoded basic attack used to do, only
 * now any ability can scale off any attribute.
 *
 * The global cooldown is *not* in here. It is a separate timer shared by every
 * slot, so adding it to each one as well would charge for it twice: an ability
 * with a 1 second cooldown would come back in 1.1, having already waited out
 * the shared 0.1 in the first tenth of that.
 */
export function cooldownSeconds(ability: Ability, actor: Actor | null | undefined): number {
  const base = Math.max(0, ability.cooldown ?? 0);
  const rate = ability.cooldownRate ? (actor?.attrs?.value(ability.cooldownRate) ?? 1) : 1;
  return base / Math.max(MIN_RATE, rate);
}

/**
 * How long until this actor may use *anything*.
 *
 * One timer for the whole bar rather than one per slot: firing any ability
 * stops every other one for GLOBAL_COOLDOWN. That is what keeps a slot with no
 * cooldown of its own from firing every frame, and it is also what stops three
 * abilities all going off on the same frame because three buttons were held.
 */
export function globalRemaining(actor: Actor | null | undefined): number {
  return Math.max(0, actor?.globalCooldown ?? 0);
}

function cooldownRemaining(actor: Actor | null | undefined, abilityId: string): number {
  return actor?.cooldowns?.get(abilityId) ?? 0;
}

/**
 * 0 when ready, 1 when just fired — what the HUD draws over a slot.
 *
 * Whichever of the two timers has longer to run, because the slot is unusable
 * until both are done. Without the global one every slot would read as ready
 * during the tenth of a second none of them can actually be used, which looks
 * exactly like a bug in the input handling.
 */
export function cooldownFraction(ability: Ability, actor: Actor | null | undefined): number {
  const total = cooldownSeconds(ability, actor);
  const own = total > 0 ? cooldownRemaining(actor, ability.id) / total : 0;
  const shared = GLOBAL_COOLDOWN > 0 ? globalRemaining(actor) / GLOBAL_COOLDOWN : 0;
  return Math.min(1, Math.max(0, Math.max(own, shared)));
}

/**
 * May this actor fire this ability right now? Returns a reason rather than a
 * bare false, so the HUD and the tests can say *why* nothing happened.
 */
export function canActivate(
  ability: Ability | null | undefined,
  actor: Actor | null | undefined,
): Activation {
  if (!ability) return { ok: false, reason: 'unknown' };
  if (!actor?.alive) return { ok: false, reason: 'dead' };
  if (cooldownRemaining(actor, ability.id) > 0) return { ok: false, reason: 'cooldown' };
  // Shared across the whole bar: using one ability holds all of them.
  if (globalRemaining(actor) > 0) return { ok: false, reason: 'global' };

  if (ability.costAttribute && ability.cost > 0) {
    if (actor.attrs.current(ability.costAttribute) < ability.cost) {
      return { ok: false, reason: 'cost' };
    }
  }

  return { ok: true, reason: '' };
}

/** Spend the cost. Only ever called once canActivate has said yes. */
export function payCost(ability: Ability, actor: Actor): number {
  if (!ability.costAttribute || !(ability.cost > 0)) return 0;
  return actor.attrs.applyDelta(ability.costAttribute, -ability.cost);
}

export function beginCooldown(ability: Ability, actor: Actor): void {
  const seconds = cooldownSeconds(ability, actor);
  if (seconds > 0) actor.cooldowns.set(ability.id, seconds);
  // Every ability pays the shared one, including the ones with no cooldown of
  // their own — which are exactly the ones that need it.
  actor.globalCooldown = GLOBAL_COOLDOWN;
}

/**
 * Start a wind-up.
 *
 * The slow is an ordinary attribute modifier rather than a special case in the
 * movement code, so it composes with every other thing that touches move speed
 * and applies to monsters for free. A castSlow of 1 multiplies speed by zero,
 * which roots the caster without needing a "rooted" flag anywhere.
 */
export function beginCast(ability: Ability, actor: Caster, aim: number): Cast {
  // Whatever the last cast is still letting go of, this one replaces outright:
  // two slows on one actor would stack into a caster who can barely walk.
  clearSlowRelease(actor);

  const cast: Cast = {
    ability,
    aim,
    remaining: ability.castTime,
    total: ability.castTime,
    handle: null,
  };

  if (ability.castSlow > 0) {
    cast.handle = actor.attrs.addModifier({
      attribute: 'moveSpeed',
      op: 'multiply',
      value: -ability.castSlow,
      source: cast,
    });
  }

  actor.cast = cast;
  return cast;
}

/**
 * How long a cast slow takes to let go of the caster, in seconds.
 *
 * Lifting it outright reads as a lurch: the ability lands and the caster is
 * already at a dead run in the same frame. Easing it out is short enough that
 * nobody is waiting on it and long enough to feel like weight coming off.
 */
const SLOW_RELEASE = 0.2;

/** Drop a slow still on its way out, at once and without ceremony. */
function clearSlowRelease(actor: Caster): void {
  if (!actor.slowRelease) return;
  actor.attrs.removeModifier(actor.slowRelease.handle);
  actor.slowRelease = null;
}

/**
 * Drop a wind-up, handing its slow to the release. Cancelling forfeits the
 * cost — and an interrupted cast eases off exactly like a finished one, since
 * the lurch is the same lurch either way.
 */
export function endCast(actor: Caster): Cast | null {
  const cast = actor.cast;
  if (!cast) return null;
  if (cast.handle) {
    actor.slowRelease = { handle: cast.handle, value: cast.handle.value, remaining: SLOW_RELEASE };
  }
  actor.cast = null;
  return cast;
}

/**
 * Ease a finished cast's slow away, over SLOW_RELEASE seconds.
 *
 * The same modifier the wind-up laid down, walked back to nothing rather than
 * pulled out — so it still composes with everything else on move speed on the
 * way out, exactly as it did on the way in.
 *
 * Called for every actor every frame, casting or not: the ramp outlives the
 * wind-up that started it, which is the whole point of it.
 */
export function updateCastSlow(actor: Caster, dt: number): void {
  const release = actor.slowRelease;
  if (!release) return;

  release.remaining -= dt;
  if (release.remaining <= 0) {
    clearSlowRelease(actor);
    return;
  }
  actor.attrs.setModifier(release.handle, release.value * (release.remaining / SLOW_RELEASE));
}

/**
 * Turn toward a heading, taking whatever is winding up with it.
 *
 * Free when nothing is casting. During a wind-up the ability's own castTurn
 * caps how fast the body comes round, in degrees per second, and the cast is
 * re-aimed as it goes — so the shape on the ground follows the cursor right up
 * until it lands, and a 0 commits the direction at the moment of pressing.
 */
export function turnActor(actor: Caster, heading: number, dt: number): number {
  const cast = actor.cast;
  if (!cast) {
    actor.facing = heading;
    return actor.facing;
  }

  const most = ((cast.ability.castTurn ?? 0) * Math.PI * dt) / 180;
  const delta = angleBetween(actor.facing, heading);
  const turned = actor.facing + Math.sign(delta) * Math.min(Math.abs(delta), most);
  // Kept inside (-PI, PI], so it stays the same number a heading read straight
  // off atan2 is and comparing two of them never depends on how they got there.
  actor.facing = Math.atan2(Math.sin(turned), Math.cos(turned));
  cast.aim = actor.facing;
  return actor.facing;
}

/** 0 at the moment of pressing, 1 as the ability goes off — for a cast bar. */
export function castProgress(actor: Caster | null | undefined): number {
  const cast = actor?.cast;
  if (!cast || cast.total <= 0) return 0;
  return Math.min(1, Math.max(0, 1 - cast.remaining / cast.total));
}

/** Shortest signed angle from a to b, so a swing works across the ±PI wrap. */
export function angleBetween(a: number, b: number): number {
  const offset = b - a;
  return Math.atan2(Math.sin(offset), Math.cos(offset));
}

/**
 * Everything hostile inside the cone. `aim` is a heading in the same space as
 * `actor.facing` — atan2(dx, dy) over grid coordinates.
 *
 * Range is measured to the *edge* of a target rather than its centre, which is
 * what the hardcoded melee did and is what stops a fat brute being unhittable
 * at a range its own body already covers.
 */
export function coneHits(
  caster: Actor,
  aim: number,
  ability: Ability,
  candidates: readonly Actor[],
): Actor[] {
  const halfArc = ((ability.arc ?? 360) * Math.PI) / 360;
  const hits: Actor[] = [];

  for (const target of candidates) {
    if (target === caster || !target.alive || !hostile(caster, target)) continue;

    const dx = target.pos.gx - caster.pos.gx;
    const dy = target.pos.gy - caster.pos.gy;
    const distance = Math.hypot(dx, dy);
    if (distance > ability.range + (target.radius ?? 0)) continue;

    // Standing exactly on top of the caster has no direction; count it as a hit
    // rather than letting atan2(0, 0) decide.
    if (distance > 1e-6 && Math.abs(angleBetween(aim, Math.atan2(dx, dy))) > halfArc) continue;

    hits.push(target);
  }

  return hits;
}

/**
 * Combos: which step of a chain an actor is on.
 *
 * The state lives on the actor rather than on the ability, because the ability
 * is one shared definition and two grunts swinging the same combo are not on
 * the same step of it. It is a single slot, not one per combo: pressing a
 * different combo starts that one from the beginning, which is what you want
 * from a bar where two chains are two separate weapons.
 */
export function chainIndex(actor: Chainer | null | undefined, combo: Ability): number {
  const chain = actor?.chain;
  return chain?.id === combo.id ? chain.index : 0;
}

/**
 * Move the chain on after a step fired.
 *
 * @returns true when that step was the finisher, which is when the combo's own
 * cooldown starts.
 */
export function advanceChain(actor: Chainer, combo: Ability): boolean {
  const next = chainIndex(actor, combo) + 1;
  if (next >= combo.steps.length) {
    actor.chain = null;
    return true;
  }
  actor.chain = {
    id: combo.id,
    index: next,
    remaining: combo.chainWindow,
    // Recovery before the next step may be started. Counted from the moment
    // this one landed, so it is the gap between blows rather than between
    // keypresses.
    gap: Math.max(0, combo.stepGap ?? 0),
  };
  return false;
}

/**
 * May the next step be started yet, or is the chain still recovering?
 *
 * Separate from `canActivate`, which answers for one ability: this is the
 * combo's own pacing and belongs to the chain, not to whichever step happens
 * to be next.
 */
export function chainReady(actor: Chainer | null | undefined, combo: Ability): boolean {
  const chain = actor?.chain;
  return !(chain?.id === combo.id && chain.gap > 0);
}

/** 1 the moment a step lands, easing to 0 as the next becomes available. */
export function chainGapFraction(actor: Chainer | null | undefined, combo: Ability): number {
  const chain = actor?.chain;
  const gap = chain?.id === combo.id ? chain.gap : 0;
  const total = combo.stepGap ?? 0;
  return gap > 0 && total > 0 ? Math.min(1, gap / total) : 0;
}

/**
 * Let a half-finished chain lapse.
 *
 * Without a window a combo would sit on its second step indefinitely, so
 * walking away from a fight and coming back would open the next one with a
 * finisher — the chain has to be something you keep going, not somewhere you
 * park.
 */
export function updateChain(actor: Chainer, dt: number): void {
  const chain = actor.chain;
  if (!chain) return;

  // The recovery runs first and the window waits its turn. They measure two
  // different things — how long until you *may* press, and how long you may
  // dawdle once you can — and running them together would mean a recovery
  // longer than the window dropped the chain before it could be continued.
  if (chain.gap > 0) {
    chain.gap -= dt;
    return;
  }

  chain.remaining -= dt;
  if (chain.remaining <= 0) actor.chain = null;
}
