/**
 * The four things that go wrong here, as types, and how to read one safely.
 *
 * A plain `throw new Error('Save failed')` loses everything the person fixing
 * it needs: which route, which game, which record, and what the original
 * failure underneath was. Every error in this file carries a `context` object
 * and a `cause`, so the message stays short enough for a toast and the detail
 * is still there for the console.
 *
 * The split is by *who can do something about it*, which is the only split
 * that changes how a failure is handled:
 *
 *   EditorError   the tool could not do what you asked — the dev server is
 *                 down, a write was refused, a folder is in the way. The
 *                 editor shows it and carries on; nothing is lost.
 *   AssetError    something named a file that is not there or will not load.
 *                 Always recoverable by drawing without it; see the fallbacks
 *                 in render/. A game must never stop for one of these.
 *   RenderError   the scene cannot be built as asked — no canvas, no template
 *                 for a shape. A bug, not bad content.
 *   GameError     an invariant the rest of the code is entitled to assume:
 *                 a map id that is not registered, a cluster with no parts.
 *                 Also a bug, and not one to paper over.
 *
 * A caught value is `unknown` under `strict`, and `(error as Error).message`
 * is a guess that reads "undefined" in the interface when it is wrong. Use
 * `message` and `detail` instead — that is what they are for.
 */

/** What an error was doing when it failed. Anything a log line would want. */
export type ErrorContext = Readonly<Record<string, unknown>>;

export type ErrorOptions = {
  /** The original failure, when this one is wrapping it. */
  cause?: unknown;
  /** Route, game, id, path — whatever names the thing that failed. */
  context?: ErrorContext;
};

/** The shared shape. Never thrown directly; the four below are. */
export class MercError extends Error {
  readonly context: ErrorContext;

  constructor(message: string, options: ErrorOptions = {}) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
    // Set explicitly rather than left to the subclass: `new.target.name` is the
    // one thing that survives minification here, and a stack that says
    // `MercError` for all four is a stack that says nothing.
    this.name = new.target.name;
    this.context = options.context ?? {};
  }
}

/** The tool could not do what was asked. Shown, and recovered from. */
export class EditorError extends MercError {}

/** Something named a file that is not there, or will not load. Recoverable. */
export class AssetError extends MercError {}

/** The scene cannot be built as asked. A bug. */
export class RenderError extends MercError {}

/** An invariant the rest of the code is entitled to assume. A bug. */
export class GameError extends MercError {}

/**
 * What to show a person, from a value that might be anything.
 *
 * Never throws and never returns an empty string: a toast that says nothing is
 * worse than one that says something vague.
 */
export function message(error: unknown): string {
  if (error instanceof Error) return error.message || error.name;
  if (typeof error === 'string' && error.trim()) return error;
  return 'Something went wrong';
}

/**
 * The whole story, for a log line: the context, and every cause under it.
 *
 * Causes are walked rather than printed as one object because the useful part
 * is usually the innermost — "Failed to fetch" under "Could not write map" —
 * and an object graph in a console hides it one fold down.
 */
export function detail(error: unknown): ErrorContext {
  const out: Record<string, unknown> = {};
  if (error instanceof MercError && Object.keys(error.context).length) {
    Object.assign(out, error.context);
  }
  const causes: string[] = [];
  let cause: unknown = error instanceof Error ? error.cause : undefined;
  // Bounded: a cause chain that loops back on itself would hang this.
  for (let depth = 0; cause !== undefined && depth < 8; depth += 1) {
    causes.push(message(cause));
    cause = cause instanceof Error ? cause.cause : undefined;
  }
  if (causes.length) out.causes = causes;
  if (error instanceof Error && error.stack) out.stack = error.stack;
  return out;
}
