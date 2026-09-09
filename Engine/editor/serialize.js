/**
 * Turn an edited map back into the text of a map module. The output has to be
 * a file a person would be happy to open and hand-edit afterwards — the editor
 * writes real source into src/data/maps/, not an opaque blob, so a map stays
 * reviewable in git and editable without the editor.
 */

import { encodeTerrain } from '../src/data/terrain/codec.ts';
import { quote } from './literal.ts';
import { DEFAULT_ENV, normalizeEnv } from '../src/data/mapFormat.ts';

const hex = (value) => `0x${(value ?? 0).toString(16).padStart(6, '0')}`;

const constName = (id) => id.replace(/[^a-z0-9]+/gi, '_').toUpperCase();

/**
 * Which folder of the object list a thing sits in, if any.
 *
 * The group is a label on the object rather than a list of members somewhere
 * else, so deleting the object takes its membership with it and nothing ever
 * points at a thing that is gone. It means nothing to the game — nothing reads
 * it but the editor's own list — which is why it is written only when set.
 */
const grp = (entry) => (entry.group ? `, group: ${quote(entry.group)}` : '');

function listBody(entries, format, indent = '    ') {
  if (!entries.length) return null;
  return entries.map((entry) => `${indent}${format(entry)},`).join('\n');
}

function block(label, body) {
  return body === null ? `  ${label}: [],` : `  ${label}: [\n${body}\n  ],`;
}

/**
 * @param {object} map the edited document
 * @param {(id: string) => string} [charOf] a terrain id to its two-character
 *   grid key. The editor answers from the terrain records being edited.
 */
