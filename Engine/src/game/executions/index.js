import { damage } from './damage.js';

/**
 * Code-backed calculations an effect can name, keyed by id. This is the escape
 * hatch for maths that data cannot express, and the same data-names-a-verb
 * split abilities will use — so the two stay one system rather than two.
 *
 * Adding a calculation is a line here. Adding an effect that uses one is data.
 */
export const EXECUTIONS = { damage };

export function runExecution(spec, context) {
  const execution = EXECUTIONS[spec?.id];
  if (!execution) return null;
  return execution.run({ ...context, params: spec });
}
