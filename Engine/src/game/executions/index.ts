import { damage } from './damage.ts';
import type { Execution } from '../../data/effects.ts';
import type { ExecutionContext, ExecutionResult } from './types.ts';

export type { ExecutionContext, ExecutionResult, ExecutionSpec } from './types.ts';

/**
 * Code-backed calculations an effect can name, keyed by id. This is the escape
 * hatch for maths that data cannot express, and the same data-names-a-verb
 * split abilities will use — so the two stay one system rather than two.
 *
 * Adding a calculation is a line here. Adding an effect that uses one is data.
 */
export const EXECUTIONS = { damage };

/** The calculations that exist. */
export type ExecutionId = keyof typeof EXECUTIONS;

const isExecutionId = (value: string): value is ExecutionId => value in EXECUTIONS;

export function runExecution(
  spec: Execution | null | undefined,
  context: Omit<ExecutionContext, 'params'>,
): ExecutionResult | null {
  if (!spec?.id || !isExecutionId(spec.id)) return null;
  return EXECUTIONS[spec.id].run({ ...context, params: spec });
}
