/**
 * The attributes an actor can have, described as data so one definition drives
 * the runtime, the editor panel and the serializer at once — the same trick
 * data/lights.js uses for light types.
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

import { ATTRIBUTES } from '#game/rules/attributes.js';

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
};

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
};

/** The set itself lives in rules/, which the editor rewrites. */
export { ATTRIBUTES };

export function defaultAttribute(id = 'newAttribute') {
  const def = { id };
  for (const key of ATTRIBUTE_KINDS.stat.fields) def[key] = ATTRIBUTE_FIELDS[key].default;
  return def;
}

/** Fill in anything a hand-written definition left out. */
export function normalizeAttribute(def) {
  const kind = ATTRIBUTE_KINDS[def.kind] ? def.kind : 'stat';
  return { ...defaultAttribute(def.id ?? 'newAttribute'), ...def, kind };
}

