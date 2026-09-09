import { createActor, type Actor, type CreateActorOptions } from './actor.ts';
import type { MapObject, Placed } from '../data/mapFormat.ts';

/** How one kind of monster is built and drawn. */
export type MonsterKind = { radius: number; color: number; scale: number; prop?: boolean };

/** What building a monster needs beyond its place on the map. */
export type MonsterDeps = Pick<CreateActorOptions, 'attributes' | 'archetypes'>;

/** Fires one of an actor's abilities, and says whether it went off. */
export type Activate = (actor: Actor, abilityId: string, aim: number) => { ok: boolean };

/**
 * All a monster asks of the world: that it be pushed, and stopped by walls.
 *
 * The return is ignored -- where it ended up is read back off the position it
 * was handed -- so this says `unknown` rather than promising a `Placed`.
 */
export type Mover = { move: (pos: Placed, dgx: number, dgy: number) => unknown };

/**
 * Monster behaviour, with no opinion about how a monster is drawn: each one
 * owns an actor — position, attributes and all — and moves through World.move
 * exactly like the player does, so walls, ramps and drops constrain them the
 * same way.
 *
 * Two states, no pathfinding: wander near where they spawned until the player
 * comes within sight, then walk straight at them. A monster that loses the
 * player walks home. Straight-line chasing means they get stuck on corners,
 * which is fine at this scale and is the kind of thing a nav grid fixes later.
 *
 * Speed and sight are attributes now, read fresh every frame, so a slow effect
 * or a blinding one works on monsters with no code here knowing about it. What
 * is left in KINDS is the part that is not a stat: how big the body is and what
 * colour it renders.
 *
 * A vase is one of these. Not because a pot is a monster, but because every
 * question the code below asks about one has the same answer either way: it
 * stands somewhere, it can be hit, it has health, and something falls out of it
 * when that runs out. A vase with no sight never chases and one with no move
 * speed never wanders, so the behaviour above switches itself off without a
 * branch — `prop` says only that it should not be *drawn* with a face, which is
 * the view's business and not this file's.
 */

const KINDS = {
  grunt: { radius: 0.28, color: 0xb4553f, scale: 0.85 },
  brute: { radius: 0.38, color: 0x7a3f6d, scale: 1.25 },
  vase: { radius: 0.26, color: 0xa9754a, scale: 0.5, prop: true },
} as const satisfies Record<string, MonsterKind>;

const isKind = (kind: string): kind is keyof typeof KINDS => kind in KINDS;

/** The kind a definition names, or the ordinary one. */
export const kindOf = (kind: string): MonsterKind => (isKind(kind) ? KINDS[kind] : KINDS.grunt);

const WANDER_RADIUS = 3.5; // how far from home a wandering monster will drift
const REPATH_MIN = 1.2; // seconds between picking new wander headings
const REPATH_MAX = 3.0;
const GIVE_UP = 1.6; // sight range is multiplied by this before losing the player
const WANDER_PACE = 0.45; // fraction of move speed used while not chasing

function randomHeading(): { x: number; y: number } {
  const a = Math.random() * Math.PI * 2;
  return { x: Math.cos(a), y: Math.sin(a) };
}

class Monster {
  kind: string;
  spec: MonsterKind;
  actor: Actor;
  /** Where it was spawned, and what it drifts back toward. */
  home: Placed;
  chasing: boolean;
  heading: { x: number; y: number };
  repathIn: number;

  constructor(
    { gx, gy, kind = 'grunt' }: { gx: number; gy: number; kind?: string },
    { attributes, archetypes }: MonsterDeps = {},
  ) {
    this.kind = kind;
    this.spec = kindOf(kind);
    this.actor = createActor({
      archetype: kind,
      gx: gx + 0.5,
      gy: gy + 0.5,
      // Melee reach and projectile collision both measure to a body's edge,
      // so the actor needs to know how wide it is.
      radius: kindOf(kind).radius,
      attributes,
      archetypes,
    });
    this.home = { gx: gx + 0.5, gy: gy + 0.5 };
    this.chasing = false;
    this.heading = randomHeading();
    this.repathIn = Math.random() * REPATH_MAX;
  }

