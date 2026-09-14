/**
 * Logging, with a scope and a context object rather than a sentence.
 *
 * This is not a logging framework and there is nothing to configure. It exists
 * so that the handful of places that report a recoverable failure all report it
 * the same way: `[scope] what happened` on the console, with the details as an
 * object beside it rather than interpolated into the string. A devtools console
 * folds an object; it cannot fold a sentence, and it cannot be searched for a
 * field inside one either.
 *
 * Three levels, and the distinction is what the reader is meant to do:
 *
 *   debug   only useful while working on that thing. Off unless the bundle is
 *           a development one, so a published game says nothing at all.
 *   warn    something failed and was recovered from — a missing picture, a
 *           model that would not load. The game carries on without it.
 *   error   something failed and was not recovered from.
 *
 * There is deliberately no `info`: a line nobody has to act on is a line that
 * teaches people to stop reading the console.
 */

import { detail, type ErrorContext } from './errors.ts';

/** Vite defines this; Node does not, and `debug` is off wherever it is absent. */
const DEV = (import.meta as { env?: { DEV?: boolean } }).env?.DEV === true;

export type Log = {
  debug(message: string, context?: ErrorContext): void;
  warn(message: string, context?: ErrorContext): void;
  /** `error` is the thrown value, whatever it turned out to be. */
  error(message: string, error?: unknown, context?: ErrorContext): void;
};

/** Only pass an object when there is something in it; an empty one is noise. */
const parts = (context: ErrorContext | undefined): [ErrorContext] | [] =>
  context && Object.keys(context).length ? [context] : [];

/**
 * A log for one area, named once.
 *
 * @param scope what is speaking — `models`, `textures`, `save`. Shown in
 *   brackets, so the console can be filtered down to one of them.
 */
export function logger(scope: string): Log {
  const tag = `[${scope}]`;
  return {
    debug(message, context) {
      if (DEV) console.debug(tag, message, ...parts(context));
    },
    warn(message, context) {
      console.warn(tag, message, ...parts(context));
    },
    error(message, error, context) {
      console.error(tag, message, ...parts({ ...context, ...detail(error) }));
    },
  };
}
