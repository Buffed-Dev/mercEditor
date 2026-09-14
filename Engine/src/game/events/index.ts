/**
 * When a trigger fires, and what may carry one.
 *
 * The other half of ../actions/. An action is a file and costs nothing else; an
 * event costs a place in the engine where it actually happens, so this table is
 * short on purpose and is meant to stay that way. Adding one is a row here plus
 * one call at its firing site — today those are the tile index and `useNear` in
 * render/level.ts, and `fireHits` and `reap` beside them.
 */


/**
 * The map lists an object can carry a trigger on.
 *
 * Not every list: a light is not a thing you walk into, a spawn is a name and a
 * tile, and a chunk is a rectangle of the map rather than a thing standing on
 * it. `prefabs` is deliberately absent: a prefab is not offered triggers by
 * being on a list — every prefab is on the one list — but by what it holds.
 * See `eventApplies`.
 */
export const WIRABLE_LISTS = [
  'walls',
  'torches',
  'doors',
  'props',
  'vfx',
] as const;

/**
 * One event: when it happens, and what may carry it.
 *
 * `needs` is the only thing standing between an event and every prefab, and it
 * is about what a prefab *holds* rather than what it was labelled. A prefab
 * used to declare a kind — Interactable, Creature — and that was a second place
 * to say what its triggers already said, free to disagree with them: adding an
 * interact trigger to a thing *is* saying it can be interacted with. What
 * cannot be derived that way is whether the engine has any way to fire the
 * trigger at all, and that is what this asks.
 */
export type EventSpec = {
  label: string;
  /** Map lists it reaches. `null` means every wirable one. */
  lists: readonly string[] | null;
  /** What a prefab must hold for this to be able to fire on it. */
  needs?: { has: (prefab: Record<string, unknown>) => boolean; say: string };
};

/** Is this prefab a body the engine can land a hit on — an actor? */
const hasBody = (prefab: Record<string, unknown>): boolean =>
  typeof prefab.archetype === 'string' && prefab.archetype !== '';

export const EVENTS: Record<string, EventSpec> = {
  collision: { label: 'On collision', lists: null },
  interact: { label: 'On interact', lists: null },
  /**
   * Being hit, and dying, need something that can be hit.
   *
   * Not "is it a creature" — a vase is not a creature and a torch you can put
   * out with a swing is not either. What it needs is a body the damage path
   * knows about, and there is exactly one way to say that: a prefab naming an
   * archetype. That is what makes it an actor, and an actor is what takes
   * damage. Neither reaches any plain list — only a prefab can be an actor.
   *
   * `dead` is for what *this* one does when it goes — the door it opens, the
   * thing it says. What every one of its kind drops is the archetype's `loot`,
   * and lives there.
   */
  hit: { label: 'On hit', lists: [], needs: { has: hasBody, say: 'needs an archetype' } },
  dead: { label: 'On death', lists: [], needs: { has: hasBody, say: 'needs an archetype' } },
};

/**
 * Should this thing be offered this trigger?
 *
 * An editor question, not a runtime one. What *fires* is whatever is written —
 * see `wiringsFor` — so changing what a prefab holds never silently stops a
 * trigger already on it working; it only changes what the panel offers next.
 */
export function eventApplies(
  event: string,
  list: string,
  entry?: Record<string, unknown>,
): boolean {
  const spec = EVENTS[event];
  if (!spec) return false;
  // Every trigger is offered on every prefab, save one the engine could not
  // fire. A prefab is whatever its contents make it.
  if (list === 'prefabs') return !spec.needs || spec.needs.has(entry ?? {});
  if (!(WIRABLE_LISTS as readonly string[]).includes(list)) return false;
  return spec.lists === null || spec.lists.includes(list);
}

/** Why a trigger is not on offer for this prefab, or null if it is. */
export function eventBlockedBy(event: string, prefab: Record<string, unknown>): string | null {
  const spec = EVENTS[event];
  if (!spec?.needs || spec.needs.has(prefab)) return null;
  return spec.needs.say;
}

/**
 * The wirings a thing carries for an event, in the order they should run.
 *
 * A list, because one trigger can do several things: a lever that opens the
 * gate *and* says so is two actions under one trigger, not two levers. One
 * written on its own is read as a list of one, so everything already in a map
 * file — and every default above — keeps working without being rewritten.
 *
 * Nothing is wired by which list it is on. There used to be a table here
 * saying a portal teleports and a bench opens crafting whether or not anybody
 * wired them — a second kind of behaviour beside this one, and invisible in the
 * panel. What a thing does is now only ever what is written on it.
 */
export function wiringsFor(
  _list: string,
  event: string,
  // Any loose record, not only a placed object: the editor asks this about a
  // prefab's children while working out what a placement of it can override,
  // and a child in a library record is the same shape without being on a map.
  object: Record<string, unknown>,
): Record<string, unknown>[] {
  const own = object[event];
  if (Array.isArray(own)) {
    const written = own.filter(
      (one): one is Record<string, unknown> => Boolean(one) && typeof one === 'object',
    );
    // An empty list is a trigger somebody added and has not filled in yet, not
    // an instruction to do nothing: falling through to the default is what
    // stops adding an empty "on collision" to a portal from quietly stopping it
    // taking you anywhere.
    if (written.length) return written;
  } else if (own && typeof own === 'object') {
    return [own as Record<string, unknown>];
  }
  return [];
}
