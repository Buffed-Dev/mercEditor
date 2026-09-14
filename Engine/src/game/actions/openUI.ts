import type { ActionSpec } from './types.ts';

/**
 * Open one of the game's panels.
 *
 * One action with a variable rather than one action per panel. That is the
 * shape every verb here should reach for: three panels is three dropdown
 * entries the reader has to tell apart, against one entry and a setting that
 * says which.
 */
export const openUI: ActionSpec = {
  category: 'ui',
  label: 'Open a panel',
  hint: 'Shows one of the game panels, the way a bench opens crafting.',
  vars: [
    {
      key: 'ui',
      kind: 'select',
      label: 'Panel',
      options: [
        ['crafting', 'Crafting'],
        ['character', 'Character'],
        ['abilities', 'Abilities'],
      ],
    },
  ],
  // A bench is a big thing you stand at rather than on, so its plate carries
  // further than a dropped sword's does.
  reach: 2.5,
  run: ({ vars }) => (typeof vars.ui === 'string' && vars.ui ? { ui: vars.ui } : null),
};
