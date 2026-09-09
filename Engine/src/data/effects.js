/**
 * Effects: everything that changes an attribute.
 *
 * One shape covers damage, regeneration, poison, buffs and roguelike upgrades,
 * which is the whole point — combat and progression stop being separate code
 * paths. What separates them is the duration and the interval:
 *
 *   | duration            | interval | behaviour                              |
 *   | instant             | –        | executes once, permanently             |
 *   | duration / infinite | 0        | adds live modifiers, stripped on expiry|
 *   | duration / infinite | > 0      | executes every N seconds               |
 *
 * The execute/modify split is the rule the whole system rests on. Executing
 * changes the underlying value and cannot be undone — a damage tick is gone.
 * Modifying never touches the base; it layers a modifier that is removed when
 * the effect ends, so a 20-second buff reverts to exactly where it started.
 * Blur the two and a buff either never expires or refunds itself twice.
 *
 * A magnitude is a literal or a reading of an attribute:
 *
 *   { type: 'constant',  value: 2 }
 *   { type: 'attribute', attribute: 'healthRegen', from: 'target', coefficient: 1 }
 *
 * `from` is 'target' or 'source' (whoever applied the effect). Executions
 * resolve magnitudes on every tick, never snapshotting them, which is what
 * makes an upgrade work: raise healthRegen and the regen effect below ticks
 * harder on its very next tick, knowing nothing about the upgrade. Live
 * modifiers resolve once at application — as GAS also does — because a
 * modifier whose value depends on an attribute it is modifying has no
 * fixed point.
 */

import { EFFECTS } from '#game/rules/effects.js';

export const DURATION_TYPES = {
  instant: {
    label: 'Instant',
    hint: 'Applies once and is done. Permanent — damage, a health potion.',
    fields: ['label', 'duration'],
  },
  duration: {
    label: 'For a while',
    hint: 'Lasts a set time, then reverts cleanly.',
    fields: ['label', 'duration', 'seconds', 'interval', 'stackable'],
  },
  infinite: {
    label: 'Until removed',
    hint: 'Lasts until something removes it. Regen, equipment, a run upgrade.',
    fields: ['label', 'duration', 'interval', 'stackable'],
  },
};

export const MODIFIER_OPS = [
  ['add', '+ add'],
  ['multiply', '× multiply'],
  ['override', '= override'],
];

export const MAGNITUDE_TYPES = [
  ['constant', 'A fixed number'],
  ['attribute', 'Read an attribute'],
];

export const MAGNITUDE_SOURCES = [
  ['target', "the target's"],
  ['source', "the caster's"],
];

export const EFFECT_FIELDS = {
  label: { kind: 'text', label: 'Name', default: 'New effect' },
  duration: {
    kind: 'select',
    label: 'Duration',
    options: Object.entries(DURATION_TYPES).map(([id, spec]) => [id, spec.label]),
    default: 'instant',
  },
  seconds: { kind: 'range', label: 'Lasts (sec)', min: 0, max: 60, step: 0.5, default: 10 },
  // Zero means "not periodic": the modifiers go live instead of executing.
  interval: { kind: 'range', label: 'Repeat every (sec)', min: 0, max: 10, step: 0.1, default: 0 },
  stackable: { kind: 'bool', label: 'Stackable', default: false },
};

/** Code-backed calculations, for maths a modifier cannot express. */
export const EXECUTIONS = [['damage', 'Damage']];

export { EFFECTS };

function defaultMagnitude() {
  return { type: 'constant', value: 1 };
}

export function defaultModifier() {
  return { attribute: 'health', op: 'add', magnitude: defaultMagnitude() };
}

export function defaultEffect(id = 'newEffect') {
  const def = { id };
  for (const key of DURATION_TYPES.instant.fields) def[key] = EFFECT_FIELDS[key].default;
  return { ...def, modifiers: [], execution: null };
}

export function normalizeEffect(def) {
  const duration = DURATION_TYPES[def.duration] ? def.duration : 'instant';
  return {
    ...defaultEffect(def.id ?? 'newEffect'),
    seconds: EFFECT_FIELDS.seconds.default,
    stackable: EFFECT_FIELDS.stackable.default,
    ...def,
    duration,
    // An instant effect has nothing to expire and nothing to repeat.
    interval: duration === 'instant' ? 0 : (def.interval ?? 0),
    modifiers: (def.modifiers ?? []).map((mod) => ({
      attribute: mod.attribute,
      op: mod.op ?? 'add',
      magnitude: { ...defaultMagnitude(), ...(mod.magnitude ?? {}) },
    })),
    execution: def.execution ? { ...def.execution } : null,
  };
}

export function effectMap(defs = EFFECTS) {
  return new Map(defs.map((def) => [def.id, normalizeEffect(def)]));
}
