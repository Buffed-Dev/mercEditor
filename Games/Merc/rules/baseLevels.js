// Base levels — rewritten wholesale by the EDITOR on the
// main menu. Values survive a round trip; comments and formatting inside the
// array below do not, so keep notes in the schema file instead.
// Each row is what reaching that level costs; the shape is in ../baseLevels.ts.

export const BASE_LEVELS = [
  { id: 'baseTwo', level: 2, costs: [{ kind: 'currency', id: 'gold', amount: 100 }] },
  {
    id: 'baseThree',
    level: 3,
    costs: [
      { kind: 'currency', id: 'gold', amount: 260 },
      { kind: 'currency', id: 'shard', amount: 1 },
    ],
  },
  {
    id: 'baseFour',
    level: 4,
    costs: [
      { kind: 'currency', id: 'gold', amount: 600 },
      { kind: 'currency', id: 'shard', amount: 4 },
    ],
  },
];
