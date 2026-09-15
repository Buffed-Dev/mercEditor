import type { DataDocument, RuleRecord } from '../dataDocument.ts';
import { globalHistory } from '../globalHistory.ts';
import { draftOps, enqueue, refreshTree, useAssetTree, type DraftOp } from './session.ts';
import {
  JSON_TYPES,
  LIST_OF,
  TYPE_LABEL,
  badName,
  displayName,
  fileNameFor,
  fileTypeOf,
  folderOf,
  freshName,
  join,
  keepBothName,
  nameOf,
  newFileId,
  recordPath,
  type AssetEntry,
  type JsonType,
  type LibraryRecord,
} from './model.ts';

/**
 * Everything the Assets panel can do to the files, each one a single undo step.
 *
 * Json assets live in the rules document, so creating, renaming, moving and
 * deleting one is a document edit that the autosave turns into files. Textures,
 * models and folders have no document; they are draft operations, and their
 * undo is the inverse operation. An edit touching both — moving a folder that
 * holds materials — is one step that does both.
 */

export type Conflict = 'replace' | 'keep' | 'skip';

/** Asks what to do about a name that is taken. `all` applies it to the rest. */
export type AskConflict = (name: string, folder: string) => Promise<{ choice: Conflict; all: boolean }>;

export type Ops = ReturnType<typeof createFileOps>;

const A = (path: string) => `assets/${path}`;
const isJson = (type: string): type is JsonType => (JSON_TYPES as string[]).includes(type);

