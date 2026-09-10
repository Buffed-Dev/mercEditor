import {
  cp,
  mkdir,
  readFile,
  readdir,
  realpath,
  rename,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises';
import { dirname, resolve, sep } from 'node:path';

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
 *   GET  /__library?game=<id>            →  that game's assets/ tree and records
 *   POST /__library { game, ...ops }     →  folders made, moved, written, removed
 *   POST /__assets { game, path, data }  →  Games/<game>/assets/<path>
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
  ]);

  // What may be dropped on the asset panel. A closed set because the name
  // becomes a filename under the game folder, and because a file the engine has
  // no loader for is not an asset — it is a file in the way.
  const ASSET_TYPES = new Set(['glb', 'gltf', 'png', 'jpg', 'jpeg', 'webp']);

  // Rules ids may not start with a digit, because they become identifiers.
  // A filename has no such trouble, and a model exported as "01-rock.glb" is
  // not worth renaming by hand.
  const filePattern = /^[A-Za-z0-9][A-Za-z0-9 _-]{0,63}\.[A-Za-z0-9]{1,8}$/;

  // A record is a file with a fixed name, one per kind, rather than one named
  // after its label. Fixed, so "is this folder a material?" is a stat rather
  // than a guess, and so each library index can carry one static glob.
  const RECORD_FILES = new Map([
    ['material.json', 'materials'],
    ['object.json', 'props'],
    ['terrain.json', 'terrains'],
    ['effect.json', 'vfx'],
    ['prefab.json', 'prefabs'],
  ]);

  // The folders a game starts with, and the ones a move or a delete may never
  // take: they are the shape of the library rather than content in it.
  const TOP_FOLDERS = new Set(['Materials', 'Objects', 'Effects', 'Terrain', 'Prefabs']);

  // How deep the tree may go, and how much of it one listing will describe.
  // Both are here so that a walk which met something pathological -- a loop
  // made of junctions, a node_modules somebody unpacked in there -- becomes a
  // short answer rather than a request that never ends.
  const MAX_DEPTH = 8;
  const MAX_ENTRIES = 5000;

  // One segment of a path under assets/. No leading dot, so `.`, `..` and
  // dotfiles are all out; no slash and no backslash, so one segment cannot be
  // two; no colon, so `C:` is not a segment and an absolute path cannot be
  // spelled at all. Everything that could leave the folder is refused here
  // rather than cleaned up afterwards.
  const SEGMENT = /^[A-Za-z0-9][A-Za-z0-9 _.-]{0,63}$/;

  /** A path under assets/, or null if it is not one we will touch. */
  const assetRel = (rel) => {
    const parts = String(rel ?? '').split('/');
    if (!parts.length || parts.length > MAX_DEPTH) return null;
    return parts.every((part) => SEGMENT.test(part)) ? parts.join('/') : null;
  };

  // An id becomes a path segment, so keep it to something that cannot escape
  // its folder or produce an unimportable module name.
  const idPattern = /^[A-Za-z][A-Za-z0-9-]{0,39}$/;

  /** The folder for a game id, or null if the id is not one. */
  const gameDir = (id) => (idPattern.test(id ?? '') ? resolve(gamesDir, id) : null);

  /** A game's assets folder, or null if that is not a game. */
  const assetsDir = (id) => {
    const folder = gameDir(id);
    return folder ? resolve(folder, 'assets') : null;
  };

  /**
   * Where a relative path lands, or null if that is not inside the base.
   *
   * `assetRel` has already refused `..` and absolute paths, so the containment
   * check here is belt to its braces. The realpath is not: a symlink is made
   * of perfectly ordinary segments and can point anywhere, so it is the one
   * way past the pattern and this is the only thing that catches it.
   *
   * Writes come through here as well as reads, so the leaf may not exist yet
   * -- hence resolving the deepest ancestor that does. What is not there yet
   * cannot be a link out of the folder.
   */
  const under = async (base, rel) => {
    const abs = resolve(base, rel);
    if (abs !== base && !abs.startsWith(base + sep)) return null;

    let probe = abs;
    let real;
    for (;;) {
      try {
        real = await realpath(probe);
        break;
      } catch {
        const up = dirname(probe);
        if (up === probe) return null;
        probe = up;
      }
    }
    const realBase = await realpath(base).catch(() => base);
    if (real !== realBase && !real.startsWith(realBase + sep)) return null;
    return abs;
  };

  /** Where an asset file goes, or null if that is not a path we will write. */
  const assetTarget = async (game, rel) => {
    const root = assetsDir(game);
    const safe = root && assetRel(rel);
    if (!safe) return null;
    const name = safe.split('/').pop();
    if (!filePattern.test(name)) return null;
    return ASSET_TYPES.has(name.split('.').pop().toLowerCase()) ? under(root, safe) : null;
  };

  /**
   * Everything under assets/: the tree, the records in it, and whatever would
   * not parse.
   *
   * Gathered in one walk because the browser needs all of it to draw a single
   * row -- a file is "unimported" only once you know that no record names it,
   * which is not a question any one directory can answer.
   */
  const walkAssets = async (dir, base, out, depth = 0) => {
    if (depth > MAX_DEPTH || out.tree.length >= MAX_ENTRIES) return;
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return; // No assets folder yet is an empty one, not an error.
    }
    for (const entry of entries) {
      if (entry.name.startsWith('.') || out.tree.length >= MAX_ENTRIES) continue;
      const rel = base ? `${base}/${entry.name}` : entry.name;
      const target = resolve(dir, entry.name);

      // Listed but never followed: what is behind a link may be anywhere, and
      // a loop made of them would walk until the request gave up.
      if (entry.isSymbolicLink()) {
        out.tree.push({ path: rel, dir: false, link: true });
        continue;
      }

      if (entry.isDirectory()) {
        out.tree.push({ path: rel, dir: true });
        await walkAssets(target, rel, out, depth + 1);
        continue;
      }

      let size = 0;
      let mtime = 0;
      try {
        const info = await stat(target);
        size = info.size;
        mtime = info.mtimeMs;
      } catch {
        // Gone between the readdir and here. Listing it is still right.
      }
      out.tree.push({ path: rel, dir: false, size, mtime });

      const kind = RECORD_FILES.get(entry.name);
      if (!kind) continue;
      try {
        out.records.push({ path: base, kind, record: JSON.parse(await readFile(target, 'utf8')) });
      } catch (error) {
        // A record that will not parse is a red row in the browser, never a
        // dead panel: one bad file must not cost you the other forty.
        out.errors.push({ path: rel, message: String(error?.message ?? error) });
      }
    }
  };

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
       * Write only, now that /__library does the reading. Unlike
       * everything else here it writes bytes rather than source. A
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
          // Listing moved to /__library, which answers the same question and
          // the four that always came with it: what is in the folders, which
          // of it is a record, and which files no record names.
          if (req.method !== 'POST') return json(res, 405, { error: 'Use POST' });

          const { game, path: given, name, data } = await readBody(req);
          // `name` is the old spelling, and a bare filename is a path of one
          // segment -- so the two are the same request and only one of them
          // has to be handled.
          const rel = given ?? name;
          const target = await assetTarget(game, rel);
          if (!target) {
            return json(res, 400, { error: `Cannot store a file at "${rel}"` });
          }
          if (typeof data !== 'string' || !data.length) {
            return json(res, 400, { error: 'Expected base64 file data' });
          }

          // Sent as a data URL by the browser, which is the form a FileReader
          // produces; the bytes start after the comma.
          const base64 = data.slice(data.indexOf(',') + 1);
          const bytes = Buffer.from(base64, 'base64');
          if (!bytes.length) return json(res, 400, { error: 'That file was empty' });

          await mkdir(dirname(target), { recursive: true });
          await writeFile(target, bytes);
          return json(res, 200, { ok: true, file: assetRel(rel), bytes: bytes.length });
        } catch (error) {
          return json(res, 500, { error: String(error?.message ?? error) });
        }
      });

      /**
       * The library: the folders under assets/, the records in them, and every
       * mutation the browser can make to either.
       *
       * A record lives in the folder with the files it is made of, so that a
       * material is a thing you can copy by copying a directory. What that
       * costs is this endpoint: the editor can no longer describe its library
       * as one array posted to /__data, because half of it is now a shape on
       * disk that only the filesystem knows.
       *
       * One POST for every kind of change rather than a verb apiece, because
       * they arrive together -- a save is writes plus a prune, a rename is a
       * move plus the write that follows it -- and half of a batch applied is
       * worse than none of it.
       */
      server.middlewares.use('/__library', async (req, res) => {
        try {
          if (req.method === 'GET') {
            const asked = new URL(req.url ?? '', 'http://localhost').searchParams.get('game');
            const root = assetsDir(asked);
            if (!root) return json(res, 400, { error: `Invalid game "${asked}"` });
            const out = { tree: [], records: [], errors: [] };
            await walkAssets(root, '', out);
            return json(res, 200, out);
          }

          if (req.method !== 'POST') return json(res, 405, { error: 'Use GET or POST' });

          const body = await readBody(req);
          const { game, mkdirs = [], moves = [], writes = [], deletes = [], prune = [] } = body;
          const root = assetsDir(game);
          if (!root) return json(res, 400, { error: `Invalid game "${game}"` });

          // Everything is checked before anything is written, the same way
          // /__data checks its whole batch: these operations reference each
          // other -- a move then a write into where it landed -- so stopping
          // halfway leaves the folder in a shape nobody asked for.
          const plan = { mkdirs: [], moves: [], writes: [], deletes: [] };

          // What this batch is about to bring into being. A move is checked
          // against the folder as it will be once the mkdirs above it have
          // run, not as it is now -- otherwise a batch that makes a folder and
          // then moves onto it passes validation and fails halfway through,
          // which is the one outcome the up-front checking exists to prevent.
          const arriving = new Set();

          for (const rel of mkdirs) {
            const safe = assetRel(rel);
            const abs = safe ? await under(root, safe) : null;
            if (!abs) return json(res, 400, { error: `Cannot make a folder at "${rel}"` });
            plan.mkdirs.push(abs);
            arriving.add(abs.toLowerCase());
          }

          for (const { from, to } of moves) {
            const a = assetRel(from);
            const b = assetRel(to);
            if (!a || !b) return json(res, 400, { error: `Cannot move "${from}" to "${to}"` });
            if (TOP_FOLDERS.has(a)) {
              return json(res, 400, { error: `"${a}" is a library folder; it stays put` });
            }
            // A folder cannot go inside itself: the rename would succeed and
            // the subtree would be somewhere neither name reaches.
            if (b === a || b.startsWith(`${a}/`)) {
              return json(res, 400, { error: `"${from}" cannot move inside itself` });
            }
            const absA = await under(root, a);
            const absB = await under(root, b);
            if (!absA || !absB) return json(res, 400, { error: `Cannot move "${from}" to "${to}"` });
            try {
              await stat(absA);
            } catch {
              return json(res, 400, { error: `There is no "${from}" to move` });
            }
            // Never onto something that is there: rename replaces outright on
            // POSIX and fails with EPERM on Windows, and neither is an answer
            // worth giving. Compared case-blind because this is Windows as
            // often as not and "Wood" landing on "wood" is the same directory
            // -- which is also why a move that only changes case is let
            // through.
            const sameName = absA.toLowerCase() === absB.toLowerCase();
            let taken = arriving.has(absB.toLowerCase());
            if (!taken) {
              try {
                await stat(absB);
                taken = true;
              } catch {
                // Nothing there, which is what we want.
              }
            }
            if (taken && !sameName) {
              return json(res, 409, { error: `"${to}" is already there` });
            }
            plan.moves.push([absA, absB]);
            arriving.add(absB.toLowerCase());
          }

          for (const { path: rel, record } of writes) {
            const safe = assetRel(rel);
            if (!safe) return json(res, 400, { error: `Cannot write "${rel}"` });
            const name = safe.split('/').pop();
            if (!RECORD_FILES.has(name)) {
              return json(res, 400, { error: `"${name}" is not a record file` });
            }
            const abs = await under(root, safe);
            if (!abs) return json(res, 400, { error: `Cannot write "${rel}"` });
            let source;
            try {
              source = JSON.stringify(record, null, 2);
            } catch (error) {
              return json(res, 400, { error: `"${rel}" will not serialize: ${error.message}` });
            }
            if (typeof source !== 'string') {
              return json(res, 400, { error: `"${rel}" has no record to write` });
            }
            plan.writes.push([abs, `${source}\n`]);
          }

          for (const { path: rel, recursive } of deletes) {
            const safe = assetRel(rel);
            if (!safe) return json(res, 400, { error: `Cannot delete "${rel}"` });
            if (TOP_FOLDERS.has(safe)) {
              return json(res, 400, { error: `"${safe}" is a library folder; it stays` });
            }
            const abs = await under(root, safe);
            if (!abs) return json(res, 400, { error: `Cannot delete "${rel}"` });
            plan.deletes.push([abs, Boolean(recursive)]);
          }

          // Saving is declarative: a record file the editor did not send is one
          // it no longer has. Scoped to the record json of the kinds named, so
          // a save can never take a picture or a model with it -- those are
          // bytes nothing else has a copy of.
          const keeping = new Set(plan.writes.map(([abs]) => abs));
          const pruned = [];
          if (prune.length) {
            const wanted = new Set(prune);
            const found = { tree: [], records: [], errors: [] };
            await walkAssets(root, '', found);
            for (const entry of found.tree) {
              if (entry.dir || entry.link) continue;
              const kind = RECORD_FILES.get(entry.path.split('/').pop());
              if (!kind || !wanted.has(kind)) continue;
              const abs = resolve(root, entry.path);
              if (keeping.has(abs)) continue;
              pruned.push(entry.path);
              plan.deletes.push([abs, false]);
            }
          }

          for (const abs of plan.mkdirs) await mkdir(abs, { recursive: true });
          for (const [from, to] of plan.moves) {
            await mkdir(dirname(to), { recursive: true });
            await rename(from, to);
          }
          for (const [abs, source] of plan.writes) {
            await mkdir(dirname(abs), { recursive: true });
            await writeFile(abs, source, 'utf8');
          }
          for (const [abs, recursive] of plan.deletes) await rm(abs, { recursive, force: true });

          return json(res, 200, {
            ok: true,
            made: plan.mkdirs.length,
            moved: plan.moves.length,
            wrote: plan.writes.length,
            deleted: plan.deletes.length,
            pruned,
          });
        } catch (error) {
          return json(res, 500, { error: String(error?.message ?? error) });
        }
      });
    },
  };
}
