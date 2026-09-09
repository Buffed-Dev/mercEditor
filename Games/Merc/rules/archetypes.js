// Archetypes — rewritten wholesale by the EDITOR on the
// main menu. Values survive a round trip; comments and formatting inside the
// array below do not, so keep notes in the schema file instead.
// Base-value overrides per actor; anything absent falls back to the attribute.

export const ARCHETYPES = [
  {
    id: 'player',
    label: 'Player',
    team: 'player',
    grants: ['regen'],
    abilities: ['basicAttack', 'handgun', 'bolt'],
    unarmed: 'punch',
    attributes: { health: 100, healthRegen: 2, attackPower: 14, armor: 0, moveSpeed: 5, attackSpeed: 1.2 },
  },
  {
    id: 'grunt',
    label: 'Grunt',
    team: 'monster',
    grants: [],
    abilities: ['gruntSwipe'],
    attributes: { health: 30, attackPower: 6, armor: 0, moveSpeed: 1.7, attackSpeed: 0.8, sight: 7 },
    loot: 'smallPurse',
  },
  {
    id: 'vase',
    label: 'Vase',
    team: 'monster',
    grants: [],
    abilities: [],
    attributes: { health: 12, armor: 0, moveSpeed: 0, sight: 0 },
    loot: 'vaseSpoils',
  },
  {
    id: 'brute',
    label: 'Brute',
    team: 'monster',
    grants: [],
    abilities: ['bruteSlam'],
    attributes: { health: 90, attackPower: 14, armor: 10, moveSpeed: 1.1, attackSpeed: 0.5, sight: 5.5 },
    loot: 'heavyPurse',
  },
];
