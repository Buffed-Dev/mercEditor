import { filePath } from '../../src/data/assets.ts';
import { LIBRARY_KINDS, libraryFields, type LibraryKind } from './library.ts';

/**
 * The assets folder as one list of rows: what is on disk, merged with what the
 * document says about it.
 *
 * Neither half can answer on its own. The disk knows a file is there but not
 * whether anything wants it; the document knows a material names
 * `diffuse.png` but not whether that file exists. The interesting states are
 * exactly the disagreements — a file nothing has claimed, a record naming a
 * file that is gone — so the merge is the point rather than a detail of it.
 *
 * Kept out of the component because it is the only part with an argument in it.
 * The panel draws rows.
 */

/** What the dev server's GET /__library hands back. */
export type LibraryScan = {
  tree: { path: string; dir?: boolean; link?: boolean; size?: number }[];
  records: { path: string; kind: string }[];
  errors: { path: string; message: string }[];
};

/** Which file holds a record of each kind. Mirrors LIBRARY_FILES in serializeData. */
const RECORD_FILES: Record<string, LibraryKind> = {
  'material.json': 'materials',
  'object.json': 'props',
  'terrain.json': 'terrains',
  'effect.json': 'vfx',
};

export type LibraryRow = {
  path: string;
  /** The last segment: what the row is called. */
  name: string;
  /** How many folders deep, for the indent. */
  depth: number;
} & (
  | { row: 'folder' }
  /** A folder holding a record file: the folder *is* the material. */
  | {
      row: 'record';
      list: LibraryKind;
      id: string;
      index: number;
      label: string;
      /** Files this record names that are not there. */
      missing: string[];
    }
  /** A file. `used` is false for one no record has claimed. */
  | { row: 'file'; used: boolean; size: number }
  /** A record file that would not parse. */
  | { row: 'broken'; message: string }
);

/** The records the document holds, by the folder each lives in. */
type Records = Partial<Record<LibraryKind, Record<string, unknown>[]>>;

const nameOf = (path: string) => path.slice(path.lastIndexOf('/') + 1);
const depthOf = (path: string) => path.split('/').length - 1;

/**
 * Every file the records name, as paths under assets/.
 *
 * Read off the field tables rather than a list kept here, so a record that
 * grows another picture slot is a line in its own field table and nothing else.
 */
function claimed(records: Records): { paths: Set<string>; byRecord: Map<string, string[]> } {
  const paths = new Set<string>();
  const byRecord = new Map<string, string[]>();
  for (const { id: list } of LIBRARY_KINDS) {
    const fields = libraryFields(list).filter((field) => field.kind === 'file');
    if (!fields.length) continue;
    for (const record of records[list] ?? []) {
      const here: string[] = [];
      for (const field of fields) {
        const named = record[field.key];
        if (typeof named !== 'string' || !named) continue;
        const path = filePath(String(record.path ?? ''), named);
        paths.add(path);
        here.push(path);
      }
      byRecord.set(String(record.path ?? ''), here);
    }
  }

  // An effect names its pictures inside `particle` and `sheet` rather than in a
  // field of its own, because it is built out of four tables the effect editor
  // gathers itself -- so there is no `file` field here to find them by. Spelled
  // out, or the sheet an effect plays reads as a file nothing wants.
  for (const record of records.vfx ?? []) {
    const here = byRecord.get(String(record.path ?? '')) ?? [];
    for (const half of ['particle', 'sheet']) {
      const image = (record[half] as { image?: unknown } | undefined)?.image;
      // A picture still held inline as a data URL is not a file on disk.
      if (typeof image !== 'string' || !image || image.startsWith('data:')) continue;
      const path = filePath(String(record.path ?? ''), image);
      paths.add(path);
      here.push(path);
    }
    byRecord.set(String(record.path ?? ''), here);
  }

  return { paths, byRecord };
}

