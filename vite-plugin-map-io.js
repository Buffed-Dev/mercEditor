import { cp, readFile, readdir, stat, writeFile, mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { cleanRel, createDraftStore, typeOfName } from './draftStore.js';

/**
 * Dev-only API that lets the editor read and write game folders.
 *
 * A browser page cannot touch the filesystem, so the editor asks here.
 *
 *   GET  /__games                           →  the game folders under Games/
 *   POST /__games { id, from }              →  a new game, copied from another
 *   GET  /__maps?game=<id>                  →  that game's map files, drafts included
 *   POST /__data  { game, files: [...] }    →  Games/<game>/rules/<kind>.js (direct)
 *   GET  /__draft/tree?game=<id>            →  assets/ and maps/ as the editor sees them
 *   GET  /__draft/file/<game>/<rel>         →  one file's bytes, draft first
 *   POST /__draft/upload/<game>/<rel>       →  raw bytes into the draft
 *   POST /__draft/ops { game, ops }         →  mkdir / write / move / copy / delete, in the draft
 *   POST /__publish { game }                →  the draft checked, copied into the game, removed
 *
 * Assets and maps are never written straight into the game. Every change goes
 * to `Games/<game>/.draft/` (see draftStore.js), which the game runtime never
 * reads, and only Publish moves it over. Rules are the exception and are
 * written directly.
 *
 * Not registered for `vite build`: the editor is a development tool.
 */
export function mapIo({ dir = 'Games' } = {}) {
  const root = process.cwd();
  const gamesDir = resolve(root, dir);

  // What the editor writes, as the watcher spells it.
  const editorWrites = gamesDir.split('\\').join('/');

  // Rule files are a closed set, so the client never supplies a path.
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

  // An id becomes a path segment, so keep it to something that cannot escape.
  const idPattern = /^[A-Za-z][A-Za-z0-9-]{0,39}$/;

  /** The folder for a game id, or null if the id is not one. */
  const gameDir = (id) => (idPattern.test(id ?? '') ? resolve(gamesDir, id) : null);

  const MIME = {
    png: 'image/png',
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    webp: 'image/webp',
    glb: 'model/gltf-binary',
    gltf: 'model/gltf+json',
    json: 'application/json',
    js: 'text/javascript',
    meta: 'application/json',
  };

  /**
   * Everything under assets/ and maps/ as the editor should see it, with each
   * json asset parsed and each file's sidecar id attached.
   */
  async function tree(store) {
    const entries = [...(await store.list('assets')), ...(await store.list('maps'))];
    const metas = new Map();
    const records = [];
    const errors = [];
    const out = [];

    for (const entry of entries) {
      if (entry.dir) continue;
      const name = entry.path.slice(entry.path.lastIndexOf('/') + 1);
      const type = typeOfName(name);
      if (type === 'meta') {
        try {
          const meta = JSON.parse(String(await store.read(entry.path)));
          metas.set(entry.path.slice(0, -'.meta'.length), String(meta.id ?? ''));
        } catch (error) {
          errors.push({ path: entry.path, message: `Unreadable sidecar: ${error.message}` });
        }
        continue;
      }
      if (type && type !== 'texture' && type !== 'model') {
        try {
          records.push({ path: entry.path, type, record: JSON.parse(String(await store.read(entry.path))) });
        } catch (error) {
          errors.push({ path: entry.path, message: String(error?.message ?? error) });
        }
      }
    }

    for (const entry of entries) {
      const name = entry.path.slice(entry.path.lastIndexOf('/') + 1);
      const type = entry.dir ? 'folder' : typeOfName(name);
      if (type === 'meta') continue;
      out.push({ ...entry, type: type ?? 'other', ...(metas.has(entry.path) ? { id: metas.get(entry.path) } : {}) });
    }
    const pending = await store.pending();
    return { entries: out, records, errors, pending: pending.count };
  }

  /** What would stop a publish, as far as the files alone can say. */
  async function problems(store) {
    const { entries, records, errors } = await tree(store);
    const found = [...errors];
    const ids = new Map();
    const claim = (id, path) => {
      if (!id) return found.push({ path, message: 'Has no id' });
      if (ids.has(id)) found.push({ path, message: `Id "${id}" is also used by ${ids.get(id)}` });
      else ids.set(id, path);
    };
    for (const entry of entries) {
      if (entry.type === 'texture' || entry.type === 'model') {
        if (!entry.id) found.push({ path: entry.path, message: 'Has no .meta sidecar' });
        else claim(entry.id, entry.path);
      }
    }
    for (const { path, record } of records) claim(String(record?.id ?? ''), path);
    return found;
  }

  return {
    name: 'merc:map-io',
    apply: 'serve',

    /**
     * Stop an editor write from reloading the page. Drafts are outside every
     * module graph anyway; a publish writes into the game folder, and the
     * editor reloads its tree by itself afterwards.
     */
    handleHotUpdate({ file }) {
      const path = file.split('\\').join('/');
      if (path.startsWith(editorWrites)) return [];
    },

    configureServer(server) {
      server.watcher.unwatch(`${editorWrites}/*/.draft/**`);

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

      const query = (req) => new URL(req.url ?? '', 'http://localhost').searchParams;

      server.middlewares.use('/__games', async (req, res) => {
        try {
          if (req.method === 'POST') {
            const { id, from } = await readBody(req);
            const folder = gameDir(id);
            const source = gameDir(from);
            if (!folder) return json(res, 400, { error: `Invalid game id "${id}"` });
            if (!source) return json(res, 400, { error: `Invalid game "${from}" to copy` });
            try {
              await stat(folder);
              return json(res, 409, { error: `A game called "${id}" is already there` });
            } catch {
              // Nothing there, which is what we want.
            }
            await cp(source, folder, {
              recursive: true,
              filter: (src) => !src.split(/[\\/]/).includes('.draft'),
            });
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
          if (req.method !== 'GET') return json(res, 405, { error: 'Use GET; maps are written through /__draft/ops' });
          const asked = query(req).get('game');
          const folder = gameDir(asked);
          if (!folder) return json(res, 400, { error: `Invalid game "${asked}"` });
          const files = (await createDraftStore(folder).list('maps'))
            .filter((entry) => !entry.dir && entry.path.endsWith('.js'))
            .map((entry) => entry.path.slice('maps/'.length));
          return json(res, 200, { files });
        } catch (error) {
          return json(res, 500, { error: String(error?.message ?? error) });
        }
      });

      // Rules are not drafted: they are written straight into rules/.
      server.middlewares.use('/__data', async (req, res) => {
        try {
          if (req.method !== 'POST') return json(res, 405, { error: 'Use POST' });

          const { game, files } = await readBody(req);
          const folder = gameDir(game);
          if (!folder) return json(res, 400, { error: `Invalid game "${game}"` });
          if (!Array.isArray(files) || !files.length) {
            return json(res, 400, { error: 'Expected a files array' });
          }
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
            const target = resolve(rules, `${kind}.js`);
            // Autosaved on every change, so an unchanged file is not rewritten.
            const before = await readFile(target, 'utf8').catch(() => null);
            if (before === source) continue;
            await writeFile(target, source, 'utf8');
            written.push(`${dir}/${game}/rules/${kind}.js`);
          }

          return json(res, 200, { ok: true, files: written });
        } catch (error) {
          return json(res, 500, { error: String(error?.message ?? error) });
        }
      });

      server.middlewares.use('/__draft/tree', async (req, res) => {
        try {
          const asked = query(req).get('game');
          const folder = gameDir(asked);
          if (!folder) return json(res, 400, { error: `Invalid game "${asked}"` });
          return json(res, 200, await tree(createDraftStore(folder)));
        } catch (error) {
          return json(res, 500, { error: String(error?.message ?? error) });
        }
      });

      server.middlewares.use('/__draft/file', async (req, res) => {
        try {
          // /<game>/<rel>, so the url ends in the file's own name and a loader
          // can tell a .glb from its extension. ?game=&path= also works.
          const params = query(req);
          const [, pathGame = '', ...parts] = new URL(req.url ?? '', 'http://localhost').pathname.split('/');
          const folder = gameDir(params.get('game') ?? decodeURIComponent(pathGame));
          const rel = params.get('path') ?? parts.map(decodeURIComponent).join('/');
          if (!folder) return json(res, 400, { error: 'Invalid game' });
          const safe = cleanRel(rel);
          if (!safe) return json(res, 400, { error: `Invalid path "${rel}"` });
          const bytes = await createDraftStore(folder).read(safe);
          if (!bytes) return json(res, 404, { error: `No "${rel}"` });
          res.statusCode = 200;
          res.setHeader('Content-Type', MIME[safe.split('.').pop().toLowerCase()] ?? 'application/octet-stream');
          res.setHeader('Cache-Control', 'no-store');
          res.end(bytes);
        } catch (error) {
          return json(res, 500, { error: String(error?.message ?? error) });
        }
      });

      // Raw bytes rather than base64 in JSON: a texture can be tens of megabytes.
      server.middlewares.use('/__draft/upload', async (req, res) => {
        try {
          if (req.method !== 'POST') return json(res, 405, { error: 'Use POST' });
          const [, pathGame = '', ...parts] = new URL(req.url ?? '', 'http://localhost').pathname.split('/');
          const folder = gameDir(decodeURIComponent(pathGame));
          const rel = cleanRel(parts.map(decodeURIComponent).join('/'));
          if (!folder || !rel) return json(res, 400, { error: 'Invalid game or path' });
          const chunks = [];
          for await (const chunk of req) chunks.push(chunk);
          const bytes = Buffer.concat(chunks);
          if (!bytes.length) return json(res, 400, { error: 'That file was empty' });
          const store = createDraftStore(folder);
          await store.apply([{ op: 'writeBinary', path: rel, data: bytes.toString('base64') }]);
          return json(res, 200, { ok: true, pending: (await store.pending()).count });
        } catch (error) {
          return json(res, 500, { error: String(error?.message ?? error) });
        }
      });

      server.middlewares.use('/__draft/ops', async (req, res) => {
        try {
          if (req.method !== 'POST') return json(res, 405, { error: 'Use POST' });
          const { game, ops } = await readBody(req);
          const folder = gameDir(game);
          if (!folder) return json(res, 400, { error: `Invalid game "${game}"` });
          const store = createDraftStore(folder);
          try {
            const result = await store.apply(ops);
            return json(res, 200, { ok: true, ...result, pending: (await store.pending()).count });
          } catch (error) {
            return json(res, 400, { error: String(error?.message ?? error) });
          }
        } catch (error) {
          return json(res, 500, { error: String(error?.message ?? error) });
        }
      });

      server.middlewares.use('/__publish', async (req, res) => {
        try {
          if (req.method !== 'POST') return json(res, 405, { error: 'Use POST' });
          const { game } = await readBody(req);
          const folder = gameDir(game);
          if (!folder) return json(res, 400, { error: `Invalid game "${game}"` });
          const store = createDraftStore(folder);
          const found = await problems(store);
          if (found.length) {
            return json(res, 409, {
              error: `Cannot publish: ${found.length} problem${found.length > 1 ? 's' : ''}`,
              problems: found,
            });
          }
          const result = await store.publish();
          return json(res, 200, { ok: true, ...result });
        } catch (error) {
          return json(res, 500, { error: String(error?.message ?? error) });
        }
      });
    },
  };
}
