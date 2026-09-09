// Item definitions — rewritten wholesale by the EDITOR on the
// main menu. Values survive a round trip; comments and formatting inside the
// array below do not, so keep notes in the schema file instead.
// Stat lines are ranges, rolled per drop; the shape is in ../items.js.

export const ITEMS = [
  {
    id: 'gold',
    label: 'Gold',
    category: 'currency',
    icon: 'ra:gold-bar',
    start: 50,
    stats: [],
    costs: [],
  },
  {
    id: 'shard',
    label: 'Shard',
    category: 'currency',
    icon: 'ra:crystal-cluster',
    start: 0,
    stats: [],
    costs: [],
  },
  {
    id: 'ironOre',
    label: 'Iron ore',
    category: 'material',
    icon: 'ra:crystals',
    stats: [],
    costs: [],
  },
  {
    id: 'oakWood',
    label: 'Oak wood',
    category: 'material',
    icon: 'ra:pine-tree',
    stats: [],
    costs: [],
  },
  {
    id: 'emberDust',
    label: 'Ember dust',
    category: 'material',
    icon: 'ra:fire-symbol',
    stats: [],
    costs: [],
  },
  {
    id: 'shortSword',
    label: 'Short sword',
    category: 'weapon',
    icon: 'ra:sword',
    slot: 'mainHand',
    grants: 'swordCombo',
    stats: [
      { attribute: 'attackPower', op: 'add', min: 4, max: 6, step: 1 },
      { attribute: 'attackSpeed', op: 'override', min: 2, max: 2, step: 0.01 },
    ],
    costs: [{ kind: 'currency', id: 'gold', amount: 25 }],
  },
  {
    id: 'ironAxe',
    label: 'Iron axe',
    category: 'weapon',
    icon: 'ra:axe',
    slot: 'mainHand',
    grants: 'bruteSlam',
    stats: [
      { attribute: 'attackPower', op: 'add', min: 9, max: 14, step: 1 },
      { attribute: 'attackSpeed', op: 'override', min: 0.8, max: 0.8, step: 0.01 },
    ],
    costs: [
      { kind: 'currency', id: 'gold', amount: 80 },
      { kind: 'item', id: 'ironOre', amount: 5 },
      { kind: 'item', id: 'emberDust', amount: 1 },
    ],
  },
  {
    id: 'handCannon',
    label: 'Hand cannon',
    category: 'weapon',
    icon: 'ra:blaster',
    slot: 'mainHand',
    grants: 'handgun',
    stats: [
      { attribute: 'attackPower', op: 'add', min: 6, max: 9, step: 1 },
      { attribute: 'attackSpeed', op: 'override', min: 1.1, max: 1.1, step: 0.01 },
    ],
    costs: [
      { kind: 'currency', id: 'gold', amount: 120 },
      { kind: 'item', id: 'ironOre', amount: 4 },
      { kind: 'item', id: 'emberDust', amount: 2 },
    ],
  },
  {
    id: 'oakBuckler',
    label: 'Oak buckler',
    category: 'armour',
    icon: 'ra:shield',
    slot: 'offHand',
    stats: [{ attribute: 'armor', op: 'add', min: 3, max: 5, step: 1 }],
    costs: [{ kind: 'currency', id: 'gold', amount: 45 }, { kind: 'item', id: 'oakWood', amount: 3 }],
  },
];
