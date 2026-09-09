// Terrain definitions — rewritten wholesale by the EDITOR on the
// main menu. Values survive a round trip; comments and formatting inside the
// array below do not, so keep notes in the schema file instead.
// What the ground is made of; the shape is in ../../../Engine/src/data/terrains.ts.

export const TERRAINS = [
  {
    id: 'grass',
    label: 'Grass',
    char: 'gr',
    top: 'material3',
    sub: 'material3',
    top90: '',
    top180: '',
    top270: '',
    sub90: '',
    sub180: '',
    sub270: '',
    tint: 16777215,
  },
  {
    id: 'sand',
    label: 'Sand',
    char: 'sa',
    top: 'material2',
    sub: 'material2',
    top90: '',
    top180: '',
    top270: '',
    sub90: '',
    sub180: '',
    sub270: '',
    tint: 16777215,
  },
  {
    id: 'grassSand',
    label: 'GrassSand',
    char: 'gs',
    top: 'material',
    sub: 'material',
    top90: '',
    top180: '',
    top270: '',
    sub90: '',
    sub180: '',
    sub270: '',
    tint: 16777215,
  },
];