/**
 * The tree, as rows in the order they are drawn.
 *
 * The document is the authority on records rather than the scan, because the
 * document is what has your unsaved edits in it — a material you have just
 * renamed should read the new name before you save, and a record you have just
 * added should appear at all.
 */
export function libraryRows(scan: LibraryScan | null, records: Records): LibraryRow[] {
  if (!scan) return [];

  const onDisk = new Set(scan.tree.filter((entry) => !entry.dir).map((entry) => entry.path));
  const { paths: used, byRecord } = claimed(records);
  const broken = new Map(scan.errors.map((error) => [error.path, error.message]));

  /** folder -> the record living in it, from the document. */
  const at = new Map<string, { list: LibraryKind; index: number; record: Record<string, unknown> }>();
  for (const { id: list } of LIBRARY_KINDS) {
    (records[list] ?? []).forEach((record, index) => {
      const path = String(record.path ?? '');
      if (path) at.set(path, { list, index, record });
    });
  }

  const rows: LibraryRow[] = [];
  for (const entry of scan.tree) {
    const { path } = entry;
    const name = nameOf(path);
    const depth = depthOf(path);

    if (entry.dir) {
      const here = at.get(path);
      if (!here) {
        rows.push({ row: 'folder', path, name, depth });
        continue;
      }
      const missing = (byRecord.get(path) ?? []).filter((file) => !onDisk.has(file));
      rows.push({
        row: 'record',
        path,
        name,
        depth,
        list: here.list,
        id: String(here.record.id ?? ''),
        index: here.index,
        label: String(here.record.label ?? here.record.id ?? name),
        missing,
      });
      continue;
    }

    if (broken.has(path)) {
      rows.push({ row: 'broken', path, name, depth, message: broken.get(path) ?? '' });
      continue;
    }

    // The record file is not a row of its own: the folder holding it is already
    // the record, and showing both would be the same thing said twice.
    if (name in RECORD_FILES) continue;

    rows.push({ row: 'file', path, name, depth, used: used.has(path), size: entry.size ?? 0 });
  }

  return rows;
}

/** Which folder a new record of this kind belongs under, for an Import. */
export function kindOfFolder(path: string): LibraryKind | null {
  const top = path.split('/')[0];
  const found = LIBRARY_KINDS.find((kind) => TOP[kind.id] === top);
  return found?.id ?? null;
}

const TOP: Record<string, string> = {
  materials: 'Materials',
  props: 'Objects',
  terrains: 'Terrain',
  vfx: 'Effects',
};

/**
 * The rows left when only some kinds are wanted, with the folders above them.
 *
 * An ancestor is kept because a match you cannot see the path to is a match you
 * cannot find. A folder that leads nowhere is dropped — which is what makes the
 * filter feel like a filter rather than a highlight.
 */
export function filterRows(
  rows: readonly LibraryRow[],
  wanted: ReadonlySet<string>,
): LibraryRow[] {
  if (!wanted.size) return [...rows];

  const keep = new Set<string>();
  for (const row of rows) {
    const matches =
      row.row === 'record' ? wanted.has(row.list) : row.row === 'file' ? wanted.has('files') : false;
    if (!matches) continue;
    keep.add(row.path);
    // Every folder on the way down to it, so the match has a path you can see.
    const parts = row.path.split('/');
    for (let i = 1; i < parts.length; i += 1) keep.add(parts.slice(0, i).join('/'));
  }
  return rows.filter((row) => keep.has(row.path));
}

/** The rows that are not hidden inside a collapsed folder. */
export function visibleRows(
  rows: readonly LibraryRow[],
  collapsed: ReadonlySet<string>,
): LibraryRow[] {
  if (!collapsed.size) return [...rows];
  return rows.filter((row) =>
    ![...collapsed].some((folder) => row.path.startsWith(`${folder}/`)),
  );
}

/** Whether a row has anything under it, so a folder can show a twisty. */
export function hasChildren(rows: readonly LibraryRow[], path: string): boolean {
  return rows.some((row) => row.path.startsWith(`${path}/`));
}
