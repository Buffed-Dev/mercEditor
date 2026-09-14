/**
 * Archetypes: who has which attribute values.
 *
 * Attribute *definitions* are global — what "attack power" means is the same
 * everywhere. Only the numbers differ per actor, so an archetype is a set of
 * base-value overrides, a team, and the effects granted at spawn. Anything not
 * overridden falls back to the attribute's own base.
 *
 * The player and every monster kind go through this one table, so a brute is
 * data rather than a branch in the monster code.
 *
 * `unarmed` is the attack the first key falls back to when nothing is held.
 * A weapon's own attack takes that key while it is equipped, so this is the
 * thing you can always do rather than one more thing you were given.
 *
 * `loot` names a table in ./lootTables.js rather than listing drops here,
 * because the same purse should be droppable by two monsters — and shortly by
 * things that are not monsters at all.
 */

import { ARCHETYPES as GAME_ARCHETYPES } from '#game/rules/archetypes.js';

/**
 * Which side an actor is on. Two, and combat asks for nothing finer: a thing
 * either fights the player or fights alongside them.
 */
export const TEAMS = [
  ['player', 'Player'],
  ['monster', 'Monster'],
] as const;

export type Team = (typeof TEAMS)[number][0];

/**
 * What drives an actor built from this archetype. `player` reads input, `ai`
 * runs the monster behaviour, `none` stands there — a vase, a crate, anything
 * that only exists to be hit.
 */
export const BRAINS = [
  ['none', 'None'],
  ['player', 'Player'],
  ['ai', 'AI'],
] as const;

export type Brain = (typeof BRAINS)[number][0];

export type Archetype = {
  id: string;
  label: string;
  team: Team;
  brain: Brain;
  /** Effect ids applied the moment the actor spawns. */
  grants: string[];
  /** Ordered: position in this list is the input slot the ability answers to. */
  abilities: string[];
  /** Ability id used when the main hand is empty. */
  unarmed: string;
  /** Base-value overrides by attribute id; anything absent falls back. */
  attributes: Record<string, number>;
  /** Loot table id, or empty for a thing that drops nothing. */
  loot: string;
};

/**
 * An archetype as a rules file writes it, before `normalizeArchetype` runs.
 *
 * `team` is a plain string and the attribute values may be missing, because
 * the rules files under `Games/` are hand-edited and sit outside the type
 * checker. Declaring the loose shape here is what makes the normalizer the one
 * place that decides what a typo becomes — previously a misspelled team was
 * carried into the game unchallenged and quietly produced an actor that
 * fought nobody.
 */
export type ArchetypeInput = {
  id?: string;
  label?: string;
  team?: string;
  brain?: string;
  grants?: readonly string[];
  abilities?: readonly string[];
  unarmed?: string;
  attributes?: Readonly<Record<string, number | undefined>>;
  loot?: string;
};

const isTeam = (value: unknown): value is Team => TEAMS.some(([id]) => id === value);
const isBrain = (value: unknown): value is Brain => BRAINS.some(([id]) => id === value);

/**
 * The set as it is written, not as it is understood.
 *
 * Left unnormalized on purpose: the rules editor reads this straight into the
 * document it later writes back, so filling in defaults here would bloat every
 * record in the file the first time anyone pressed save.
 */
export const ARCHETYPES = GAME_ARCHETYPES as ArchetypeInput[];

export function defaultArchetype(id = 'newArchetype'): Archetype {
  return {
    id,
    label: 'New archetype',
    team: 'monster',
    brain: 'none',
    grants: [],
    // Ordered: position in this list is the input slot the ability answers to.
    abilities: [],
    // What this actor does with an empty main hand. The first key is whatever
    // the main hand offers, so this is what sits there until something is
    // picked up — see ../game/loadout.js.
    unarmed: '',
    attributes: {},
    // Which loot table this pays out when it dies, by id. Empty means nothing
    // drops, which is what the player wants and what a harmless thing wants.
    loot: '',
  };
}

function normalizeArchetype(def: ArchetypeInput): Archetype {
  const base = defaultArchetype(def.id ?? 'newArchetype');

  // Copied key by key rather than spread, so a value that is not a number
  // cannot reach combat. An attribute map is the one field here a rules file
  // can fill with arbitrary keys, which makes it the one worth checking.
  const attributes: Record<string, number> = { ...base.attributes };
  for (const [key, value] of Object.entries(def.attributes ?? {})) {
    if (typeof value === 'number') attributes[key] = value;
  }

  return {
    ...base,
    ...def,
    team: isTeam(def.team) ? def.team : base.team,
    brain: isBrain(def.brain) ? def.brain : base.brain,
    grants: [...(def.grants ?? base.grants)],
    abilities: [...(def.abilities ?? base.abilities)],
    attributes,
  };
}

export function archetypeMap(
  defs: readonly ArchetypeInput[] = ARCHETYPES,
): Map<string, Archetype> {
  return new Map(defs.map((def) => [def.id ?? 'newArchetype', normalizeArchetype(def)]));
}
