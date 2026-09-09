// Loot tables — rewritten wholesale by the EDITOR on the
// main menu. Values survive a round trip; comments and formatting inside the
// array below do not, so keep notes in the schema file instead.
// Whatever can be broken names one; the shape is in ../lootTables.js.

export const LOOT_TABLES = [
  {
    id: 'smallPurse',
    label: 'Small purse',
    rolls: [
      { kind: 'currency', id: 'gold', min: 2, max: 5, chance: 1 },
      { kind: 'item', id: 'ironOre', min: 1, max: 2, chance: 0.45 },
    ],
  },
  {
    id: 'vaseSpoils',
    label: 'Vase spoils',
    rolls: [
      { kind: 'currency', id: 'gold', min: 1, max: 4, chance: 1 },
      { kind: 'item', id: 'oakWood', min: 1, max: 2, chance: 0.5 },
      { kind: 'currency', id: 'shard', min: 1, max: 1, chance: 0.08 },
    ],
  },
  {
    id: 'heavyPurse',
    label: 'Heavy purse',
    rolls: [
      { kind: 'currency', id: 'gold', min: 6, max: 12, chance: 1 },
      { kind: 'item', id: 'ironOre', min: 2, max: 4, chance: 0.8 },
      { kind: 'item', id: 'emberDust', min: 1, max: 1, chance: 0.25 },
      { kind: 'currency', id: 'shard', min: 1, max: 1, chance: 0.15 },
    ],
  },
];
