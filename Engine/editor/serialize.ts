/**
 * Turn an edited map back into the text of a map module. The output has to be
 * a file a person would be happy to open and hand-edit afterwards — the editor
 * writes real source into src/data/maps/, not an opaque blob, so a map stays
 * reviewable in git and editable without the editor.
 */

import { encodeTerrain } from '../src/data/terrain/codec.ts';
import { literal, quote } from './literal.ts';
import { DEFAULT_ENV, normalizeEnv } from '../src/data/mapFormat.ts';
import type { GameMap } from '../src/data/mapFormat.ts';
import type { TerrainGrid } from '../src/data/terrain/grid.ts';
import { DEFAULT_RIM, normalizeRim, type RimRing } from '../src/data/terrain/profile.ts';
import { finite } from '../src/util/numbers.ts';

/**
 * A map as the editor holds it.
 *
 * The one difference from what a file holds is `terrain`: the editor has the
 * live grid, and writing a file is exactly the step that turns it back into
 * rows. Anything with only rows has nothing to serialize.
 */
export type EditorMap = Omit<GameMap, 'terrain'> & {
  terrain: TerrainGrid;
  /** Which terrain each grid value stands for, in the order they were added. */
  terrainIds?: readonly string[];
};

/**
 * One thing a map places, as this file reads it.
 *
 * Loose on purpose: a map file may carry fields the editor has never heard of,
 * and what is written back has to include them. Every field read below goes
 * through `text` or `num` rather than being promised a type.
 */
type Entry = Record<string, unknown>;

/** A field read as a number, or what to write when it is not one. */
const num = finite;

/**
 * The rim, when it is not the one every map gets for free.
 *
 * Eight rings written out in full. They are *derived* from two numbers — the
 * width and depth the sliders tune — but the file holds what the format says it
 * holds, which is rings, so nothing has to import the curve that made them to
 * read the map back.
 *
 * Left out entirely when it matches the default, the same way `stepHeight` is:
 * a map that never touched the edge should not carry an answer to a question
 * nobody asked. That the rim was not written *at all* is why edge settings did
 * not survive a save.
 */
function rimLine(rim: readonly RimRing[] | null | undefined): string | null {
  if (!rim || rim.length < 2) return null;
  const rings = normalizeRim(rim);
  const round = (value: number) => +num(value).toFixed(4);
  const same =
    rings.length === DEFAULT_RIM.length &&
    rings.every(
      (ring, i) =>
        round(ring.inset) === round(DEFAULT_RIM[i]?.inset ?? 0) &&
        round(ring.drop) === round(DEFAULT_RIM[i]?.drop ?? 0),
    );
  if (same) return null;
  const body = rings.map((ring) => `{ inset: ${round(ring.inset)}, drop: ${round(ring.drop)} }`);
  return `  terrainRim: [\n${body.map((one) => `    ${one},`).join('\n')}\n  ],`;
}

/** A map's lists, reached by name. See schema.ts for the same shape. */
const listOf = (map: Record<string, unknown>, name: string): Entry[] => {
  const held = map[name];
  return Array.isArray(held) ? (held as Entry[]) : [];
};

const hex = (value: unknown) => `0x${num(value).toString(16).padStart(6, '0')}`;

const constName = (id: string) => id.replace(/[^a-z0-9]+/gi, '_').toUpperCase();

/**
 * Which folder of the object list a thing sits in, if any.
 *
 * The group is a label on the object rather than a list of members somewhere
 * else, so deleting the object takes its membership with it and nothing ever
 * points at a thing that is gone. It means nothing to the game — nothing reads
 * it but the editor's own list — which is why it is written only when set.
 */
const grp = (entry: Entry) => (entry.group ? `, group: ${quote(entry.group)}` : '');

/**
 * Whatever the formatter above did not write.
 *
 * The comment on `Entry` has always promised that a field the editor never
 * heard of survives a save. Every formatter below is a fixed column list, so it
 * never did: a hand-edited extra was dropped silently the first time the map
 * was saved. Each formatter now says which keys it handled and this prints the
 * rest.
 *
 * That is also why an action's variables need no line anywhere in this file. A
 * wiring is a bag on the object — `interact: { do: 'openUI', ui: 'crafting' }`
 * — and `literal` already writes nested objects, quotes what needs quoting and
 * keeps short ones on one line. Add the two hundredth action and this is
 * untouched.
 *
 * `prefab` is skipped: it is the back-reference `expandPrefabs` staples onto a
 * child so a pick can be resolved back to the placement that drew it, and it is
 * never a thing a file holds.
 */
