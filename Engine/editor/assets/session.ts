import { create } from 'zustand';
import { registerFiles } from '../../src/data/assets.ts';
import { get, post } from '../devServer.ts';
import type { DataDocument, RuleRecord } from '../dataDocument.ts';
import { serializeAllRules } from '../serializeData.ts';
import { say } from '../state/status.ts';
import {
  JSON_TYPES,
  LIST_OF,
  displayName,
  folderOf,
  recordFromFile,
  recordPath,
  recordText,
  type AssetEntry,
  type JsonType,
  type LibraryRecord,
  type Problem,
} from './model.ts';

/**
 * One game's asset library while the editor has it open: the tree as the
 * draft shows it, the queue every write goes through, and the autosaves.
 */

/** What GET /__draft/tree answers. Paths there are from the game folder. */
export type DraftTree = {
  entries: (AssetEntry & { path: string })[];
  records: { path: string; type: JsonType; record: LibraryRecord }[];
  errors: Problem[];
  pending: number;
};

/** One operation on the draft. Paths are from the game folder: `assets/…`, `maps/…`. */
export type DraftOp =
  | { op: 'mkdir'; path: string }
  | { op: 'write'; path: string; text: string }
  | { op: 'writeBinary'; path: string; data: string }
  | { op: 'move' | 'copy'; from: string; to: string; overwrite?: boolean; stash?: string }
  | { op: 'delete'; path: string; stash?: string }
  | { op: 'restore'; path: string; stash: string };

type TreeStore = {
  /** Everything under assets/, paths from assets/. */
  entries: AssetEntry[];
  errors: Problem[];
  /** How many unpublished changes there are. */
  pending: number;
  /** True while a write is queued or running. */
  saving: boolean;
  loaded: boolean;
};

export const useAssetTree = create<TreeStore>(() => ({
  entries: [],
  errors: [],
  pending: 0,
  saving: false,
  loaded: false,
}));

const stripAssets = (path: string) => (path.startsWith('assets/') ? path.slice('assets/'.length) : path);

/** Read the draft tree. */
export async function fetchTree(game: string): Promise<DraftTree> {
  return (await get('/__draft/tree', 'read the assets', { game })) as unknown as DraftTree;
}

/** Take a tree into the store and the file id table. */
export function takeTree(tree: DraftTree): void {
  const entries = tree.entries
    .filter((entry) => entry.path.startsWith('assets/'))
    .map((entry) => ({ ...entry, path: stripAssets(entry.path) }));
  const byId = new Map<string, string>();
  for (const entry of entries) if (entry.id) byId.set(entry.id, entry.path);
  registerFiles(byId);
  useAssetTree.setState({
    entries,
    errors: tree.errors.map((error) => ({ ...error, path: stripAssets(error.path) })),
    pending: tree.pending,
    loaded: true,
  });
}

/** The library lists a tree describes, ready for the rules document. */
export function listsFromTree(tree: DraftTree): Record<string, RuleRecord[]> {
  const lists: Record<string, RuleRecord[]> = { materials: [], terrains: [], vfx: [], prefabs: [], props: [], profiles: [] };
  const sorted = [...tree.records].sort((a, b) => a.path.localeCompare(b.path));
  for (const { path, type, record } of sorted) {
    lists[LIST_OF[type]]!.push(recordFromFile(stripAssets(path), type, record));
  }
  lists.props = propsFromEntries(tree.entries.map((entry) => ({ ...entry, path: stripAssets(entry.path) })));
  return lists;
}

/** A model is an object the engine can draw, named by its file id. */
export function propsFromEntries(entries: readonly AssetEntry[]): RuleRecord[] {
  return entries
    .filter((entry) => entry.type === 'model' && entry.id)
    .sort((a, b) => a.path.localeCompare(b.path))
    .map((entry) => ({
      id: entry.id!,
      label: displayName(entry),
      path: folderOf(entry.path),
      mesh: entry.id!,
    }));
}

// --- the write queue --------------------------------------------------------------

let queue: Promise<unknown> = Promise.resolve();
let inFlight = 0;

/** Run writes one after another, so an autosave never races a move. */
export function enqueue<T>(work: () => Promise<T>): Promise<T> {
  inFlight += 1;
  useAssetTree.setState({ saving: true });
  const next = queue.then(work, work);
  queue = next.catch(() => undefined).finally(() => {
    inFlight -= 1;
    if (!inFlight) useAssetTree.setState({ saving: false });
  });
  return next;
}

/** Apply operations to the draft, in order with every other write. */
export function draftOps(game: string, ops: DraftOp[], what = 'change the draft'): Promise<void> {
  if (!ops.length) return Promise.resolve();
  return enqueue(async () => {
    const body = await post('/__draft/ops', what, { game, ops });
    if (typeof body.pending === 'number') useAssetTree.setState({ pending: body.pending });
  });
}

