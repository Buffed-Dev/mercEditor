/**
 * The actions a trigger can run.
 *
 * Code-backed verbs a map object or a prefab can name, keyed by id — the same
 * data-names-a-verb split as ../executions/index.ts, and deliberately the same
 * shape, so the two read as one system rather than two.
 *
 * **Adding an action is one file and one line in the table below.** Nothing
 * else: not the editor, not the serializer, not a union of ids. That is the
 * requirement the whole design is measured against, because the list is
 * expected to reach the low hundreds.
 *
 * When a trigger fires is ../events/index.ts. Adding one of those is not free
 * in the same way — an event needs a place in the engine where it happens.
 */

import { effect } from './effect.ts';
import { openUI } from './openUI.ts';
import { say } from './say.ts';
import { teleport } from './teleport.ts';
import type { ActionContext, ActionIntent, ActionSpec } from './types.ts';

export type { ActionContext, ActionIntent, ActionSpec, VarSpec } from './types.ts';

/**
 * Every action, by id.
 *
 * A written-out table rather than a folder walked at load: `import.meta.glob`
 * does not exist outside Vite, so under `node --test` a discovered registry
 * comes back empty — and this is precisely the thing a hundred actions need a
 * test for. One line each, and it typechecks.
 */
export const ACTIONS: Record<string, ActionSpec> = {
  teleport,
  openUI,
  say,
  effect,
};

/**
 * The headings the picker groups by, in the order they are shown.
 *
 * An action names its own category rather than being sorted by which folder it
 * sits in: the files are flat, so the heading has to be written down somewhere,
 * and the action's own file is the one place that cannot drift from it.
 */
export const ACTION_CATEGORIES: readonly (readonly [string, string])[] = [
  ['world', 'World'],
  ['ui', 'Interface'],
  ['combat', 'Combat'],
  ['other', 'Other'],
];

/** `[id, label]` pairs per category, for a grouped picker. */
export const actionGroups = (): readonly {
  label: string;
  options: readonly (readonly [string, string])[];
}[] =>
  ACTION_CATEGORIES.map(([id, label]) => ({
    label,
    options: Object.entries(ACTIONS)
      // Anything that names no category, or names one that is not offered, is
      // still reachable rather than silently missing from the list.
      .filter(([, spec]) =>
        id === 'other'
          ? !ACTION_CATEGORIES.some(([known]) => known !== 'other' && known === spec.category)
          : spec.category === id,
      )
      .map(([actionId, spec]) => [actionId, spec.label] as const),
  })).filter((group) => group.options.length);

const isAction = (id: unknown): id is string => typeof id === 'string' && id in ACTIONS;

/**
 * Run one wiring.
 *
 * The id is checked against the table rather than against a type, exactly as
 * `runExecution` checks an execution: a hand-maintained union of two hundred
 * ids buys nothing this guard and one table-driven test do not.
 */
export function runAction(
  wiring: unknown,
  context: Omit<ActionContext, 'vars'>,
): ActionIntent | null {
  const vars = wiring as Record<string, unknown> | null;
  if (!isAction(vars?.do)) return null;
  const action = ACTIONS[vars.do];
  return action ? action.run({ ...context, vars }) : null;
}

/**
 * Run every wiring in a list, in order, and collect what they asked for.
 *
 * In order, and all of them: an action that decides nothing still ran, so a
 * "say" after a "teleport" is a line you see on arrival rather than one that
 * was skipped. Only the intents come back, because only those need carrying out
 * somewhere else.
 */
export function runActions(
  wirings: readonly unknown[],
  context: Omit<ActionContext, 'vars'>,
): ActionIntent[] {
  const intents: ActionIntent[] = [];
  for (const one of wirings) {
    const intent = runAction(one, context);
    if (intent) intents.push(intent);
  }
  return intents;
}
