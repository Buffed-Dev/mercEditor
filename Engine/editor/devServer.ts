/**
 * Everything the editor asks of the dev server, through one door.
 *
 * The editor cannot write files. It posts what it wants written to the plugin
 * in vite-plugin-map-io.js, which puts it on disk — so every save, every
 * upload, every rename and every read of the library is a `fetch` that can
 * fail in four different ways, and used to fail in four different ways at each
 * of the eleven call sites.
 *
 * What went wrong before, and what this exists to stop:
 *
 *   The server is not running. `fetch` rejects with `TypeError: Failed to
 *   fetch`, which reaches the toast as those three words, and the one thing
 *   that would fix it — start the dev server — is not among them.
 *
 *   The server answered, but not with JSON. A 500 from Vite is an HTML page,
 *   and `response.json()` on it throws `SyntaxError: Unexpected token '<'`.
 *   That is what the person saving a map saw, and it is about as far from the
 *   actual problem as a message can get.
 *
 *   The server answered with JSON that does not have the field the caller was
 *   about to read. The old code said `as { file: string }` and returned
 *   `body.file`, so `undefined` travelled on as a filename and the editor
 *   reported writing a file called "undefined".
 *
 * So: one request function that turns all three into an `EditorError` naming
 * the route and what was being attempted, and field readers that check rather
 * than cast. A caller says what it wanted to do — "write base" — and whatever
 * happens, the message starts with that.
 */

import { EditorError } from '../src/util/errors.ts';

/** The routes the plugin serves. Anything else is a typo, not a route. */
export type Route =
  | '/__maps'
  | '/__data'
  | '/__games'
  | '/__draft/tree'
  | '/__draft/ops'
  | '/__publish';

/** A JSON object. The only response shape any of these routes returns. */
export type Body = Record<string, unknown>;

const isRecord = (value: unknown): value is Body =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/**
 * Ask the dev server for something.
 *
 * @param what what the caller was trying to do, as a verb phrase — "write
 *   base", "move Materials/Wood". Every error message begins with it.
 */
async function request(route: Route, what: string, init?: RequestInit, query = ''): Promise<Body> {
  let response: Response;
  try {
    response = await fetch(`${route}${query}`, init);
  } catch (cause) {
    // Nothing answered at all: the usual cause is a dev server that is not
    // running, and saying so is worth more than the exception's own words.
    throw new EditorError(`Could not ${what}: the dev server did not answer. Is it running?`, {
      cause,
      context: { route },
    });
  }

  // Read as text first. A body that is not JSON is a failure to report, not an
  // exception to let out — and the first of it is worth keeping, because an
  // HTML error page usually says what happened in its title.
  const text = await response.text().catch(() => '');
  let parsed: unknown;
  try {
    parsed = text.trim() ? JSON.parse(text) : {};
  } catch {
    parsed = undefined;
  }
  const body = isRecord(parsed) ? parsed : null;

  if (!response.ok) {
    const said = body && typeof body.error === 'string' ? body.error.trim() : '';
    throw new EditorError(said || `Could not ${what}: the dev server said ${response.status}`, {
      context: { route, status: response.status, ...(body ? {} : { body: text.slice(0, 200) }) },
    });
  }
  if (!body) {
    throw new EditorError(`Could not ${what}: the dev server answered with something else`, {
      context: { route, status: response.status, body: text.slice(0, 200) },
    });
  }
  return body;
}

/** Post JSON, and give back what came back. */
export const post = (route: Route, what: string, payload: unknown): Promise<Body> =>
  request(route, what, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });

/** Read, optionally about one game. */
export const get = (route: Route, what: string, params: Record<string, string> = {}): Promise<Body> => {
  const query = new URLSearchParams(params).toString();
  return request(route, what, undefined, query ? `?${query}` : '');
};

// --- reading a field the server promised -------------------------------------
//
// A cast says what the caller hopes; these say what arrived. The difference
// only shows up on the day the two disagree, which is the day it matters.

/** A string field that has to be there. */
export function text(body: Body, key: string, what: string): string {
  const value = body[key];
  if (typeof value === 'string' && value) return value;
  throw new EditorError(`Could not ${what}: the dev server did not say which file`, {
    context: { key, got: value },
  });
}

/** A number field, or `fallback` when the server did not send one. */
export function count(body: Body, key: string, fallback = 0): number {
  const value = body[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

/** An array field, or an empty one. Never the caller's problem if it is absent. */
export function list(body: Body, key: string): unknown[] {
  const value = body[key];
  return Array.isArray(value) ? value : [];
}
