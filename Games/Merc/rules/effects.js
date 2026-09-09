// Effect definitions — rewritten wholesale by the EDITOR on the
// main menu. Values survive a round trip; comments and formatting inside the
// array below do not, so keep notes in the schema file instead.
// Duration, interval and the execute/modify rule are in ../effects.js.

export const EFFECTS = [
  {
    id: 'regen',
    label: 'Health regeneration',
    duration: 'infinite',
    interval: 1,
    stackable: false,
    modifiers: [
      {
        attribute: 'health',
        op: 'add',
        magnitude: { type: 'attribute', attribute: 'healthRegen', from: 'target', coefficient: 1 },
      },
    ],
  },
  {
    id: 'hit',
    label: 'Melee hit',
    duration: 'instant',
    execution: {
      id: 'damage',
      school: 'physical',
      magnitude: { type: 'attribute', attribute: 'attackPower', from: 'source', coefficient: 1 },
    },
  },
];