export function serializeMap(map, charOf = () => '') {
  // The two grids, read out of the live typed arrays. Printed one above the
  // other because they are read together: one says how tall a column is, the
  // other what it is made of and whether it is there.
  const grid = encodeTerrain(map.terrain, map.terrainIds ?? [], charOf);
  const height = grid.height.map((row) => `    '${row}',`).join('\n');
  const terrain = grid.terrain.map((row) => `    '${row}',`).join('\n');
  const keys = Object.entries(grid.terrainKeys)
    .map(([key, id]) => `${quote(key)}: ${quote(id)}`)
    .join(', ');

  const spawnEntries = Object.entries(map.spawns ?? {}).map(
    ([key, s]) => `    ${quote(key)}: { gx: ${s.gx}, gy: ${s.gy}${grp(s)} },`,
  );
  const spawns = spawnEntries.length
    ? `  spawns: {\n${spawnEntries.join('\n')}\n  },`
    : '  spawns: {},';

  const portals = listBody(
    map.portals ?? [],
    (p) =>
      `{ gx: ${p.gx}, gy: ${p.gy}, to: ${quote(p.to)}, spawn: ${quote(p.spawn)}, ` +
      `color: ${hex(p.color)}, label: ${quote(p.label ?? p.to)}${grp(p)} }`,
  );

  // A wall of one block writes no stack, so the common case stays short.
  const walls = listBody(map.walls ?? [], (w) => {
    const stack = Math.max(1, Math.round(w.stack ?? 1));
    return stack > 1
      ? `{ gx: ${w.gx}, gy: ${w.gy}, stack: ${stack}${grp(w)} }`
      : `{ gx: ${w.gx}, gy: ${w.gy}${grp(w)} }`;
  });

  const doors = listBody(map.doors ?? [], (d) => `{ gx: ${d.gx}, gy: ${d.gy}${grp(d)} }`);

  // What makes this file a piece of a place rather than a place. Written only
  // when it is set, so an ordinary map's file is untouched by clusters
  // existing at all.
  const part = [
    map.startZ ? `  startZ: ${+Number(map.startZ).toFixed(3)},` : null,
    // Only when it is not the ordinary one block, so a map that never thought
    // about it does not carry an answer to a question nobody asked.
    map.stepHeight !== undefined && map.stepHeight !== 1
      ? `  stepHeight: ${+Number(map.stepHeight).toFixed(3)},`
      : null,
    map.generated ? '  generated: true,' : null,
    map.chunkCount ? `  chunkCount: ${Math.round(map.chunkCount)},` : null,
  ]
    .filter(Boolean)
    .join('\n');

  const monsters = listBody(
    map.monsters ?? [],
    (m) => `{ gx: ${m.gx}, gy: ${m.gy}, kind: ${quote(m.kind)}${grp(m)} }`,
  );

  const torches = listBody(
    map.torches ?? [],
    (t) => `{ gx: ${t.gx}, gy: ${t.gy}, face: ${quote(t.face)}, radius: ${t.radius ?? 5}${grp(t)} }`,
  );

  // The rectangles a generated map is cut into. Written even when the map is
  // not generated: the toggle is a switch, and turning it off must not throw
  // away the layout so that turning it back on finds nothing.
  const chunks = listBody(map.chunks ?? [], (c) => {
    const role = c.role ? `, role: ${quote(c.role)}` : '';
    const size = `w: ${Math.round(c.w)}, h: ${Math.round(c.h)}`;
    return `{ gx: ${c.gx}, gy: ${c.gy}, ${size}, name: ${quote(c.name)}${role}${grp(c)} }`;
  });

  const stations = listBody(
    map.stations ?? [],
    (station) =>
      `{ gx: ${station.gx}, gy: ${station.gy}, ` +
      `label: ${quote(station.label ?? 'Crafting bench')}${grp(station)} }`,
  );

  // Lights carry different fields per type, so write whatever the light
  // actually has rather than a fixed column order.
  const lights = listBody(map.lights ?? [], (light) => {
    const fields = Object.entries(light)
      .filter(([key]) => key !== 'type')
      .map(([key, value]) => {
        if (key.endsWith('Color') || key === 'color') return `${key}: ${hex(value)}`;
        // Every other field of a light is a number or a flag; the group is the
        // one string, and an unquoted one would be a reference to nothing.
        return `${key}: ${typeof value === 'string' ? quote(value) : value}`;
      });
    return `{ type: ${quote(light.type)}, ${fields.join(', ')} }`;
  });

  // A placed object is a tile and which definition stands on it. Its turn is
  // written only when it has one, so the ordinary case stays one short line.
  const placed = listBody(map.props ?? [], (entry) => {
    const turn = Math.round(entry.rot ?? 0);
    const rot = turn ? `, rot: ${turn}` : '';
    // Likewise the height it stands at, so the ordinary object on the ground
    // stays one short line.
    const raise = Number(entry.lift ?? 0);
    const lift = raise ? `, lift: ${+raise.toFixed(3)}` : '';
    return `{ gx: ${entry.gx}, gy: ${entry.gy}, id: ${quote(entry.id ?? '')}${rot}${lift}${grp(entry)} }`;
  });

  const effects = listBody(
    map.vfx ?? [],
    (entry) => `{ gx: ${entry.gx}, gy: ${entry.gy}, id: ${quote(entry.id ?? '')}${grp(entry)} }`,
  );

  // Written from the table that defines what an env *is*, rather than from a
  // list here that has to be remembered alongside it. A setting added there
  // now saves itself.
  const env = normalizeEnv(map.env);
  const envLines = Object.keys(DEFAULT_ENV)
    .map((key) => {
      const value = env[key];
      if (typeof value === 'boolean') return `    ${key}: ${value},`;
      // Colours read as colours: nobody looking at a map file wants to work out
      // what 14077368 was supposed to be.
      const colour = key === 'sky' || key.endsWith('Color');
      return `    ${key}: ${colour ? hex(value) : value},`;
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

${block('walls', walls)}

${block('portals', portals)}

${block('monsters', monsters)}

${block('doors', doors)}

  env: {
${envLines}
  },

${block('lights', lights)}

${block('torches', torches)}

${block('props', placed)}

${block('vfx', effects)}

${block('stations', stations)}

${block('chunks', chunks)}
};
`;
}
