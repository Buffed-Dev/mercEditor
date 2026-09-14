import type { ActionSpec } from './types.ts';

/** Put a line on the screen. The cheapest thing to wire, and the best to test with. */
export const say: ActionSpec = {
  category: 'ui',
  label: 'Say something',
  hint: 'Prints a line across the middle of the screen for a moment.',
  vars: [{ key: 'message', kind: 'text', label: 'Says' }],
  run: ({ vars }) =>
    typeof vars.message === 'string' && vars.message ? { say: vars.message } : null,
};
