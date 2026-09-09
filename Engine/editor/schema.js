import { LIGHT_FIELDS, LIGHT_TYPES, normalizeLight } from '../src/data/lights.ts';
import { CHUNK_ROLES } from '../src/data/maps/chunks.ts';

/**
 * What each kind of map object exposes to the inspector. The panel renders
 * whatever it finds here, so a new editable property is one line in this file
 * rather than a new branch of UI code — the same trick data/lights.ts uses for
 * light types.
 *
 * Field kinds: text, select (fixed options), maps (the map registry), color,
 * range (a slider), bool.
 */

const FACES = [
  ['+x', '+x (toward camera)'],
  ['+y', '+y (toward camera)'],
  ['-x', '-x (behind wall)'],
  ['-y', '-y (behind wall)'],
];

/**
 * @typedef {import('./fields/types.ts').FieldSpec} FieldSpec
 * @typedef {Record<string, unknown>} MapObject
 * @typedef {{
 *   label: string,
 *   keyed?: boolean,
 *   fields?: FieldSpec[],
 *   fieldsFor?: (entry: MapObject) => FieldSpec[],
 *   describe: (entry: MapObject, key?: string) => string,
 * }} ObjectListSpec
 */

/** @type {Record<string, ObjectListSpec>} */
export const OBJECT_LISTS = {
  lights: {
    label: 'Light',
    /** Lights vary by type, so their fields are looked up per entry. */
    fieldsFor(entry) {
      const light = normalizeLight(entry);
      return [
        {
          key: 'type',
          kind: 'select',
          label: 'Type',
          options: Object.entries(LIGHT_TYPES).map(([id, spec]) => [id, spec.label]),
        },
        ...LIGHT_TYPES[light.type].fields.map((key) => {
          const field = LIGHT_FIELDS[key];
          return field.kind === 'number' ? { key, ...field, kind: 'range' } : { key, ...field };
        }),
      ];
    },
    describe(entry) {
      const light = normalizeLight(entry);
      return `${LIGHT_TYPES[light.type].label} light`;
    },
  },

  vfx: {
    label: 'Effect',
    // The picker's options are the game's own effect list, which lives in the
    // rules document — so the panel fills them in, the way it does for the
    // attribute pickers next door.
    fields: [{ key: 'id', kind: 'vfx', label: 'Effect' }],
    describe: (entry) => entry.id || 'No effect',
  },

  props: {
    label: 'Object',
    // The picker's options are the game's own object list, which lives in the
    // rules document — so the panel fills them in, the way it does for the
    // effect picker above.
    // Turn and lift are on top of whatever the object itself is set to, the
    // same way a placement's turn is: the definition says how the thing stands,
    // and these say how this one of them stands.
    fields: [
      { key: 'id', kind: 'prop', label: 'Object' },
      { key: 'rot', kind: 'range', label: 'Turn (deg)', min: 0, max: 345, step: 15 },
      { key: 'lift', kind: 'range', label: 'Lift', min: -2, max: 8, step: 0.05 },
    ],
    describe: (entry) => entry.id || 'No object',
  },

  portals: {
    label: 'Portal',
    fields: [
      { key: 'to', kind: 'maps', label: 'Goes to map' },
      { key: 'spawn', kind: 'text', label: 'Arrive at spawn named' },
      { key: 'label', kind: 'text', label: 'Label' },
      { key: 'color', kind: 'color', label: 'Colour' },
    ],
    describe: (entry) => `Portal to ${entry.to || '(nowhere)'}`,
  },

  monsters: {
    label: 'Monster',
    fields: [
      {
        key: 'kind',
        kind: 'select',
        label: 'Kind',
        options: [
          ['grunt', 'Grunt'],
          ['brute', 'Brute'],
          ['vase', 'Vase'],
        ],
      },
    ],
    // Read off the picker rather than spelled out again: a kind added there and
    // not here would show up in the list as the wrong thing.
    describe: (entry) =>
      OBJECT_LISTS.monsters.fields[0].options.find(([id]) => id === entry.kind)?.[1] ?? 'Grunt',
  },

  torches: {
    label: 'Torch',
    fields: [
      { key: 'face', kind: 'select', label: 'Mounted facing', options: FACES },
      { key: 'radius', kind: 'range', label: 'Radius', min: 1, max: 20, step: 0.5 },
    ],
    describe: (entry) => `Torch ${entry.face}`,
  },

  chunks: {
    label: 'Chunk',
    fields: [
      { key: 'name', kind: 'text', label: 'Name' },
      { key: 'role', kind: 'select', label: 'Role', options: CHUNK_ROLES },
      { key: 'w', kind: 'range', label: 'Width', min: 1, max: 40, step: 1 },
      { key: 'h', kind: 'range', label: 'Height', min: 1, max: 40, step: 1 },
    ],
    describe: (entry) =>
      `${Math.round(entry.w ?? 8)}×${Math.round(entry.h ?? 8)} ${
        CHUNK_ROLES.find(([id]) => id === (entry.role ?? ''))?.[1]?.toLowerCase() ?? 'filler'
      }`,
  },

  stations: {
    label: 'Station',
    fields: [{ key: 'label', kind: 'text', label: 'Name' }],
    describe: (entry) => entry.label || 'Crafting bench',
  },

  doors: {
    label: 'Door',
    // Nothing to configure: a door is a place, and which way it faces is
    // decided by which edge of the part it sits on rather than by a setting
    // that could disagree with the tile it is on.
    fields: [],
    describe: () => 'Door',
  },

  walls: {
    label: 'Wall',
    fields: [
      { key: 'stack', kind: 'range', label: 'Blocks high', min: 1, max: 8, step: 1 },
    ],
    describe: (entry) => {
      const stack = Math.max(1, Math.round(entry.stack ?? 1));
      return stack > 1 ? `Wall x${stack}` : 'Wall';
    },
  },

  spawns: {
    label: 'Spawn',
    keyed: true, // addressed by name, not by index
    fields: [{ key: 'name', kind: 'text', label: 'Name' }],
    describe: (entry, key) => `Spawn "${key}"`,
  },
};

