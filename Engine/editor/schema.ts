import { LIGHT_FIELDS, LIGHT_TYPES, normalizeLight } from '../src/data/lights.ts';
import { CHUNK_ROLES } from '../src/data/maps/chunks.ts';
import type { LightInput } from '../src/data/lights.ts';
import type { FieldSpec } from './fields/types.ts';
import type { Selection } from './state/selection.ts';

/**
 * One entry of a map's object lists, while the editor holds it.
 *
 * Deliberately a loose record. This module's whole job is to describe data it
 * did not write -- a map file may carry fields the editor has never heard of,
 * and saving must not drop them -- so every field it does read goes through
 * one of the two readers below rather than being promised a type.
 */
export type ObjectEntry = Record<string, unknown>;

/** A field read as text, which is what every `describe` wants. */
const text = (value: unknown): string => (typeof value === 'string' ? value : '');

/** A field read as a number, or the default the panel shows for it. */
const num = (value: unknown, fallback: number): number =>
  typeof value === 'number' && Number.isFinite(value) ? value : fallback;

/**
 * How one object list is edited.
 *
 * `fields` is a fixed set; `fieldsFor` is for a list whose fields depend on the
 * entry -- a light shows the settings its own kind has. `keyed` marks a list
 * addressed by name rather than by position, which only spawns are.
 */
export type ListSpec = {
  label: string;
  keyed?: boolean;
  fields?: FieldSpec[];
  fieldsFor?: (entry: ObjectEntry) => FieldSpec[];
  describe: (entry: ObjectEntry, key?: string) => string;
};

/** One row of the object tree. */
export type ObjectRow = {
  list: string;
  key?: string;
  index?: number;
  entry: ObjectEntry;
  label: string;
};

/**
 * The monster kinds, hoisted out of the table below.
 *
 * `describe` used to read them back out of `OBJECT_LISTS.monsters.fields[0]`,
 * which made the table refer to itself while it was still being described.
 */
const MONSTER_KINDS = [
  ['grunt', 'Grunt'],
  ['brute', 'Brute'],
  ['vase', 'Vase'],
] as const;

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
] as const;

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
export const OBJECT_LISTS: Record<string, ListSpec> = {
  lights: {
    label: 'Light',
    /** Lights vary by type, so their fields are looked up per entry. */
    fieldsFor(entry: ObjectEntry): FieldSpec[] {
      // `normalizeLight` is what decides what a loose record amounts to, which
      // is exactly why the record can be handed to it unchecked.
      const light = normalizeLight(entry as LightInput);
      return [
        {
          key: 'type',
          kind: 'select',
          label: 'Type',
          options: Object.entries(LIGHT_TYPES).map(([id, spec]) => [id, spec.label]),
        },
        ...LIGHT_TYPES[light.type].fields.map((key): FieldSpec => {
          const field = LIGHT_FIELDS[key];
          // A number reads better as a slider here than as a typed-in figure.
          return field.kind === 'number'
            ? ({ key, ...field, kind: 'range' } as FieldSpec)
            : ({ key, ...field } as FieldSpec);
        }),
      ];
    },
    describe(entry: ObjectEntry): string {
      const light = normalizeLight(entry as LightInput);
      return `${LIGHT_TYPES[light.type].label} light`;
    },
  },

  vfx: {
    label: 'Effect',
    // The picker's options are the game's own effect list, which lives in the
    // rules document — so the panel fills them in, the way it does for the
    // attribute pickers next door.
    fields: [{ key: 'id', kind: 'vfx', label: 'Effect' }],
    describe: (entry) => text(entry.id) || 'No effect',
  },

  prefabs: {
    label: 'Prefab',
    fields: [
      { key: 'id', kind: 'prefab', label: 'Prefab' },
      // Quarter turns, and the step says so. The children of a prefab sit on
      // whole tiles, so there is nowhere to put them at forty-five degrees --
      // a finer step here would offer an angle that cannot be represented.
      { key: 'rot', kind: 'range', label: 'Turn (deg)', min: 0, max: 270, step: 90 },
    ],
    describe: (entry) => text(entry.id) || 'No prefab',
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
    describe: (entry) => text(entry.id) || 'No object',
  },

  portals: {
    label: 'Portal',
    fields: [
      { key: 'to', kind: 'maps', label: 'Goes to map' },
      { key: 'spawn', kind: 'text', label: 'Arrive at spawn named' },
      { key: 'label', kind: 'text', label: 'Label' },
      { key: 'color', kind: 'color', label: 'Colour' },
    ],
    describe: (entry) => `Portal to ${text(entry.to) || '(nowhere)'}`,
  },

  monsters: {
    label: 'Monster',
    fields: [
      {
        key: 'kind',
        kind: 'select',
        label: 'Kind',
        options: MONSTER_KINDS,
      },
    ],
    // Read off the picker rather than spelled out again: a kind added there and
    // not here would show up in the list as the wrong thing.
    describe: (entry) => MONSTER_KINDS.find(([id]) => id === text(entry.kind))?.[1] ?? 'Grunt',
  },

  torches: {
    label: 'Torch',
    fields: [
      { key: 'face', kind: 'select', label: 'Mounted facing', options: FACES },
      { key: 'radius', kind: 'range', label: 'Radius', min: 1, max: 20, step: 0.5 },
    ],
    describe: (entry) => `Torch ${text(entry.face)}`,
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
      `${Math.round(num(entry.w, 8))}×${Math.round(num(entry.h, 8))} ${
        CHUNK_ROLES.find(([id]) => id === text(entry.role))?.[1]?.toLowerCase() ?? 'filler'
      }`,
  },

  stations: {
    label: 'Station',
    fields: [{ key: 'label', kind: 'text', label: 'Name' }],
    describe: (entry) => text(entry.label) || 'Crafting bench',
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
      const stack = Math.max(1, Math.round(num(entry.stack, 1)));
      return stack > 1 ? `Wall x${stack}` : 'Wall';
    },
  },

  spawns: {
    label: 'Spawn',
    keyed: true, // addressed by name, not by index
    fields: [{ key: 'name', kind: 'text', label: 'Name' }],
    describe: (_entry, key) => `Spawn "${key ?? ''}"`,
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
  'prefabs',
  'portals',
  'monsters',
  'stations',
  'doors',
  'torches',
  'walls',
  'spawns',
];

