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
  'prefab.json': 'prefabs',
};

export type LibraryRow = {
  path: string;
  /** The last segment: what the row is called. */
  name: string;
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

    if (entry.dir) {
      const here = at.get(path);
      if (!here) {
        rows.push({ row: 'folder', path, name });
        continue;
      }
      const missing = (byRecord.get(path) ?? []).filter((file) => !onDisk.has(file));
      rows.push({
        row: 'record',
        path,
        name,
        list: here.list,
        id: String(here.record.id ?? ''),
        index: here.index,
        label: String(here.record.label ?? here.record.id ?? name),
        missing,
      });
      continue;
    }

    if (broken.has(path)) {
      rows.push({ row: 'broken', path, name, message: broken.get(path) ?? '' });
      continue;
    }

    // The record file is not a row of its own: the folder holding it is already
    // the record, and showing both would be the same thing said twice.
    if (name in RECORD_FILES) continue;

    rows.push({ row: 'file', path, name, used: used.has(path), size: entry.size ?? 0 });
  }

  return rows;
}

const IMAGE = /\.(png|jpg|jpeg|webp)$/i;

/**
 * A picture to stand in for a row, as a path under `assets/`.
 *
 * Every one of these is a file already on disk, found by following what the
 * record itself names: a material's colour map, an effect's sheet, and for a
 * terrain the colour map of the material it wears. So a thumbnail is an `<img>`
 * the browser decodes and lazy-loads on its own.
 *
 * It is worth saying what this is *instead of*. The obvious build is an
 * offscreen Babylon stage rendering each record and reading the canvas back —
 * a queue, an observer, a cache, and one shared engine because a browser hands
 * out only so many. At the size these are drawn, sixteen pixels in a row, a
 * rendered material is its average colour and a rendered mesh is a smudge:
 * all of that machinery to arrive at what the texture already looks like. If
 * the browser ever grows a tile view with previews big enough to read, that is
 * when the engine earns its keep.
 *
 * A mesh is the one thing with no cheap picture. An object that names only a
 * `.glb` keeps its glyph, which is honest — there is nothing to show without
 * drawing it.
 */
export function thumbFor(
  row: LibraryRow,
  records: Records,
): { src: string } | { color: number } | null {
  if (row.row === 'file') return IMAGE.test(row.name) ? { src: row.path } : null;
  if (row.row !== 'record') return null;

  const record = (records[row.list] ?? [])[row.index];
  if (!record) return null;
  const here = String(record.path ?? '');

  /** A file this record names directly, if it is a picture. */
  const own = (key: string): string => {
    const named = record[key];
    return typeof named === 'string' && IMAGE.test(named) ? filePath(here, named) : '';
  };

  if (row.list === 'vfx') {
    const image = (record.sheet as { image?: unknown } | undefined)?.image;
    // Still inline as base64: a data URL is not a file, but it is a picture,
    // and the browser will draw it straight from the record.
    if (typeof image === 'string' && image.startsWith('data:')) return { src: image };
    return typeof image === 'string' && image ? { src: filePath(here, image) } : null;
  }

  const direct = own('texture');
  if (direct) return { src: direct };

  // A terrain has no picture of its own -- it wears materials -- and neither
  // does an object that names one. One hop through the material it names.
  const wears = String(record.material ?? record.top ?? '');
  if (wears) {
    const material = (records.materials ?? []).find((one) => one.id === wears);
    const named = material?.texture;
    if (material && typeof named === 'string' && IMAGE.test(named)) {
      return { src: filePath(String(material.path ?? ''), named) };
    }
  }

  // A material with no map is still a colour, which is the whole of what it
  // looks like.
  if (row.list === 'materials') return { color: Number(record.color ?? 0xffffff) };
  return null;
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
  prefabs: 'Prefabs',
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

/**
 * The rows directly inside a folder, and nothing deeper.
 *
 * One folder at a time rather than the whole tree indented: a library is a
 * place you are *in*, the way a file manager is, and forty rows of somebody
 * else's folders between you and the two you are working on is the thing an
 * expandable tree is always doing. `''` is the assets folder itself.
 */
export function rowsIn(rows: readonly LibraryRow[], folder: string): LibraryRow[] {
  const prefix = folder ? `${folder}/` : '';
  return rows.filter(
    (row) => row.path.startsWith(prefix) && !row.path.slice(prefix.length).includes('/'),
  );
}

/** The way back up, as one crumb per folder on the path. */
export function crumbs(folder: string): { name: string; path: string }[] {
  const parts = folder ? folder.split('/') : [];
  return [
    { name: 'Assets', path: '' },
    ...parts.map((name, at) => ({ name, path: parts.slice(0, at + 1).join('/') })),
  ];
}

/** Whether a row has anything under it, so a folder can offer to be opened. */
export function hasChildren(rows: readonly LibraryRow[], path: string): boolean {
  return rows.some((row) => row.path.startsWith(`${path}/`));
}