  /** Where the view draws it. Owned by the actor, exposed for convenience. */
  get pos(): Placed {
    return this.actor.pos;
  }

  get facing(): number {
    return this.actor.facing;
  }

  get alive(): boolean {
    return this.actor.alive;
  }

  /**
   * @param {World} world
   * @param {{gx:number, gy:number}} target the player
   * @param {Function} activate `(actor, abilityId, aim)` from the level, or
   *   omitted when nothing should be able to attack.
   */
  update(world: Mover, target: Placed, dt: number, activate?: Activate | null): void {
    // A dash owns the body while it lasts; steering during one would fight it.
    if (this.actor.dash) return;

    const { pos } = this.actor;
    const dx = target.gx - pos.gx;
    const dy = target.gy - pos.gy;
    const dist = Math.hypot(dx, dy);

    // Hysteresis on the sight check, so a monster at the edge of its range does
    // not flicker between chasing and wandering every frame.
    const sight = this.actor.attrs.value('sight');
    const range = this.chasing ? sight * GIVE_UP : sight;
    this.chasing = dist < range;

    let dirX: number;
    let dirY: number;

    if (this.chasing && dist > 1e-3) {
      dirX = dx / dist;
      dirY = dy / dist;
    } else {
      this.repathIn -= dt;
      const fromHome = Math.hypot(pos.gx - this.home.gx, pos.gy - this.home.gy);
      if (this.repathIn <= 0 || fromHome > WANDER_RADIUS) {
        // Past the leash, head home rather than picking another random heading.
        this.heading =
          fromHome > WANDER_RADIUS
            ? {
                x: (this.home.gx - pos.gx) / fromHome,
                y: (this.home.gy - pos.gy) / fromHome,
              }
            : randomHeading();
        this.repathIn = REPATH_MIN + Math.random() * (REPATH_MAX - REPATH_MIN);
      }
      dirX = this.heading.x;
      dirY = this.heading.y;
    }

    const speed = this.actor.attrs.value('moveSpeed') * (this.chasing ? 1 : WANDER_PACE);
    const before = { ...pos };
    world.move(pos, dirX * speed * dt, dirY * speed * dt);

    // Walked into something: pick a new heading now instead of grinding along
    // the wall until the next repath.
    const moved = Math.hypot(pos.gx - before.gx, pos.gy - before.gy);
    if (!this.chasing && moved < speed * dt * 0.4) {
      this.heading = randomHeading();
      this.repathIn = REPATH_MIN;
    }

    if (moved > 1e-4) this.actor.facing = Math.atan2(pos.gx - before.gx, pos.gy - before.gy);

    // Attacking is the last thing it does, so it swings from where it ended up
    // rather than where it started the frame.
    if (this.chasing && activate) this.tryAttack(target, activate);
  }

  /**
   * Fire the first granted ability that will go off. Aim is straight at the
   * player rather than the walking direction — a monster that has just slid
   * along a wall is still facing along it, and would otherwise swing at
   * nothing while standing on top of you.
   */
  tryAttack(target: Placed, activate: Activate): void {
    const { pos } = this.actor;
    const aim = Math.atan2(target.gx - pos.gx, target.gy - pos.gy);
    for (const id of this.actor.abilities) {
      if (activate(this.actor, id, aim).ok) return;
    }
  }
}

/**
 * Build the monsters a map declares. Returns an empty list for maps with none,
 * so callers never need to special-case a peaceful map.
 */
export function spawnMonsters(
  map: { monsters?: readonly MapObject[] },
  deps: MonsterDeps = {},
): Monster[] {
  return (map.monsters ?? []).map((def) => new Monster(def, deps));
}

export function updateMonsters(
  monsters: readonly Monster[],
  world: Mover,
  target: Placed,
  dt: number,
  activate?: Activate | null,
): void {
  for (const monster of monsters) monster.update(world, target, dt, activate);
}

export { KINDS as MONSTER_KINDS };

// The class stays private as a value -- monsters are made by `spawnMonsters` --
// but callers need to be able to name what they were handed.
export type { Monster };
