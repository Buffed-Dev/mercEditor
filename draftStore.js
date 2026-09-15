import { mkdir, readFile, readdir, rm, stat, writeFile, cp } from 'node:fs/promises';
import { dirname, resolve, sep } from 'node:path';

/**
 * Drafts: everything the editor changes, kept beside the game instead of in it.
 *
 * The game reads `Games/<game>/assets` and `maps` as they are. The editor reads
 * the same folders *through* this: a file written here shadows the published
 * one, a path listed in `deletes` hides it, and a folder listed in `dirs`
 * exists even while it is empty. Publish copies the shadows over, applies the
 * deletes, and removes the draft folder, so the draft never grows past one
 * session's worth of changes.
 *
 *   .draft/manifest.json   { deletes: [rel], dirs: [rel] }
 *   .draft/files/<rel>     a changed file, at the same path it will publish to
 *
 * `rel` is always a path from the game folder: `assets/Terrain/grass.block.json`
 * or `maps/base.js`. Nothing outside those two roots is draftable.
 *
 * Plain functions over a folder, with no server in them, so tests can drive a
 * temporary directory directly.
 */

export const ROOTS = ['assets', 'maps'];

// One path segment. No leading dot, so `..`, `.draft` and dotfiles are all out;
// no slash, backslash or colon, so nothing can be spelled that leaves the root.
const SEGMENT = /^[A-Za-z0-9][A-Za-z0-9 _()+.,-]{0,79}$/;
const MAX_DEPTH = 10;

/** Asset file types, by extension. A `.meta` sidecar goes beside each of them. */
export const FILE_TYPES = {
  png: 'texture',
  jpg: 'texture',
  jpeg: 'texture',
  webp: 'texture',
  glb: 'model',
  gltf: 'model',
};

/** Json asset types, by the middle of `name.<type>.json`. */
export const ASSET_TYPES = ['material', 'block', 'prefab', 'effect', 'profile'];

/** What a filename is: a json asset type, a file type, `meta`, or null. */
export function typeOfName(name) {
  const lower = String(name).toLowerCase();
  if (lower.endsWith('.meta')) return 'meta';
  const parts = lower.split('.');
  if (parts.length >= 3 && parts.at(-1) === 'json' && ASSET_TYPES.includes(parts.at(-2))) {
    return parts.at(-2);
  }
  return FILE_TYPES[parts.at(-1)] ?? null;
}

/** A clean relative path under one of the roots, or null. */
export function cleanRel(rel) {
  const parts = String(rel ?? '').replace(/\\/g, '/').split('/');
  if (parts.length < 1 || parts.length > MAX_DEPTH || !ROOTS.includes(parts[0])) return null;
  if (!parts.slice(1).every((part) => SEGMENT.test(part))) return null;
  return parts.join('/');
}

const inside = (base, abs) => abs === base || abs.startsWith(base + sep);

