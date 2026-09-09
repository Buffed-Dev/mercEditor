// Item categories — rewritten wholesale by the EDITOR on the
// main menu. Values survive a round trip; comments and formatting inside the
// array below do not, so keep notes in the schema file instead.
// Each names the machine it runs on; the shape is in ../categories.js.

export const CATEGORIES = [
  { id: 'weapon', label: 'Weapon', behaviour: 'equipment', icon: 'ra:sword' },
  { id: 'armour', label: 'Armour', behaviour: 'equipment', icon: 'ra:shield' },
  { id: 'material', label: 'Material', behaviour: 'material', icon: 'ra:gem' },
  { id: 'currency', label: 'Currency', behaviour: 'currency', icon: 'ra:gold-bar' },
];
