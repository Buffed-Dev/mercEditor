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

import { ARCHETYPES } from '#game/rules/archetypes.js';

export { ARCHETYPES };

export function defaultArchetype(id = 'newArchetype') {
  return {
    id,
    label: 'New archetype',
    team: 'monster',
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

function normalizeArchetype(def) {
  return { ...defaultArchetype(def.id ?? 'newArchetype'), ...def };
}

export function archetypeMap(defs = ARCHETYPES) {
  return new Map(defs.map((def) => [def.id, normalizeArchetype(def)]));
}

export const TEAMS = [
  ['player', 'Player'],
  ['monster', 'Monster'],
];