const rest = (entry: Entry, written: readonly string[]): string => {
  const extra = Object.entries(entry)
    .filter(
      ([key, value]) =>
        !written.includes(key) &&
        key !== 'prefab' &&
        value !== undefined &&
        // An empty list is a trigger with nothing under it, which is nothing.
        // The library writer drops these too, for the same reason.
        !(Array.isArray(value) && !value.length),
    )
    .map(([key, value]) => `${key}: ${literal(value)}`);
  return extra.length ? `, ${extra.join(', ')}` : '';
};

function listBody(
  entries: readonly Entry[],
  format: (entry: Entry) => string,
  indent = '    ',
): string | null {
  if (!entries.length) return null;
  return entries.map((entry) => `${indent}${format(entry)},`).join('\n');
}

function block(label: string, body: string | null): string {
  return body === null ? `  ${label}: [],` : `  ${label}: [\n${body}\n  ],`;
}

/**
 * @param {object} map the edited document
 * @param {(id: string) => string} [charOf] a terrain id to its two-character
 *   grid key. The editor answers from the terrain records being edited.
 */
export function serializeMap(
  map: EditorMap,
  charOf: (id: string) => string = () => '',
): string {
  // The lists are reached by name, which an object type cannot be indexed by.
  const lists = map as unknown as Record<string, unknown>;
  // The two grids, read out of the live typed arrays. Printed one above the
  // other because they are read together: one says how tall a column is, the
  // other what it is made of and whether it is there.
  const grid = encodeTerrain(map.terrain, (lists.terrainIds as string[] | undefined) ?? [], charOf);
  const height = grid.height.map((row) => `    '${row}',`).join('\n');
  const terrain = grid.terrain.map((row) => `    '${row}',`).join('\n');
  const keys = Object.entries(grid.terrainKeys)
    .map(([key, id]) => `${quote(key)}: ${quote(id)}`)
    .join(', ');

  const spawnEntries = Object.entries((map.spawns ?? {}) as Record<string, Entry>).map(
    ([key, s]) =>
      `    ${quote(key)}: { gx: ${num(s.gx)}, gy: ${num(s.gy)}${grp(s)}` +
      `${rest(s, ['gx', 'gy', 'group'])} },`,
  );
  const spawns = spawnEntries.length
    ? `  spawns: {\n${spawnEntries.join('\n')}\n  },`
    : '  spawns: {},';

  const doors = listBody(
    listOf(lists, 'doors'),
    (d) => `{ gx: ${num(d.gx)}, gy: ${num(d.gy)}${grp(d)}${rest(d, ['gx', 'gy', 'group'])} }`,
  );

  // What makes this file a piece of a place rather than a place. Written only
  // when it is set, so an ordinary map's file is untouched by clusters
  // existing at all.
  const part = [
    map.startZ ? `  startZ: ${+num(map.startZ).toFixed(3)},` : null,
    // Only when it is not the ordinary one block, so a map that never thought
    // about it does not carry an answer to a question nobody asked.
    map.stepHeight !== undefined && map.stepHeight !== 1
      ? `  stepHeight: ${+num(map.stepHeight).toFixed(3)},`
      : null,
    rimLine(map.terrainRim),
    map.generated ? '  generated: true,' : null,
    map.chunkCount ? `  chunkCount: ${Math.round(num(map.chunkCount))},` : null,
  ]
    .filter(Boolean)
    .join('\n');

  // The rectangles a generated map is cut into. Written even when the map is
  // not generated: the toggle is a switch, and turning it off must not throw
  // away the layout so that turning it back on finds nothing.
  const chunks = listBody(listOf(lists, 'chunks'), (c) => {
    const role = c.role ? `, role: ${quote(c.role)}` : '';
    const size = `w: ${Math.round(num(c.w, 8))}, h: ${Math.round(num(c.h, 8))}`;
    const more = rest(c, ['gx', 'gy', 'w', 'h', 'name', 'role', 'group']);
    return `{ gx: ${num(c.gx)}, gy: ${num(c.gy)}, ${size}, name: ${quote(c.name)}${role}${grp(c)}${more} }`;
  });

  // Lights carry different fields per type, so write whatever the light
  // actually has rather than a fixed column order.
  const lights = listBody(listOf(lists, 'lights'), (light) => {
    const fields = Object.entries(light)
      .filter(([key]) => key !== 'type')
      .map(([key, value]) => {
        if (key.endsWith('Color') || key === 'color') return `${key}: ${hex(value)}`;
        // Every other field of a light is a number or a flag; the group is the
        // one string, and an unquoted one would be a reference to nothing.
        return `${key}: ${typeof value === 'string' ? quote(value) : String(value)}`;
      });
    return `{ type: ${quote(light.type)}, ${fields.join(', ')} }`;
  });

  // A placed object is a tile and which definition stands on it. Its turn is
  // written only when it has one, so the ordinary case stays one short line.
  const placed = listBody(listOf(lists, 'props'), (entry) => {
    const turn = Math.round(num(entry.rot));
    const rot = turn ? `, rot: ${turn}` : '';
    // Likewise the height it stands at, so the ordinary object on the ground
    // stays one short line.
    const raise = num(entry.lift);
    const lift = raise ? `, lift: ${+raise.toFixed(3)}` : '';
    return (
      `{ gx: ${num(entry.gx)}, gy: ${num(entry.gy)}, ` +
      `id: ${quote(entry.id ?? '')}${rot}${lift}${grp(entry)}` +
      `${rest(entry, ['gx', 'gy', 'id', 'rot', 'lift', 'group'])} }`
    );
  });

  // One line for however many objects it stands for, which is the whole point
  // of it. A turn of zero is left out, like a prop's.
  const arrangements = listBody(listOf(lists, 'prefabs'), (entry) => {
    const turn = Math.round(num(entry.rot));
    const rot = turn ? `, rot: ${turn}` : '';
    return (
      `{ gx: ${num(entry.gx)}, gy: ${num(entry.gy)}, ` +
      `id: ${quote(entry.id ?? '')}${rot}${grp(entry)}` +
      `${rest(entry, ['gx', 'gy', 'id', 'rot', 'group'])} }`
    );
  });

  const effects = listBody(
    listOf(lists, 'vfx'),
    (entry) =>
      `{ gx: ${num(entry.gx)}, gy: ${num(entry.gy)}, id: ${quote(entry.id ?? '')}${grp(entry)}` +
      `${rest(entry, ['gx', 'gy', 'id', 'group'])} }`,
  );

  // Written from the table that defines what an env *is*, rather than from a
  // list here that has to be remembered alongside it. A setting added there
  // now saves itself.
  const env = normalizeEnv(map.env);
  const envLines = Object.keys(DEFAULT_ENV)
    .map((key) => {
      const value = (env as Record<string, unknown>)[key];
      if (typeof value === 'boolean') return `    ${key}: ${value},`;
      // Colours read as colours: nobody looking at a map file wants to work out
      // what 14077368 was supposed to be.
      const colour = key === 'sky' || key.endsWith('Color');
      return `    ${key}: ${colour ? hex(value) : String(value)},`;
    })
    .join('\n');

  return `// ${map.name} — written by the in-game map editor.
// Safe to hand-edit. \`height\` is one character per cell: '.' at level 0,
// '1'-'9' above it. \`terrain\` is two characters per cell, keyed by
// \`terrainKeys\`, and '..' where there is no cell at all. Which edges are
// cliffs, which corners are bevelled and where one surface blends into another
// are all worked out from these two grids — none of it is stored here.
// Coordinates in the lists below are integer tile indices.

export const ${constName(map.id)} = {
  id: ${quote(map.id)},
  name: ${quote(map.name)},
${part}
  terrainKeys: { ${keys} },

  height: [
${height}
  ],

  terrain: [
${terrain}
  ],


${spawns}


${block('doors', doors)}

  env: {
${envLines}
  },

${block('lights', lights)}

${block('props', placed)}

${block('vfx', effects)}

${block('prefabs', arrangements)}

${block('chunks', chunks)}
};
`;
}
