import test from 'node:test';
import assert from 'node:assert/strict';
import { get, post, count, list, text } from '../Engine/editor/devServer.ts';
import { EditorError, message } from '../Engine/src/util/errors.ts';

/**
 * What the editor does when the dev server misbehaves.
 *
 * Every one of these was a real message somebody saw: `Failed to fetch` with
 * nothing to act on, `Unexpected token '<'` from an HTML error page, and a
 * save that reported writing a file called "undefined". They are tests rather
 * than comments because the failure path is the one path nobody exercises by
 * hand.
 */

/** Stand in for the dev server for one call, then put the real one back. */
async function served(
  reply: (url: string, init?: RequestInit) => Response | Promise<Response> | never,
  run: () => Promise<unknown>,
): Promise<unknown> {
  const real = globalThis.fetch;
  globalThis.fetch = ((url: string, init?: RequestInit) =>
    Promise.resolve(reply(url, init))) as typeof fetch;
  try {
    return await run();
  } finally {
    globalThis.fetch = real;
  }
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

test('a dev server that is not running says so, and says which route', async () => {
  const failed = await served(
    () => {
      throw new TypeError('Failed to fetch');
    },
    () => post('/__maps', 'write base', {}).then(() => null, (error: unknown) => error),
  );

  assert.ok(failed instanceof EditorError);
  assert.match(message(failed), /write base/);
  assert.match(message(failed), /Is it running\?/);
  assert.equal(failed.context.route, '/__maps');
  // The original is kept underneath rather than replaced by the friendlier one.
  assert.equal(message(failed.cause), 'Failed to fetch');
});

test('an error page that is not JSON is reported, not parsed', async () => {
  const failed = await served(
    () => new Response('<!doctype html><title>500</title>', { status: 500 }),
    () => post('/__data', 'write the rules', {}).then(() => null, (error: unknown) => error),
  );

  assert.ok(failed instanceof EditorError);
  // Not `Unexpected token '<'`, which is what `response.json()` would have said.
  assert.match(message(failed), /write the rules/);
  assert.match(message(failed), /500/);
  assert.match(String(failed.context.body), /doctype/);
});

test("the server's own explanation wins when it sends one", async () => {
  const failed = await served(
    () => json({ error: 'Materials/Wood is not empty' }, 409),
    () => post('/__library', 'delete Materials/Wood', {}).then(() => null, (e: unknown) => e),
  );

  assert.equal(message(failed), 'Materials/Wood is not empty');
});

test('a field the server did not send is refused rather than passed on', async () => {
  // The write said it worked but named no file. Reporting "Wrote undefined" is
  // how this used to end.
  const body = await (served(() => json({ ok: true }), () =>
    post('/__maps', 'write base', {}),
  ) as Promise<Record<string, unknown>>);

  assert.throws(() => text(body, 'file', 'write base'), EditorError);
  assert.throws(() => text({ file: '' }, 'file', 'write base'), EditorError);
  assert.equal(text({ file: 'Games/Merc/maps/base.js' }, 'file', 'write base'), 'Games/Merc/maps/base.js');
});

test('a count or a list the server left out reads as nothing, not as a crash', () => {
  assert.equal(count({}, 'wrote'), 0);
  assert.equal(count({ wrote: 'lots' }, 'wrote'), 0, 'a string is not a count');
  assert.equal(count({ wrote: Number.NaN }, 'wrote'), 0, 'and neither is NaN');
  assert.equal(count({ wrote: 3 }, 'wrote'), 3);

  assert.deepEqual(list({}, 'files'), []);
  assert.deepEqual(list({ files: 'one' }, 'files'), [], 'a string is not a list of files');
  assert.deepEqual(list({ files: ['a'] }, 'files'), ['a']);
});

test('a good answer comes back as itself, and a query is passed on', async () => {
  let asked = '';
  const body = await served(
    (url) => {
      asked = url;
      return json({ files: ['a', 'b'] });
    },
    () => get('/__maps', 'count the maps in Merc', { game: 'Merc' }),
  );

  assert.equal(asked, '/__maps?game=Merc');
  assert.deepEqual(list(body as Record<string, unknown>, 'files'), ['a', 'b']);
});