/**
 * Order the object list section shows things in.
 *
 * Chunks are deliberately not in it. A chunk is not a thing *on* the map — it
 * is a rectangle of the map itself — and a generated map is mostly chunks, so
 * listing them buried the lights and the portals under a wall of pieces. They
 * are edited in the inspector's own Chunks tab, which is where the map's
 * structure lives rather than its contents.
 */
export const LIST_ORDER = [
  'lights',
  'vfx',
  'props',
  'portals',
  'monsters',
  'stations',
  'doors',
  'torches',
  'walls',
  'spawns',
];

export function fieldsFor(list, entry) {
  const spec = OBJECT_LISTS[list];
  return spec.fieldsFor ? spec.fieldsFor(entry) : spec.fields;
}

/** Every object on the map, flattened into rows the panel can list. */
export function objectRows(map) {
  const rows = [];
  for (const list of LIST_ORDER) {
    const spec = OBJECT_LISTS[list];
    if (spec.keyed) {
      for (const [key, entry] of Object.entries(map[list] ?? {})) {
        rows.push({ list, key, entry, label: spec.describe(entry, key) });
      }
    } else {
      (map[list] ?? []).forEach((entry, index) => {
        rows.push({ list, index, entry, label: spec.describe(entry) });
      });
    }
  }
  return rows;
}

/** Does a selection still point at something that exists? */
export function resolveSelection(map, selection) {
  if (!selection) return null;
  const spec = OBJECT_LISTS[selection.list];
  if (!spec) return null;
  const entry = spec.keyed
    ? (map[selection.list] ?? {})[selection.key]
    : (map[selection.list] ?? [])[selection.index];
  return entry ? { ...selection, entry, spec } : null;
}