/** Read the tree again and take it in, after the queue has settled. */
export function refreshTree(game: string, rules?: DataDocument | null): Promise<void> {
  return enqueue(async () => {
    const tree = await fetchTree(game);
    takeTree(tree);
    if (!rules) return;
    const props = propsFromEntries(useAssetTree.getState().entries);
    // Only when the models changed: every replace is a change the autosave hears.
    if (JSON.stringify(props) !== JSON.stringify(rules.list('props'))) rules.replaceList('props', props);
  });
}

// --- autosave -------------------------------------------------------------------

const DELAY = 450;

/**
 * Write the library records to the draft whenever the rules document changes.
 *
 * It compares each record's file path and text against what it last wrote,
 * so a rename is a write and a delete of the old name, a move likewise, and an
 * undo of either is simply the reverse. Nothing about which edit caused it is
 * needed here.
 */
export function autosaveLibrary(game: string, rules: DataDocument, afterWrite: () => void): () => void {
  const snapshot = () => {
    const out = new Map<string, { path: string; text: string }>();
    for (const type of JSON_TYPES) {
      for (const record of rules.list(LIST_OF[type]) as LibraryRecord[]) {
        out.set(`${type}:${String(record.id)}`, { path: `assets/${recordPath(type, record)}`, text: recordText(record) });
      }
    }
    return out;
  };

  let written = snapshot();
  let timer: ReturnType<typeof setTimeout> | undefined;

  const flush = async () => {
    const now = snapshot();
    const ops: DraftOp[] = [];
    const occupied = new Set([...now.values()].map((one) => one.path.toLowerCase()));
    for (const [key, was] of written) {
      const is = now.get(key);
      if ((!is || is.path !== was.path) && !occupied.has(was.path.toLowerCase())) {
        ops.push({ op: 'delete', path: was.path });
      }
    }
    for (const [key, is] of now) {
      const was = written.get(key);
      if (!was || was.path !== is.path || was.text !== is.text) ops.push({ op: 'write', path: is.path, text: is.text });
    }
    written = now;
    if (!ops.length) return;
    try {
      await draftOps(game, ops, 'save the draft');
      afterWrite();
    } catch (error) {
      say(`Draft not saved: ${(error as Error).message}`, 'error');
    }
  };

  const stop = rules.subscribe(() => {
    clearTimeout(timer);
    timer = setTimeout(() => void flush(), DELAY);
  });
  return () => {
    clearTimeout(timer);
    stop();
    void flush();
  };
}

/** Write the rules straight into rules/ whenever they change. Not drafted. */
export function autosaveRules(game: string, rules: DataDocument): () => void {
  const serialize = () => JSON.stringify(serializeAllRules(rules.data));
  let written = serialize();
  let timer: ReturnType<typeof setTimeout> | undefined;

  const flush = async () => {
    const now = serialize();
    if (now === written) return;
    written = now;
    try {
      await post('/__data', 'write the rules', { game, files: serializeAllRules(rules.data) });
    } catch (error) {
      say(`Rules not saved: ${(error as Error).message}`, 'error');
    }
  };

  const stop = rules.subscribe(() => {
    clearTimeout(timer);
    timer = setTimeout(() => void flush(), DELAY);
  });
  return () => {
    clearTimeout(timer);
    stop();
    void flush();
  };
}

/**
 * Write a map to the draft whenever its document changes.
 *
 * @param source the map's module text, asked for at the moment of writing.
 */
export function autosaveMap(
  game: string,
  doc: { subscribe(listener: () => void): () => void },
  map: () => { id: string; source: string } | null,
  afterWrite?: () => void,
): () => void {
  let written = map()?.source ?? '';
  let timer: ReturnType<typeof setTimeout> | undefined;

  const flush = async () => {
    const now = map();
    if (!now || now.source === written) return;
    written = now.source;
    try {
      await draftOps(game, [{ op: 'write', path: `maps/${now.id}.js`, text: now.source }], `save ${now.id}`);
      afterWrite?.();
    } catch (error) {
      say(`Map not saved: ${(error as Error).message}`, 'error');
    }
  };

  const stop = doc.subscribe(() => {
    clearTimeout(timer);
    timer = setTimeout(() => void flush(), DELAY);
  });
  return () => {
    clearTimeout(timer);
    stop();
    void flush();
  };
}

// --- publish ----------------------------------------------------------------------

export type PublishResult = { ok: true; wrote: number; deleted: number } | { ok: false; problems: Problem[] };

/** Push the draft into the game, once the queue is empty. */
export function publish(game: string, clientProblems: Problem[]): Promise<PublishResult> {
  return enqueue(async () => {
    if (clientProblems.length) return { ok: false as const, problems: clientProblems };
    const response = await fetch('/__publish', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ game }),
    });
    const body = (await response.json().catch(() => ({}))) as {
      problems?: Problem[];
      error?: string;
      wrote?: number;
      deleted?: number;
    };
    if (response.status === 409) {
      return { ok: false as const, problems: (body.problems ?? []).map((p) => ({ ...p, path: stripAssets(p.path) })) };
    }
    if (!response.ok) throw new Error(body.error ?? `Publish failed (${response.status})`);
    useAssetTree.setState({ pending: 0 });
    return { ok: true as const, wrote: body.wrote ?? 0, deleted: body.deleted ?? 0 };
  });
}
