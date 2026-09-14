import { LIGHT_FIELDS, LIGHT_TYPES, normalizeLight } from '../src/data/lights.ts';
import { ACTIONS } from '../src/game/actions/index.ts';
import { EVENTS, WIRABLE_LISTS, eventApplies, wiringsFor } from '../src/game/events/index.ts';
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
 * What each kind of map object exposes to the inspector. The panel renders
 * whatever it finds here, so a new editable property is one line in this file
 * rather than a new branch of UI code — the same trick data/lights.ts uses for
 * light types.
 *
 * Field kinds: text, select (fixed options), maps (the map registry), color,
 * range (a slider), bool.
 */

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

/**
 * The transform every placed thing has. See `Transform` in data/transform.ts.
 *
 * Positions are typed rather than dragged on a slider: a thing at 12.37 is a
 * thing at 12.37, and a slider over a forty-tile map cannot say so. Lift is the
 * Y of the three, drawn between the two ground axes so the row reads X Y Z.
 */
/** X, Y, Z — a tuple, because the light panel takes two of the three by name. */
const POSITION: [FieldSpec, FieldSpec, FieldSpec] = [
  { key: 'gx', kind: 'number', label: 'X', step: 0.1 },
  { key: 'lift', kind: 'number', label: 'Y', step: 0.05, default: 0 },
  { key: 'gy', kind: 'number', label: 'Z', step: 0.1 },
];
const ROTATION: FieldSpec[] = [
  { key: 'rotX', kind: 'number', label: 'X', step: 5, default: 0 },
  { key: 'rot', kind: 'number', label: 'Y', step: 5, default: 0 },
  { key: 'rotZ', kind: 'number', label: 'Z', step: 5, default: 0 },
];
const SCALE: FieldSpec[] = [
  { key: 'scaleX', kind: 'number', label: 'X', min: 0.01, step: 0.05, default: 1 },
  { key: 'scaleY', kind: 'number', label: 'Y', min: 0.01, step: 0.05, default: 1 },
  { key: 'scaleZ', kind: 'number', label: 'Z', min: 0.01, step: 0.05, default: 1 },
];
export const TRANSFORM: FieldSpec[] = [...POSITION, ...ROTATION, ...SCALE];

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
        // A light has a height of its own, so only the ground axes here.
        POSITION[0],
        POSITION[2],
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
    fields: [{ key: 'id', kind: 'vfx', label: 'Effect' }, ...POSITION],
    describe: (entry) => text(entry.id) || 'No effect',
  },

  prefabs: {
    label: 'Prefab',
    // The whole transform: a placement is turned, scaled and lifted the way an
    // object is, and its children go through it. See prefabObjects.
    fields: [{ key: 'id', kind: 'prefab', label: 'Prefab' }, ...TRANSFORM],
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
    fields: [{ key: 'id', kind: 'prop', label: 'Object' }, ...TRANSFORM],
    describe: (entry) => text(entry.id) || 'No object',
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

  doors: {
    label: 'Door',
    // Nothing to configure: a door is a place, and which way it faces is
    // decided by which edge of the part it sits on rather than by a setting
    // that could disagree with the tile it is on.
    fields: POSITION,
    describe: () => 'Door',
  },

  spawns: {
    label: 'Spawn',
    keyed: true, // addressed by name, not by index
    fields: [{ key: 'name', kind: 'text', label: 'Name' }, ...POSITION],
    describe: (_entry, key) => `Spawn "${key ?? ''}"`,
  },
};

/**
 * Order the object list section shows things in.
 *
 * Chunks are deliberately not in it. A chunk is not a thing *on* the map — it
 * is a rectangle of the map itself — and a generated map is mostly chunks, so
 * listing them buried the lights and the props under a wall of pieces. They
 * are edited in the inspector's own Chunks tab, which is where the map's
 * structure lives rather than its contents.
 */
export const LIST_ORDER = [
  'lights',
  'vfx',
  'props',
  'prefabs',
  'doors',
  'spawns',
];

