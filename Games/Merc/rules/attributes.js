// Attribute definitions — rewritten wholesale by the EDITOR on the
// main menu. Values survive a round trip; comments and formatting inside the
// array below do not, so keep notes in the schema file instead.
// What each number means lives in ../attributes.js.

export const ATTRIBUTES = [
  { id: 'health', label: 'Health', kind: 'resource', base: 100, min: 0, max: 9999 },
  { id: 'healthRegen', label: 'Health regen', kind: 'stat', base: 0, min: 0, max: 999 },
  { id: 'attackPower', label: 'Attack power', kind: 'stat', base: 10, min: 0, max: 9999 },
  { id: 'armor', label: 'Armor', kind: 'stat', base: 0, min: 0, max: 9999 },
  { id: 'magicResist', label: 'Magic resist', kind: 'stat', base: 0, min: 0, max: 9999 },
  { id: 'moveSpeed', label: 'Move speed', kind: 'stat', base: 3, min: 0, max: 20 },
  { id: 'attackSpeed', label: 'Attacks / sec', kind: 'stat', base: 1, min: 0.1, max: 10 },
  { id: 'sight', label: 'Sight range', kind: 'stat', base: 7, min: 0, max: 60 },
];