/** A key the server keeps deleted files under, so an undo can restore them. */
const newStash = () => `s${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;

/** Send a file's bytes into the draft as they are. */
async function upload(game: string, path: string, file: File): Promise<void> {
  const url = `/__draft/upload/${encodeURIComponent(game)}/${A(path).split('/').map(encodeURIComponent).join('/')}`;
  const response = await fetch(url, { method: 'POST', body: file });
  if (!response.ok) {
    const body = (await response.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error ?? `Could not add ${file.name}`);
  }
}


export function createFileOps(game: string, rules: DataDocument, askConflict: AskConflict) {
  const entries = () => useAssetTree.getState().entries;
  const exists = (path: string) => entries().some((entry) => entry.path.toLowerCase() === path.toLowerCase());
  const refresh = () => refreshTree(game, rules);

  /** The record a json entry is, and where it sits in its list. */
  function recordAt(path: string): { type: JsonType; list: string; index: number; record: LibraryRecord } | null {
    for (const type of JSON_TYPES) {
      const list = LIST_OF[type];
      const records = rules.list(list) as LibraryRecord[];
      const index = records.findIndex((record) => recordPath(type, record).toLowerCase() === path.toLowerCase());
      if (index >= 0) return { type, list, index, record: records[index]! };
    }
    return null;
  }

  /** Records filed anywhere under a folder. */
  function recordsUnder(folder: string) {
    const out: { type: JsonType; list: string; id: string; record: LibraryRecord }[] = [];
    for (const type of JSON_TYPES) {
      for (const record of rules.list(LIST_OF[type]) as LibraryRecord[]) {
        const path = String(record.path ?? '');
        if (path === folder || path.startsWith(`${folder}/`)) {
          out.push({ type, list: LIST_OF[type], id: String(record.id), record });
        }
      }
    }
    return out;
  }

  const indexOf = (list: string, id: string) => (rules.list(list) as LibraryRecord[]).findIndex((r) => r.id === id);

  /** Run a document change and file operations as one step, and record it. */
  async function step(
    label: string,
    apply: {
      doc?: (() => void) | undefined;
      /** Run before the uploads: what a replaced file is stashed by. */
      before?: DraftOp[];
      uploads?: { path: string; file: File }[];
      ops?: DraftOp[];
      undoOps?: DraftOp[];
    },
  ) {
    const files = async () => {
      if (apply.before?.length) await draftOps(game, apply.before, label);
      const sending = apply.uploads ?? [];
      if (sending.length) {
        await enqueue(async () => {
          for (const one of sending) await upload(game, one.path, one.file);
        });
      }
      if (apply.ops?.length) await draftOps(game, apply.ops, label);
    };
    await globalHistory.batch(async () => {
      if (apply.doc) {
        rules.checkpoint();
        apply.doc();
      }
      await files();
    });
    const touchedDoc = Boolean(apply.doc);
    globalHistory.push({
      label,
      undo: async () => {
        if (apply.undoOps?.length) await draftOps(game, apply.undoOps, `undo ${label}`);
        if (touchedDoc) rules.undo();
        await refresh();
      },
      redo: async () => {
        if (touchedDoc) rules.redo();
        await files();
        await refresh();
      },
    });
    await refresh();
  }

  return {
    recordAt,

    async newFolder(folder: string): Promise<string> {
      const name = freshName('New Folder', (n) => exists(join(folder, n)));
      const path = join(folder, name);
      await step(`make ${name}`, { ops: [{ op: 'mkdir', path: A(path) }], undoOps: [{ op: 'delete', path: A(path) }] });
      return path;
    },

    /** A new json asset in a folder; returns its path so it can be renamed at once. */
    async newAsset(type: JsonType, folder: string): Promise<string> {
      const list = LIST_OF[type];
      const name = freshName(`New ${TYPE_LABEL[type]}`, (n) => exists(join(folder, `${n}.${type}.json`)));
      const made = rules.add(list, folder);
      if (!made) throw new Error(`Cannot make a ${type}`);
      rules.update(list, made.index, { label: name, path: folder }, false);
      const record = (rules.list(list) as LibraryRecord[])[made.index]!;
      // Shown straight away, before the autosave has written it.
      useAssetTree.setState((state) => ({
        entries: [...state.entries, { path: recordPath(type, record), dir: false, type, draft: true }],
      }));
      return recordPath(type, record);
    },

    /** Files from the computer into a folder, typed by their extension. */
    async importFiles(files: readonly File[], folder: string): Promise<number> {
      const ops: DraftOp[] = [];
      const before: DraftOp[] = [];
      const undoOps: DraftOp[] = [];
      let applyAll: Conflict | null = null;
      let count = 0;
      const uploads: { path: string; file: File }[] = [];
      for (const file of files) {
        if (!fileTypeOf(file.name)) throw new Error(`${file.name}: only png, jpg, webp, glb and gltf can be added`);
        let name = file.name.replace(/[^A-Za-z0-9 _()+.,-]/g, '_').replace(/^[^A-Za-z0-9]+/, '');
        if (badName(name)) throw new Error(`${file.name}: ${badName(name)}`);
        let path = join(folder, name);
        let id = newFileId();
        const taken = entries().find((entry) => entry.path.toLowerCase() === path.toLowerCase());
        if (taken) {
          let choice: Conflict | null = applyAll;
          if (!choice) {
            const answer = await askConflict(name, folder);
            choice = answer.choice;
            if (answer.all) applyAll = choice;
          }
          if (choice === 'skip') continue;
          if (choice === 'keep') {
            name = keepBothName(name, (candidate) => exists(join(folder, candidate)));
            path = join(folder, name);
          } else {
            // Replaced in place: the id stays, so everything naming it now shows the new file.
            if (taken.id) id = taken.id;
            const stash = newStash();
            before.push({ op: 'delete', path: A(taken.path), stash }, { op: 'delete', path: A(`${taken.path}.meta`), stash });
            undoOps.unshift({ op: 'restore', path: A(taken.path), stash }, { op: 'restore', path: A(`${taken.path}.meta`), stash });
          }
        }
        uploads.push({ path, file });
        ops.push({ op: 'write', path: A(`${path}.meta`), text: `${JSON.stringify({ id }, null, 2)}\n` });
        // Undone newest first: the new file goes, then anything it replaced comes back.
        undoOps.unshift({ op: 'delete', path: A(path) }, { op: 'delete', path: A(`${path}.meta`) });
        count += 1;
      }
      // Replaced files are stashed first, then the bytes go up, then the sidecars.
      if (count) await step(`add ${count} file${count > 1 ? 's' : ''}`, { before, uploads, ops, undoOps });
      return count;
    },

    /** Rename one entry; returns its new path, or throws why not. */
    async rename(entry: AssetEntry, display: string): Promise<string> {
      const why = badName(display);
      if (why) throw new Error(why);
      const folder = folderOf(entry.path);
      const target = join(folder, fileNameFor(entry, display));
      if (target === entry.path) return target;
      if (target.toLowerCase() !== entry.path.toLowerCase() && exists(target)) {
        throw new Error(`"${nameOf(target)}" is already in ${folder || 'Assets'}`);
      }
      if (isJson(entry.type)) {
        const found = recordAt(entry.path);
        if (!found) throw new Error('That asset is not loaded');
        rules.update(found.list, found.index, { label: display.trim() });
        return target;
      }
      if (entry.type === 'folder') {
        const inside = recordsUnder(entry.path);
        await step(`rename ${nameOf(entry.path)}`, {
          doc: inside.length ? () => retarget(inside, entry.path, target) : undefined,
          ops: [{ op: 'move', from: A(entry.path), to: A(target) }],
          undoOps: [{ op: 'move', from: A(target), to: A(entry.path) }],
        });
        return target;
      }
      await step(`rename ${nameOf(entry.path)}`, {
        ops: moveFileOps(entry.path, target),
        undoOps: moveFileOps(target, entry.path),
      });
      return target;
    },

    /** Move entries into a folder, asking about each name that is taken there. */
    async move(moving: readonly AssetEntry[], toFolder: string): Promise<number> {
      const ops: DraftOp[] = [];
      const undoOps: DraftOp[] = [];
      const docChanges: (() => void)[] = [];
      let applyAll: Conflict | null = null;
      let count = 0;

      for (const entry of moving) {
        if (folderOf(entry.path) === toFolder) continue;
        if (entry.dir && (toFolder === entry.path || toFolder.startsWith(`${entry.path}/`))) {
          throw new Error(`"${nameOf(entry.path)}" cannot go inside itself`);
        }
        let name = nameOf(entry.path);
        let target = join(toFolder, name);
        let overwrite = false;
        if (exists(target)) {
          let choice: Conflict | null = applyAll;
          if (!choice) {
            const answer = await askConflict(name, toFolder);
            choice = answer.choice;
            if (answer.all) applyAll = choice;
          }
          if (choice === 'skip') continue;
          if (choice === 'keep') {
            name = keepBothName(name, (candidate) => exists(join(toFolder, candidate)));
            target = join(toFolder, name);
          } else {
            overwrite = true;
            const there = recordAt(target);
            if (there) {
              docChanges.push(() => {
                const at = indexOf(there.list, String(there.record.id));
                if (at >= 0) (rules.list(there.list) as RuleRecord[]).splice(at, 1);
              });
            }
          }
        }

        if (isJson(entry.type)) {
          const found = recordAt(entry.path);
          if (!found) continue;
          const id = String(found.record.id);
          const label = displayName({ path: target, type: entry.type });
          docChanges.push(() => rules.update(found.list, indexOf(found.list, id), { path: toFolder, label }, false));
        } else if (entry.dir) {
          const inside = recordsUnder(entry.path);
          const from = entry.path;
          if (inside.length) docChanges.push(() => retarget(inside, from, target));
          const stash = overwrite ? newStash() : undefined;
          ops.push({ op: 'move', from: A(from), to: A(target), overwrite, ...(stash ? { stash } : {}) });
          undoOps.unshift(
            { op: 'move', from: A(target), to: A(from) },
            ...(stash ? [{ op: 'restore' as const, path: A(target), stash }] : []),
          );
        } else {
          const stash = overwrite ? newStash() : undefined;
          ops.push(...moveFileOps(entry.path, target, overwrite, stash));
          undoOps.unshift(
            ...moveFileOps(target, entry.path),
            ...(stash
              ? [
                  { op: 'restore' as const, path: A(target), stash },
                  { op: 'restore' as const, path: A(`${target}.meta`), stash },
                ]
              : []),
          );
        }
        count += 1;
      }
      if (count) {
        await step(`move ${count} item${count > 1 ? 's' : ''}`, {
          doc: docChanges.length ? () => docChanges.forEach((change) => change()) : undefined,
          ops,
          undoOps,
        });
      }
      return count;
    },

    /** A copy beside the original, with new ids. Returns the copy's path. */
    async duplicate(entry: AssetEntry): Promise<string> {
      const folder = folderOf(entry.path);
      const copyName = keepBothName(nameOf(entry.path), (candidate) => exists(join(folder, candidate)));
      const target = join(folder, copyName);

      if (isJson(entry.type)) {
        const found = recordAt(entry.path);
        if (!found) throw new Error('That asset is not loaded');
        const list = found.list;
        const copy = structuredClone(found.record) as RuleRecord;
        copy.id = freshRecordId(list, String(found.record.id));
        copy.label = displayName({ path: target, type: entry.type });
        rules.insert(list, copy);
        return target;
      }

      if (!entry.dir) {
        const id = newFileId();
        await step(`duplicate ${nameOf(entry.path)}`, {
          ops: [
            { op: 'copy', from: A(entry.path), to: A(target) },
            { op: 'write', path: A(`${target}.meta`), text: `${JSON.stringify({ id }, null, 2)}\n` },
          ],
          undoOps: [
            { op: 'delete', path: A(target) },
            { op: 'delete', path: A(`${target}.meta`) },
          ],
        });
        return target;
      }

      // A folder: its files get new ids, and its records new ids, with every
      // reference inside the copy moved onto the copies.
      const under = entries().filter((one) => one.path.startsWith(`${entry.path}/`));
      const ids = new Map<string, string>();
      const ops: DraftOp[] = [{ op: 'mkdir', path: A(target) }];
      for (const one of under) {
        const to = `${target}${one.path.slice(entry.path.length)}`;
        if (one.dir) ops.push({ op: 'mkdir', path: A(to) });
        else if (!isJson(one.type)) {
          ops.push({ op: 'copy', from: A(one.path), to: A(to) });
          if (one.id) {
            const id = newFileId();
            ids.set(one.id, id);
            ops.push({ op: 'write', path: A(`${to}.meta`), text: `${JSON.stringify({ id }, null, 2)}\n` });
          }
        }
      }
      const inside = recordsUnder(entry.path);
      for (const one of inside) ids.set(one.id, freshRecordId(one.list, one.id, [...ids.values()]));
      const remap = (value: unknown): unknown => {
        if (typeof value === 'string') return ids.get(value) ?? value;
        if (Array.isArray(value)) return value.map(remap);
        if (value && typeof value === 'object') {
          return Object.fromEntries(Object.entries(value).map(([key, inner]) => [key, remap(inner)]));
        }
        return value;
      };
      await step(`duplicate ${nameOf(entry.path)}`, {
        doc: () => {
          for (const one of inside) {
            const copy = remap(structuredClone(one.record)) as RuleRecord;
            copy.id = ids.get(one.id)!;
            copy.path = `${target}${String(one.record.path).slice(entry.path.length)}`;
            copy.label = one.record.label;
            (rules.list(one.list) as RuleRecord[]).push(copy);
          }
        },
        ops,
        undoOps: [{ op: 'delete', path: A(target) }],
      });
      return target;
    },

    /** Delete entries. Asked about beforehand, by the panel. */
    async remove(removing: readonly AssetEntry[]): Promise<void> {
      const ops: DraftOp[] = [];
      const undoOps: DraftOp[] = [];
      const gone: { list: string; id: string }[] = [];

      for (const entry of removing) {
        if (isJson(entry.type)) {
          const found = recordAt(entry.path);
          if (found) gone.push({ list: found.list, id: String(found.record.id) });
          continue;
        }
        // The server keeps what it deletes under this key, so undo is a restore
        // rather than the editor holding every byte it might have to put back.
        const stash = newStash();
        if (entry.dir) {
          for (const one of recordsUnder(entry.path)) gone.push({ list: one.list, id: one.id });
          ops.push({ op: 'delete', path: A(entry.path), stash });
          undoOps.unshift({ op: 'restore', path: A(entry.path), stash });
          continue;
        }
        ops.push({ op: 'delete', path: A(entry.path), stash }, { op: 'delete', path: A(`${entry.path}.meta`), stash });
        undoOps.unshift({ op: 'restore', path: A(entry.path), stash }, { op: 'restore', path: A(`${entry.path}.meta`), stash });
      }

      const unique = [...new Map(gone.map((one) => [`${one.list}:${one.id}`, one])).values()];
      await step(`delete ${removing.length} item${removing.length > 1 ? 's' : ''}`, {
        doc: unique.length
          ? () => {
              for (const one of unique) {
                const at = indexOf(one.list, one.id);
                if (at >= 0) (rules.list(one.list) as RuleRecord[]).splice(at, 1);
              }
            }
          : undefined,
        ops,
        undoOps,
      });
    },
  };

  /** Records under a folder that moved, told their new folder. Uncheckpointed. */
  function retarget(inside: { list: string; id: string; record: LibraryRecord }[], from: string, to: string) {
    for (const one of inside) {
      const at = indexOf(one.list, one.id);
      const was = String(one.record.path ?? '');
      if (at >= 0) rules.update(one.list, at, { path: `${to}${was.slice(from.length)}` }, false);
    }
  }

  function freshRecordId(list: string, stem: string, alsoTaken: string[] = []): string {
    const taken = new Set([...(rules.list(list) as LibraryRecord[]).map((r) => String(r.id)), ...alsoTaken]);
    const base = stem.replace(/\d+$/, '') || 'asset';
    for (let n = 2; ; n += 1) if (!taken.has(`${base}${n}`)) return `${base}${n}`;
  }
}

/** A texture or model moves with its sidecar. */
function moveFileOps(from: string, to: string, overwrite = false, stash?: string): DraftOp[] {
  const kept = stash ? { stash } : {};
  return [
    { op: 'move', from: A(from), to: A(to), overwrite, ...kept },
    { op: 'move', from: A(`${from}.meta`), to: A(`${to}.meta`), overwrite, ...kept },
  ];
}