export function fieldsFor(list: string, entry: ObjectEntry): FieldSpec[] {
  const spec = OBJECT_LISTS[list];
  if (!spec) return [];
  return spec.fieldsFor ? spec.fieldsFor(entry) : (spec.fields ?? []);
}

/**
 * A map's object lists, reached by name.
 *
 * The lists are read by a name worked out at runtime, which an object type
 * cannot be indexed by. One cast here beats ten near-identical branches.
 */
const listsOf = (map: Record<string, unknown>) =>
  map as Record<string, readonly ObjectEntry[] | Record<string, ObjectEntry> | undefined>;

/** Every object on the map, flattened into rows the panel can list. */
export function objectRows(map: Record<string, unknown>): ObjectRow[] {
  const lists = listsOf(map);
  const rows: ObjectRow[] = [];
  for (const list of LIST_ORDER) {
    const spec = OBJECT_LISTS[list];
    if (!spec) continue;
    const held = lists[list];
    if (spec.keyed) {
      const byName = (held ?? {}) as Record<string, ObjectEntry>;
      for (const [key, entry] of Object.entries(byName)) {
        rows.push({ list, key, entry, label: spec.describe(entry, key) });
      }
    } else {
      const byIndex = (held ?? []) as readonly ObjectEntry[];
      byIndex.forEach((entry, index) => {
        rows.push({ list, index, entry, label: spec.describe(entry) });
      });
    }
  }
  return rows;
}

/** Does a selection still point at something that exists? */
export function resolveSelection(
  map: Record<string, unknown>,
  selection: Selection,
): (NonNullable<Selection> & { entry: ObjectEntry; spec: ListSpec }) | null {
  if (!selection) return null;
  const spec = OBJECT_LISTS[selection.list];
  if (!spec) return null;
  const held = listsOf(map)[selection.list];
  const entry = spec.keyed
    ? ((held ?? {}) as Record<string, ObjectEntry>)[selection.key ?? '']
    : ((held ?? []) as readonly ObjectEntry[])[selection.index ?? -1];
  return entry ? { ...selection, entry, spec } : null;
}
