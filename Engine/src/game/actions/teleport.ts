import type { ActionSpec } from './types.ts';

/** The string a map file put in a field, or empty. Files may hold anything. */
const text = (value: unknown): string => (typeof value === 'string' ? value : '');

/**
 * Take the player to another map.
 *
 * Handed back as an intent rather than done here: changing maps destroys the
 * level this ran inside. See ActionIntent.
 */
export const teleport: ActionSpec = {
  category: 'world',
  label: 'Go to map',
  hint: 'Takes the player to another map, arriving at a named spawn.',
  vars: [
    { key: 'to', kind: 'maps', label: 'Goes to map' },
    { key: 'spawn', kind: 'text', label: 'Arrive at spawn named' },
  ],
  run({ vars }) {
    const to = text(vars.to);
    if (!to) return null;
    const spawn = text(vars.spawn);
    return spawn ? { go: to, spawn } : { go: to };
  },
};
