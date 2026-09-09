import { cp, mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

/**
 * Dev-only API that lets the editor read and write game folders.
 *
 * A browser page cannot touch the filesystem, so the editor POSTs the
 * serialized module text here and Vite's own watcher picks the new file up.
 *
 *   GET  /__games                        →  the game folders under Games/
 *   POST /__games { id, from }           →  a new game, copied from another
 *   GET  /__maps?game=<id>               →  that game's map files
 *   POST /__maps  { game, id, source }   →  Games/<game>/maps/<id>.js
 *   POST /__data  { game, files: [...] } →  Games/<game>/rules/<kind>.js
 *   GET  /__assets?game=<id>             →  the files in that game's assets/
 *   POST /__assets { game, name, data }  →  Games/<game>/assets/<name>
 *
 * Every write names the game it is for, because the editor is one tool over
 * however many games are in the folder — it is not part of any of them. The
 * game id, the map id and the rule kind are all checked before anything is
 * written: two of the three arrive from the client and become path segments.
 *
 * Not registered for `vite build`: the editor is a development tool, it is not
 * in a published game, and a production bundle has no server to write to.
 */
export function mapIo({ dir = 'Games' } = {}) {
  const root = process.cwd();
  const gamesDir = resolve(root, dir);

  // What the editor writes, as the watcher spells it. Everything under a game
  // folder is content; nothing else there is written by anything but a person.
  const editorWrites = gamesDir.split('\\').join('/');

  // Rule files are a closed set, so the client never supplies a path — it names
  // one of these and the server decides where that lives.
  const RULE_FILES = new Set([
    'attributes',
    'effects',
    'abilities',
    'archetypes',
    'items',
    'categories',
    'recipes',
    'lootTables',
    'baseLevels',
    'vfx',
    'assets',
    'materials',
    'terrains',
    'props',
  ]);

  // What may be dropped on the asset panel. A closed set because the name
  // becomes a filename under the game folder, and because a file the engine has
  // no loader for is not an asset — it is a file in the way.
  const ASSET_TYPES = new Set(['glb', 'gltf', 'png', 'jpg', 'jpeg', 'webp']);

  // Rules ids may not start with a digit, because they become identifiers.
  // A filename has no such trouble, and a model exported as "01-rock.glb" is
  // not worth renaming by hand. Everything that could escape the folder is
  // still out: no slashes, no leading dot, nothing but the one extension.
  const filePattern = /^[A-Za-z0-9][A-Za-z0-9 _-]{0,63}\.[A-Za-z0-9]{1,8}$/;

  /** Where an asset file goes, or null if that is not a name we will write. */
  const assetPath = (game, name) => {
    const folder = gameDir(game);
    if (!folder || !filePattern.test(name ?? '')) return null;
    const ext = name.split('.').pop().toLowerCase();
    return ASSET_TYPES.has(ext) ? resolve(folder, 'assets', name) : null;
  };

  // An id becomes a path segment, so keep it to something that cannot escape
  // its folder or produce an unimportable module name.
  const idPattern = /^[A-Za-z][A-Za-z0-9-]{0,39}$/;

  /** The folder for a game id, or null if the id is not one. */
  const gameDir = (id) => (idPattern.test(id ?? '') ? resolve(gamesDir, id) : null);

  return {
    name: 'merc:map-io',
    apply: 'serve',

    /**
     * Stop a save from reloading the page, without hiding the file.
     *
     * The editor is what writes these, and a reload in the middle of editing is
     * not a refresh — it is losing the map you were drawing. It has already put
     * what it wrote into the running registry, so there is nothing a reload
     * would add.
     *
     * Returning an empty list is what suppresses the update. Vite has dropped
     * the module from its cache by the time this runs, so a reload you ask for
     * yourself still comes up with what is on disk — which is what makes a
     * second browser, or a hand-edited file, still work.
     */
    handleHotUpdate({ file }) {
      const path = file.split('\\').join('/');
      if (path.startsWith(editorWrites)) return [];
    },

    configureServer(server) {
      const json = (res, status, body) => {
        res.statusCode = status;
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify(body));
      };

      const readBody = async (req) => {
        const chunks = [];
        for await (const chunk of req) chunks.push(chunk);
        return JSON.parse(Buffer.concat(chunks).toString('utf8'));
      };

      /**
       * Which games there are to open.
       *
       * The label comes out of the manifest rather than off the folder, so a
       * game can be called what it likes. Read as text rather than imported:
       * this runs in Vite's own process, and a manifest uses `import.meta.glob`
       * — which means nothing until Vite has transformed it.
       */
      server.middlewares.use('/__games', async (req, res) => {
        try {
          // A new game is a copy of a working one. A blank folder would be a
          // game with no attributes and no maps, which is not something the
          // editor can open — every list in it would be empty, and there would
          // be nothing to hang the first ability off.
          if (req.method === 'POST') {
            const { id, from } = await readBody(req);
            const folder = gameDir(id);
            const source = gameDir(from);
            if (!folder) return json(res, 400, { error: `Invalid game id "${id}"` });
            if (!source) return json(res, 400, { error: `Invalid game "${from}" to copy` });
            // Never over an existing game: this writes a whole folder, and the
            // one it would land on is somebody's work.
            try {
              await stat(folder);
              return json(res, 409, { error: `A game called "${id}" is already there` });
            } catch {
              // Nothing there, which is what we want.
            }
            await cp(source, folder, { recursive: true });
            // The manifest names the game, so the copy has to be renamed or two
            // folders claim the same id.
            const manifest = resolve(folder, 'game.js');
            const text = (await readFile(manifest, 'utf8'))
              .replace(/export const id = '[^']*'/, `export const id = '${id}'`)
              .replace(/export const label = '[^']*'/, `export const label = '${id}'`);
            await writeFile(manifest, text, 'utf8');
            return json(res, 200, { ok: true, game: { id, label: id } });
          }

          const entries = await readdir(gamesDir, { withFileTypes: true });
          const games = [];
          for (const entry of entries) {
            if (!entry.isDirectory() || !idPattern.test(entry.name)) continue;
            let source = '';
            try {
              const manifest = resolve(gamesDir, entry.name, 'game.js');
              await stat(manifest);
              source = await server.transformRequest(`/${dir}/${entry.name}/game.js`).then(
                (result) => result?.code ?? '',
                () => '',
              );
            } catch {
              // A folder with no manifest is not a game, whatever else is in it.
              continue;
            }
            const label = /label\s*=\s*"([^"]*)"|label\s*=\s*'([^']*)'/.exec(source);
            games.push({ id: entry.name, label: label?.[1] ?? label?.[2] ?? entry.name });
          }
          return json(res, 200, { games });
        } catch (error) {
          return json(res, 500, { error: String(error?.message ?? error) });
        }
      });

      server.middlewares.use('/__maps', async (req, res) => {
        try {
          if (req.method === 'GET') {
            const asked = new URL(req.url ?? '', 'http://localhost').searchParams.get('game');
            const folder = gameDir(asked);
            if (!folder) return json(res, 400, { error: `Invalid game "${asked}"` });
            const files = await readdir(resolve(folder, 'maps'));
            return json(res, 200, { files: files.filter((f) => f.endsWith('.js')) });
          }

          if (req.method !== 'POST') return json(res, 405, { error: 'Use GET or POST' });

          const { game, id, source } = await readBody(req);
          const folder = gameDir(game);
          if (!folder) return json(res, 400, { error: `Invalid game "${game}"` });
          if (!idPattern.test(id ?? '')) {
            return json(res, 400, { error: `Invalid map id "${id}": use a-z, 0-9 and dashes` });
          }
          if (typeof source !== 'string' || !source.includes('export const')) {
            return json(res, 400, { error: 'Missing or malformed map source' });
          }

          const maps = resolve(folder, 'maps');
          await mkdir(maps, { recursive: true });
          await writeFile(resolve(maps, `${id}.js`), source, 'utf8');
          return json(res, 200, { ok: true, file: `${dir}/${game}/maps/${id}.js` });
        } catch (error) {
          return json(res, 500, { error: String(error?.message ?? error) });
        }
      });

      // Attributes, effects, abilities, archetypes and the rest. Same idea as
      // /__maps, except the filename is chosen from a fixed set rather than
      // sent by the client.
      server.middlewares.use('/__data', async (req, res) => {
        try {
          if (req.method !== 'POST') return json(res, 405, { error: 'Use POST' });

          const { game, files } = await readBody(req);
          const folder = gameDir(game);
          if (!folder) return json(res, 400, { error: `Invalid game "${game}"` });
          if (!Array.isArray(files) || !files.length) {
            return json(res, 400, { error: 'Expected a files array' });
          }

          // Validate the whole batch first: the files reference each other, so
          // writing some of them and rejecting the rest would leave the rules
          // inconsistent on disk.
          for (const { kind, source } of files) {
            if (!RULE_FILES.has(kind)) {
              return json(res, 400, { error: `Unknown rule file "${kind}"` });
            }
            if (typeof source !== 'string' || !source.includes('export const')) {
              return json(res, 400, { error: `Missing or malformed source for "${kind}"` });
            }
          }

          const rules = resolve(folder, 'rules');
          await mkdir(rules, { recursive: true });
          const written = [];
          for (const { kind, source } of files) {
            await writeFile(resolve(rules, `${kind}.js`), source, 'utf8');
            written.push(`${dir}/${game}/rules/${kind}.js`);
          }

          return json(res, 200, { ok: true, files: written });
        } catch (error) {
          return json(res, 500, { error: String(error?.message ?? error) });
        }
      });

      /**
       * The files a game's models and pictures live in.
       *
       * Unlike everything else here this writes bytes rather than source. A
       * model is not something a rules file can hold: the visual effects put
       * their sprites inside theirs as base64 and that file is a megabyte, for
       * pictures a hundred pixels across. So the editor sends the file once,
       * and what goes in the rules is its name.
       *
       * base64 in a JSON body rather than a multipart upload, because the
       * editor already speaks JSON to every other endpoint here and a parser
       * for form data would be the only thing in this file that needed one.
       */
      server.middlewares.use('/__assets', async (req, res) => {
        try {
          if (req.method === 'GET') {
            const asked = new URL(req.url ?? '', 'http://localhost').searchParams.get('game');
            const folder = gameDir(asked);
            if (!folder) return json(res, 400, { error: `Invalid game "${asked}"` });
            let names = [];
            try {
              names = await readdir(resolve(folder, 'assets'));
            } catch {
              // No assets folder yet is an empty one, not an error.
            }
            return json(res, 200, { files: names.filter((name) => !name.startsWith('.')) });
          }

          if (req.method !== 'POST') return json(res, 405, { error: 'Use GET or POST' });

          const { game, name, data } = await readBody(req);
          const target = assetPath(game, name);
          if (!target) {
            return json(res, 400, { error: `Cannot store a file called "${name}"` });
          }
          if (typeof data !== 'string' || !data.length) {
            return json(res, 400, { error: 'Expected base64 file data' });
          }

          // Sent as a data URL by the browser, which is the form a FileReader
          // produces; the bytes start after the comma.
          const base64 = data.slice(data.indexOf(',') + 1);
          const bytes = Buffer.from(base64, 'base64');
          if (!bytes.length) return json(res, 400, { error: 'That file was empty' });

          await mkdir(resolve(gameDir(game), 'assets'), { recursive: true });
          await writeFile(target, bytes);
          return json(res, 200, { ok: true, file: name, bytes: bytes.length });
        } catch (error) {
          return json(res, 500, { error: String(error?.message ?? error) });
        }
      });
    },
  };
}
