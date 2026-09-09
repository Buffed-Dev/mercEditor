// Crafting recipes — rewritten wholesale by the EDITOR on the
// main menu. Values survive a round trip; comments and formatting inside the
// array below do not, so keep notes in the schema file instead.
// Each spends currency and rolls one item definition; the shape is in ../recipes.js.

export const RECIPES = [
  { id: 'roughSword', label: 'Rough sword', item: 'shortSword', minBase: 1 },
  { id: 'oakShield', label: 'Oak shield', item: 'oakBuckler', minBase: 1 },
  { id: 'heavyAxe', label: 'Heavy axe', item: 'ironAxe', minBase: 2 },
  { id: 'handCannon', label: 'Hand cannon', item: 'handCannon', minBase: 2 },
];
