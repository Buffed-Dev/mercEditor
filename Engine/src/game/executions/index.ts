import { damage } from './damage.ts';
import type { Execution, MagnitudeInput } from '../../data/effects.ts';
import type { Actor } from '../actor.ts';

/** What an execution reports back. */
export type ExecutionResult = { dealt: number; killed: boolean };

/**
 * What an execution is handed.
 *
 * `resolve` comes in rather than being imported so an execution reads a
 * magnitude exactly the way the effect runtime does, without depending on it.
 */
export type ExecutionContext = {
  target: Actor;
  source: Actor;
  params: Execution;
  resolve: (
    magnitude: MagnitudeInput | undefined,
    target: Actor,
    source: Actor,
  ) => number;
};

/** One named calculation. */
export type ExecutionSpec = { label: string; run: (context: ExecutionContext) => ExecutionResult };

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