/** Where the records being edited are read from. See Inspector.tsx. */
export type RulesLookup = { list: (kind: string) => readonly ObjectEntry[] };

/**
 * What this one placement of a prefab says differently.
 *
 * A prefab holds the default — a portal that goes nowhere in particular — and a
 * placement overrides it, which is what makes one record worth placing forty
 * times. The settings offered are the ones its own children actually have, read
 * off the prefab being pointed at rather than listed here: a prefab of a portal
 * offers a destination, and a prefab of a rock offers nothing.
 *
 * Keys are `set.<variable>`. What that reaches on the way down is `override` in
 * `Engine/src/data/prefabs.ts`.
 */
function overrideFields(entry: ObjectEntry, rules: RulesLookup | undefined): FieldSpec[] {
  const id = text(entry.id);
  const prefab = id ? rules?.list('prefabs').find((record) => text(record.id) === id) : null;
  if (!prefab) return [];

  const fields: FieldSpec[] = [];
  const seen = new Set<string>();

  /** Everything under this prefab that runs something: itself, then its parts. */
  const sources: { list: string; entry: ObjectEntry }[] = [{ list: 'prefabs', entry: prefab }];
  for (const list of WIRABLE_LISTS) {
    for (const child of (Array.isArray(prefab[list]) ? prefab[list] : []) as ObjectEntry[]) {
      sources.push({ list, entry: child });
    }
  }

  for (const { list, entry: source } of sources) {
    for (const event of Object.keys(EVENTS)) {
      // The source goes in too: when it is the prefab itself, which triggers
      // it may carry is decided by its category rather than by its list.
      if (!eventApplies(event, list, source)) continue;
      for (const wiring of wiringsFor(list, event, source)) {
        const action = typeof wiring.do === 'string' ? ACTIONS[wiring.do] : null;
        for (const one of action?.vars ?? []) {
          // Only what is actually carried: `override` writes a name where that
          // name already is, so offering one nothing has would be a control
          // that quietly does nothing.
          if (!(one.key in source || one.key in wiring) || seen.has(one.key)) continue;
          seen.add(one.key);
          fields.push({ ...one, key: `set.${one.key}`, kind: one.kind as FieldSpec['kind'] });
        }
      }
    }
  }
  return fields;
}

export function fieldsFor(
  list: string,
  entry: ObjectEntry,
  rules?: RulesLookup,
): FieldSpec[] {
  const spec = OBJECT_LISTS[list];
  if (!spec) return [];
  const own = spec.fieldsFor ? spec.fieldsFor(entry) : (spec.fields ?? []);
  // What a thing *does* is not a field: a trigger holds a list of actions, and
  // a list needs adding to and taking from. It is drawn by the Wirings
  // subeditor beside these, the way an effect's modifiers are.
  if (list === 'prefabs') return [...own, ...overrideFields(entry, rules)];
  return own;
}

/**
 * A map's object lists, reached by name.
 *
 * The lists are read by a name worked out at runtime, which an object type
 * cannot be indexed by. One cast here beats ten near-identical branches.
 */
const listsOf = (map: Record<string, unknown>) =>
  map as Record<string, readonly ObjectEntry[] | Record<string, ObjectEntry> | undefined>;

/**
 * What a thing does, appended to what it is: "Door — opens a panel".
 *
 * Added here rather than inside eleven `describe` functions, for the same
 * reason the event fields are added in `fieldsFor` rather than in eleven
 * tables: a wiring is something any object can carry, so it is described once.
 *
 * Only the first, when a thing does two things. The row is a line in a list,
 * not a summary — the inspector is one click away and says everything.
 */
function doing(entry: ObjectEntry): string {
  for (const event of Object.keys(EVENTS)) {
    const wiring = entry[event] as Record<string, unknown> | undefined;
    const action = typeof wiring?.do === 'string' ? ACTIONS[wiring.do] : null;
    if (action) return ` — ${action.label.toLowerCase()}`;
  }
  return '';
}

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
        rows.push({ list, index, entry, label: spec.describe(entry) + doing(entry) });
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
