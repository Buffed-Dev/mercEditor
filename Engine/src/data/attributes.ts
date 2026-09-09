/**
 * The attributes an actor can have, described as data so one definition drives
 * the runtime, the editor panel and the serializer at once — the same trick
 * data/lights.ts uses for light types.
 *
 * Two kinds, and the difference matters:
 *
 * - `stat` is a single number: base plus whatever modifiers are active.
 * - `resource` is a pool. Its computed value is the *maximum*, and a separate
 *   current level rides underneath it.
 *
 * That split is this system's one deliberate departure from Unreal's GAS, which
 * models a pool as two attributes (Health and MaxHealth) kept in step by a
 * hand-written clamp. Folding it into a kind flag removes the pairing and with
 * it the classic bug where a buff raises the maximum and the current value
 * silently fails to follow.
 *
 * Note there is no regen field. Regeneration is an effect that adds to health
 * on an interval — see data/effects.js — which is what lets an upgrade raise
 * healthRegen and have the existing effect immediately tick harder.
 */

import { ATTRIBUTES as GAME_ATTRIBUTES } from '#game/rules/attributes.js';

export const ATTRIBUTE_FIELDS = {
  label: { kind: 'text', label: 'Name', default: 'New attribute' },
  kind: {
    kind: 'select',
    label: 'Kind',
    options: [
      ['stat', 'Stat'],
      ['resource', 'Resource'],
    ],
    default: 'stat',
  },
  base: { kind: 'number', label: 'Base value', min: 0, max: 9999, step: 0.1, default: 10 },
  min: { kind: 'number', label: 'Minimum', min: 0, max: 9999, step: 0.1, default: 0 },
  max: { kind: 'number', label: 'Maximum', min: 0, max: 9999, step: 0.1, default: 9999 },
} as const;

export const ATTRIBUTE_KINDS = {
  stat: {
    label: 'Stat',
    hint: 'One number. Modifiers stack on top of the base value.',
    fields: ['label', 'kind', 'base', 'min', 'max'],
  },
  resource: {
    label: 'Resource',
    hint: 'A pool. The computed value is the maximum; the current level is tracked separately.',
    fields: ['label', 'kind', 'base', 'min', 'max'],
  },
} as const;

/** Stat or resource. The two `ATTRIBUTE_KINDS` keys and nothing else. */
export type AttributeKind = keyof typeof ATTRIBUTE_KINDS;

export type Attribute = {
  id: string;
  label: string;
  kind: AttributeKind;
  base: number;
  min: number;
  max: number;
};

/**
 * An attribute as a rules file writes it, before it has been checked.
 *
 * `kind` is a plain string here because the files under `Games/` are
 * hand-edited and sit outside the type checker; `normalizeAttribute` is the
 * one place that decides what an unrecognised one becomes.
 */
export type AttributeInput = Partial<Omit<Attribute, 'kind'>> & { kind?: string };

export const isAttributeKind = (value: unknown): value is AttributeKind =>
  typeof value === 'string' && value in ATTRIBUTE_KINDS;

/** The set itself lives in rules/, which the editor rewrites. */
export const ATTRIBUTES = GAME_ATTRIBUTES as AttributeInput[];

export function defaultAttribute(id = 'newAttribute'): Attribute {
  const def = { id } as Attribute;
  for (const key of ATTRIBUTE_KINDS.stat.fields) {
    (def as Record<string, unknown>)[key] = ATTRIBUTE_FIELDS[key].default;
  }
  return def;
}

/** Fill in anything a hand-written definition left out. */
export function normalizeAttribute(def: AttributeInput): Attribute {
  const kind: AttributeKind = isAttributeKind(def.kind) ? def.kind : 'stat';
  return { ...defaultAttribute(def.id ?? 'newAttribute'), ...def, kind };
}