export function createDraftStore(gameDir) {
  const draftDir = resolve(gameDir, '.draft');
  const filesDir = resolve(draftDir, 'files');
  const manifestPath = resolve(draftDir, 'manifest.json');

  const published = (rel) => {
    const abs = resolve(gameDir, rel);
    if (!inside(gameDir, abs)) throw new Error(`"${rel}" is outside the game`);
    return abs;
  };
  const drafted = (rel) => {
    const abs = resolve(filesDir, rel);
    if (!inside(filesDir, abs)) throw new Error(`"${rel}" is outside the draft`);
    return abs;
  };

  async function manifest() {
    try {
      const parsed = JSON.parse(await readFile(manifestPath, 'utf8'));
      return { deletes: parsed.deletes ?? [], dirs: parsed.dirs ?? [] };
    } catch {
      return { deletes: [], dirs: [] };
    }
  }

  async function saveManifest(m) {
    await mkdir(draftDir, { recursive: true });
    const clean = { deletes: [...new Set(m.deletes)].sort(), dirs: [...new Set(m.dirs)].sort() };
    await writeFile(manifestPath, `${JSON.stringify(clean, null, 2)}\n`, 'utf8');
  }

  const exists = async (abs) => {
    try {
      return await stat(abs);
    } catch {
      return null;
    }
  };

  /** A path, or one of its folders, is listed as deleted. */
  const hidden = (m, rel) => m.deletes.some((gone) => rel === gone || rel.startsWith(`${gone}/`));

  /**
   * Every entry under a root as the editor should see it: published, with the
   * draft laid over. Directories and files, keyed by rel path.
   */
  async function list(root = 'assets') {
    const m = await manifest();
    const out = new Map();

    const walk = async (base, rel, depth, fromDraft) => {
      if (depth > MAX_DEPTH) return;
      let entries;
      try {
        entries = await readdir(base, { withFileTypes: true });
      } catch {
        return;
      }
      for (const entry of entries) {
        if (entry.name.startsWith('.') || entry.isSymbolicLink()) continue;
        const childRel = `${rel}/${entry.name}`;
        const abs = resolve(base, entry.name);
        if (!fromDraft && hidden(m, childRel)) continue;
        if (entry.isDirectory()) {
          out.set(childRel, { path: childRel, dir: true, draft: fromDraft || out.get(childRel)?.draft });
          await walk(abs, childRel, depth + 1, fromDraft);
          continue;
        }
        const info = await exists(abs);
        out.set(childRel, {
          path: childRel,
          dir: false,
          size: info?.size ?? 0,
          mtime: info?.mtimeMs ?? 0,
          draft: fromDraft,
        });
      }
    };

    await walk(published(root), root, 0, false);
    await walk(drafted(root), root, 0, true);
    for (const dir of m.dirs) {
      if (dir.startsWith(`${root}/`) && !hidden(m, dir)) {
        out.set(dir, { path: dir, dir: true, draft: true });
      }
    }
    // A drafted file inside a folder that was deleted and remade: its parents
    // exist again even if the manifest never named them.
    for (const entry of [...out.values()]) {
      let parent = entry.path.slice(0, entry.path.lastIndexOf('/'));
      while (parent.includes('/') && !out.has(parent)) {
        out.set(parent, { path: parent, dir: true, draft: true });
        parent = parent.slice(0, parent.lastIndexOf('/'));
      }
    }
    return [...out.values()].sort((a, b) => a.path.localeCompare(b.path));
  }

  /** The bytes a path holds as the editor sees it, or null. */
  async function read(rel) {
    const m = await manifest();
    const draft = drafted(rel);
    if (await exists(draft)) return readFile(draft);
    if (hidden(m, rel)) return null;
    const live = published(rel);
    const info = await exists(live);
    return info && info.isFile() ? readFile(live) : null;
  }

  async function isDir(rel, m) {
    const d = await exists(drafted(rel));
    if (d?.isDirectory()) return true;
    if (m.dirs.includes(rel) && !hidden(m, rel)) return true;
    if (hidden(m, rel)) return false;
    return Boolean((await exists(published(rel)))?.isDirectory());
  }

  async function present(rel, m) {
    if (await exists(drafted(rel))) return true;
    if (m.dirs.includes(rel) && !hidden(m, rel)) return true;
    if (hidden(m, rel)) return false;
    return Boolean(await exists(published(rel)));
  }

  /**
   * Un-hide a path and every folder above it, because something is being put
   * there. A deleted folder that is un-hidden this way must not bring its old
   * published contents back, so everything else it held is listed instead.
   */
  async function reveal(m, rel) {
    const covering = m.deletes.filter((gone) => rel === gone || rel.startsWith(`${gone}/`));
    if (!covering.length) return;
    m.deletes = m.deletes.filter((gone) => !covering.includes(gone));
    for (const gone of covering) {
      if (gone === rel && !(await exists(published(gone)))?.isDirectory()) continue;
      // Hide every published child of `gone` that is not on the way down to rel.
      let at = gone;
      while (at !== rel) {
        let entries;
        try {
          entries = await readdir(published(at), { withFileTypes: true });
        } catch {
          break;
        }
        const next = rel.slice(0, rel.indexOf('/', at.length + 1) === -1 ? rel.length : rel.indexOf('/', at.length + 1));
        for (const entry of entries) {
          const child = `${at}/${entry.name}`;
          if (child !== next && !entry.name.startsWith('.')) m.deletes.push(child);
        }
        at = next;
      }
      if (gone === rel || at === rel) {
        // rel itself was a deleted folder being remade: hide what it held.
        try {
          for (const entry of await readdir(published(rel), { withFileTypes: true })) {
            if (!entry.name.startsWith('.')) m.deletes.push(`${rel}/${entry.name}`);
          }
        } catch {
          // Not a published folder; nothing to hide.
        }
      }
    }
  }

  async function writeOne(m, rel, bytes) {
    await reveal(m, rel);
    const abs = drafted(rel);
    await mkdir(dirname(abs), { recursive: true });
    await writeFile(abs, bytes);
  }

  /**
   * Remove a path from the editor's view: drop its draft copy and, if there is
   * a published one, list it as deleted. A folder takes everything in it.
   */
  async function deleteOne(m, rel, stash) {
    const under = (dir) => dir === rel || dir.startsWith(`${rel}/`);
    if (stash) {
      // Kept, so an undo can put it back without the editor holding the bytes.
      const box = trashOf(stash);
      const info = await readFile(resolve(box, 'info.json'), 'utf8').then(JSON.parse, () => ({}));
      info[rel] = { dirs: m.dirs.filter(under) };
      await mkdir(box, { recursive: true });
      if (await exists(drafted(rel))) {
        const kept = resolve(box, 'files', rel);
        await rm(kept, { recursive: true, force: true });
        await mkdir(dirname(kept), { recursive: true });
        await cp(drafted(rel), kept, { recursive: true });
      }
      await writeFile(resolve(box, 'info.json'), JSON.stringify(info), 'utf8');
    }
    await rm(drafted(rel), { recursive: true, force: true });
    m.dirs = m.dirs.filter((dir) => !under(dir));
    if (await exists(published(rel))) m.deletes.push(rel);
  }

  const STASH = /^[A-Za-z0-9]{1,40}$/;
  const trashOf = (stash) => {
    if (!STASH.test(String(stash))) throw new Error(`Invalid stash "${stash}"`);
    return resolve(draftDir, 'trash', stash);
  };

  /** Put back what a stashed delete took: its draft copy, its folders, the published file. */
  async function restoreOne(m, rel, stash) {
    const box = trashOf(stash);
    const info = await readFile(resolve(box, 'info.json'), 'utf8').then(JSON.parse, () => ({}));
    m.deletes = m.deletes.filter((gone) => !(gone === rel || gone.startsWith(`${rel}/`)));
    const kept = resolve(box, 'files', rel);
    if (await exists(kept)) {
      await mkdir(dirname(drafted(rel)), { recursive: true });
      await cp(kept, drafted(rel), { recursive: true, force: true });
      await rm(kept, { recursive: true, force: true });
    }
    m.dirs.push(...(info[rel]?.dirs ?? []));
  }

  /** Copy a path, file or folder, from what the editor sees into the draft. */
  async function copyInto(m, from, to) {
    if (await isDir(from, m)) {
      const entries = (await list(from.split('/')[0])).filter((e) => e.path.startsWith(`${from}/`));
      await reveal(m, to);
      m.dirs.push(to);
      for (const entry of entries) {
        const target = `${to}${entry.path.slice(from.length)}`;
        if (entry.dir) {
          m.dirs.push(target);
          continue;
        }
        const bytes = await read(entry.path);
        if (bytes) await writeOne(m, target, bytes);
      }
      return;
    }
    const bytes = await read(from);
    if (!bytes) throw new Error(`There is no "${from}"`);
    await writeOne(m, to, bytes);
  }

  /**
   * Apply a batch of operations, all checked first.
   *
   *   { op: 'mkdir', path }
   *   { op: 'write', path, text }        text file (json, map module)
   *   { op: 'writeBinary', path, data }  base64 or data URL
   *   { op: 'move', from, to, overwrite? }
   *   { op: 'copy', from, to, overwrite? }
   *   { op: 'delete', path, stash? }   stash: keep it for 'restore'
   *   { op: 'restore', path, stash }
   */
  async function apply(ops) {
    if (!Array.isArray(ops) || !ops.length) throw new Error('Expected a list of operations');
    const m = await manifest();
    const planned = [];
    for (const op of ops) {
      const paths = op.op === 'move' || op.op === 'copy' ? [op.from, op.to] : [op.path];
      const clean = paths.map(cleanRel);
      if (clean.some((p) => !p || !p.includes('/'))) {
        throw new Error(`Cannot ${op.op} "${paths.join('" to "')}"`);
      }
      if (op.op === 'write' && typeof op.text !== 'string') throw new Error(`Nothing to write to "${op.path}"`);
      if (op.op === 'writeBinary' && (typeof op.data !== 'string' || !op.data.length)) {
        throw new Error(`Nothing to write to "${op.path}"`);
      }
      if ((op.op === 'move' || op.op === 'copy') && (clean[1] === clean[0] || clean[1].startsWith(`${clean[0]}/`))) {
        if (!(op.op === 'move' && clean[1].toLowerCase() === clean[0].toLowerCase() && clean[1] === clean[0])) {
          throw new Error(`"${op.from}" cannot go inside itself`);
        }
      }
      if (!['mkdir', 'write', 'writeBinary', 'move', 'copy', 'delete', 'restore'].includes(op.op)) {
        throw new Error(`Unknown operation "${op.op}"`);
      }
      planned.push({ ...op, clean });
    }

    for (const op of planned) {
      const [a, b] = op.clean;
      if (op.op === 'mkdir') {
        await reveal(m, a);
        m.dirs.push(a);
      } else if (op.op === 'write') {
        await writeOne(m, a, Buffer.from(op.text, 'utf8'));
      } else if (op.op === 'writeBinary') {
        const bytes = Buffer.from(op.data.slice(op.data.indexOf(',') + 1), 'base64');
        if (!bytes.length) throw new Error(`"${a}" was empty`);
        await writeOne(m, a, bytes);
      } else if (op.op === 'delete') {
        await deleteOne(m, a, op.stash);
      } else if (op.op === 'restore') {
        await restoreOne(m, a, op.stash);
      } else {
        if (!(await present(a, m))) throw new Error(`There is no "${a}"`);
        const sameName = a.toLowerCase() === b.toLowerCase();
        if (!sameName && (await present(b, m))) {
          if (!op.overwrite) throw new Error(`"${b}" is already there`);
          await deleteOne(m, b, op.stash);
        }
        if (op.op === 'copy') {
          await copyInto(m, a, b);
        } else if (sameName) {
          // A case-only rename: copy out and back through a temporary name.
          const temp = `${a}.moving`;
          await copyInto(m, a, temp);
          await deleteOne(m, a);
          await copyInto(m, temp, b);
          await rm(drafted(temp), { recursive: true, force: true });
          m.dirs = m.dirs.filter((dir) => !(dir === temp || dir.startsWith(`${temp}/`)));
        } else {
          await copyInto(m, a, b);
          await deleteOne(m, a);
        }
      }
    }
    await saveManifest(m);
    return { applied: planned.length };
  }

  /** Whether there is anything unpublished. */
  async function pending() {
    const m = await manifest();
    const files = [];
    const walk = async (base, rel) => {
      let entries;
      try {
        entries = await readdir(base, { withFileTypes: true });
      } catch {
        return;
      }
      for (const entry of entries) {
        const childRel = rel ? `${rel}/${entry.name}` : entry.name;
        if (entry.isDirectory()) await walk(resolve(base, entry.name), childRel);
        else files.push(childRel);
      }
    };
    await walk(filesDir, '');
    return { files, deletes: m.deletes, dirs: m.dirs, count: files.length + m.deletes.length + m.dirs.length };
  }

  /**
   * Make the draft the game: deletes first, then every drafted file and folder
   * copied over, then the draft folder removed.
   */
  async function publish() {
    const m = await manifest();
    const summary = await pending();
    for (const rel of m.deletes) await rm(published(rel), { recursive: true, force: true });
    for (const rel of m.dirs) await mkdir(published(rel), { recursive: true });
    if (await exists(filesDir)) await cp(filesDir, gameDir, { recursive: true, force: true });
    await rm(draftDir, { recursive: true, force: true });
    return { wrote: summary.files.length, deleted: m.deletes.length };
  }

  return { list, read, apply, pending, publish, manifest, draftDir };
}
