/**
 * What an execution is handed and what it gives back.
 *
 * Separate from the barrel beside it so a calculation can say what it takes
 * without importing the table it is listed in — the table imports every
 * calculation, and a calculation importing the table back is a cycle.
 */

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
  resolve: (magnitude: MagnitudeInput | undefined, target: Actor, source: Actor) => number;
};

/** One named calculation. */
export type ExecutionSpec = { label: string; run: (context: ExecutionContext) => ExecutionResult };
