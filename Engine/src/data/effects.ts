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

import { EFFECTS as GAME_EFFECTS } from '#game/rules/effects.js';

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
} as const;

/** How long an effect lasts. The three `DURATION_TYPES` keys, and no others. */
export type DurationType = keyof typeof DURATION_TYPES;

export const isDurationType = (value: unknown): value is DurationType =>
  typeof value === 'string' && value in DURATION_TYPES;

export const MODIFIER_OPS = [
  ['add', '+ add'],
  ['multiply', '× multiply'],
  ['override', '= override'],
] as const;

/** How a modifier combines with what is already there. */
export type ModifierOp = (typeof MODIFIER_OPS)[number][0];

export const MAGNITUDE_TYPES = [
  ['constant', 'A fixed number'],
  ['attribute', 'Read an attribute'],
] as const;

/** Whether a magnitude is a number or a reading taken from an actor. */
export type MagnitudeType = (typeof MAGNITUDE_TYPES)[number][0];

export const MAGNITUDE_SOURCES = [
  ['target', "the target's"],
  ['source', "the caster's"],
] as const;

/** Whose attribute an `attribute` magnitude reads. */
export type MagnitudeSource = (typeof MAGNITUDE_SOURCES)[number][0];

/**
 * How much of something: a fixed number, or a live reading of an attribute.
 *
 * Every field past `type` is optional because which ones matter is decided by
 * it -- a constant carries `value` and an attribute reading carries the other
 * three -- and because the resolver in `game/effects` already reads each one
 * through a `??` default. Splitting this into a discriminated union would
 * describe the data more tightly than the code that reads it actually is, and
 * the merge in `normalizeMagnitude` would then have to lie to rebuild it.
 */
export type Magnitude = {
  type: MagnitudeType;
  /** For `constant`. */
  value?: number;
  /** For `attribute`: which one. */
  attribute?: string;
  /** For `attribute`: whose. */
  from?: MagnitudeSource;
  /** For `attribute`: what the reading is multiplied by. */
  coefficient?: number;
};

/** A magnitude as a rules file writes it. */
export type MagnitudeInput = {
  type?: string;
  value?: number;
  attribute?: string;
  from?: string;
  coefficient?: number;
};

/** One change an effect makes to one attribute. */
export type Modifier = { attribute: string; op: ModifierOp; magnitude: Magnitude };

/** A modifier as a rules file writes it. */
export type ModifierInput = { attribute?: string; op?: ModifierOp; magnitude?: MagnitudeInput };

/**
 * A named calculation an effect hands its work to, with its parameters.
 *
 * Deliberately loose: an execution is the escape hatch for maths that data
 * cannot express, so what it carries is decided by which one it names. See
 * `game/executions/`.
 */
export type Execution = {
  id?: string;
  type?: string;
  school?: string;
  magnitude?: MagnitudeInput;
};

export type Effect = {
  id: string;
  label: string;
  duration: DurationType;
  seconds: number;
  interval: number;
  stackable: boolean;
  modifiers: Modifier[];
  execution: Execution | null;
};

/**
 * A fresh effect, before it has a duration to have fields for.
 *
 * `seconds`, `interval` and `stackable` are missing rather than defaulted,
 * because an instant effect has nothing to time and writing zeroes into the
 * rules file for it would be three lines of noise per record.
 */
export type NewEffect = Pick<Effect, 'id' | 'label' | 'duration' | 'modifiers' | 'execution'>;

/** An effect as a rules file writes it. */
export type EffectInput = {
  id?: string;
  label?: string;
  duration?: string;
  seconds?: number;
  interval?: number;
  stackable?: boolean;
  modifiers?: readonly ModifierInput[];
  execution?: Execution | null;
};

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
} as const;

/** Code-backed calculations, for maths a modifier cannot express. */
export const EXECUTIONS = [['damage', 'Damage']] as const;

/** Left unnormalized: the rules editor reads this straight into what it saves. */
export const EFFECTS = GAME_EFFECTS as EffectInput[];

function defaultMagnitude(): Magnitude {
  return { type: 'constant', value: 1 };
}

/**
 * Fill in a magnitude and hold its two picked fields to their lists.
 *
 * Safe to settle `from` even on a constant, which never reads it: this runs
 * for the game's own lookup table and never for anything the editor writes
 * back, so no rules file grows a field because of it.
 */
function normalizeMagnitude(magnitude: MagnitudeInput = {}): Magnitude {
  const merged = { ...defaultMagnitude(), ...magnitude };
  return {
    ...merged,
    type: merged.type === 'attribute' ? 'attribute' : 'constant',
    from: merged.from === 'source' ? 'source' : 'target',
  };
}

export function defaultModifier(): Modifier {
  return { attribute: 'health', op: 'add', magnitude: defaultMagnitude() };
}

export function defaultEffect(id = 'newEffect'): NewEffect {
  const def = { id } as NewEffect;
  for (const key of DURATION_TYPES.instant.fields) {
    (def as Record<string, unknown>)[key] = EFFECT_FIELDS[key].default;
  }
  return { ...def, modifiers: [], execution: null };
}

export function normalizeEffect(def: EffectInput): Effect {
  const duration: DurationType = isDurationType(def.duration) ? def.duration : 'instant';
  return {
    ...defaultEffect(def.id ?? 'newEffect'),
    seconds: EFFECT_FIELDS.seconds.default,
    stackable: EFFECT_FIELDS.stackable.default,
    ...def,
    duration,
    // An instant effect has nothing to expire and nothing to repeat.
    interval: duration === 'instant' ? 0 : (def.interval ?? 0),
    modifiers: (def.modifiers ?? []).map((mod) => ({
      attribute: mod.attribute ?? '',
      op: mod.op ?? 'add',
      magnitude: normalizeMagnitude(mod.magnitude),
    })),
    execution: def.execution ? { ...def.execution } : null,
  };
}

export function effectMap(defs: readonly EffectInput[] = EFFECTS): Map<string, Effect> {
  return new Map(defs.map((def) => [def.id ?? 'newEffect', normalizeEffect(def)]));
}
