/**
 * Named surfaces.
 *
 * Found rather than listed. Every one of these is a folder under assets/ with
 * a material.json in it, so the folder *is* the record — copy the directory and
 * you have copied the material, pictures and all. A list here would be a
 * second place to remember, and the drift between the two is exactly what this
 * replaced.
 *
 * The pattern has to be a literal for the bundler to see through it, which is
 * why this is five small files rather than one loop over five names.
 *
 * The try/catch is for everything that is not Vite — `node --test`, say —
 * where `import.meta.glob` does not exist and an empty library beats a hard
 * crash. Same reason the maps in ../game.js have one.
 */

import { recordsFrom } from './records.js';

let found;
try {
  found = import.meta.glob('../assets/**/material.json', { eager: true, import: 'default' });
} catch {
  found = {};
}

export const MATERIALS = recordsFrom(found, 'material.json');
