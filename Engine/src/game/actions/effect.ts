import type { ActionSpec } from './types.ts';

/**
 * Put one of the game's effects on the player.
 *
 * Deliberately not a `damage` action. An execution wants an Actor to blame, and
 * there is no honest one for a floor — inventing one means giving the floor an
 * archetype, attributes and a team so that armour and resistances have
 * something to read, which is a fake object built to satisfy a signature. An
 * effect applied to the player by the player is what standing in a fire *is*,
 * and the damage still runs through EXECUTIONS.damage one layer further down,
 * so the two stay one system.
 *
 * It also disposes of the repeat problem for free: a hazard fires once when
 * stepped onto, and a periodic effect ticks itself from then on. No repeat flag
 * on the action, no per-frame "am I still standing on it".
 */
export const effect: ActionSpec = {
  category: 'combat',
  label: 'Apply an effect',
  hint: 'Puts one of the game"s effects on the player — a burn, a slow, a heal.',
  vars: [{ key: 'effect', kind: 'text', label: 'Effect' }],
  run({ vars, player, effects }) {
    const id = typeof vars.effect === 'string' ? vars.effect : '';
    if (id) effects.apply(id, player, player);
    return null;
  },
};
