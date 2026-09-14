import { filePath } from '../../src/data/assets.ts';
import { kindOfRecord, LIBRARY_FILE_ONLY, recordFile } from '../serializeData.ts';
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

export type LibraryRow = {
  path: string;
  /** The last segment: what the row is called. */
  name: string;
} & (
  /**
   * `holds` names the record whose folder this is, if there is one, and
   * `label` is what that record calls itself — the folder was named once, when
   * the record was made, and renaming the record does not move it. The card
   * reads the record's name so a rename shows up where you did it.
   */
  | {
      row: 'folder';
      holds: { list: LibraryKind; index: number } | null;
      label?: string;
    }
  /** The record file itself: `Grass/grass.material.json`. */
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
  // Keyed by the record's own file rather than its folder: a folder may hold
  // several records now, and two of them sharing one entry here would have
  // each reading the other's missing files.
  const fileOf = (list: LibraryKind, record: Record<string, unknown>) =>
    `${String(record.path ?? '')}/${recordFile(list, record)}`;
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
      byRecord.set(fileOf(list, record), here);
    }
  }

  // An effect names its pictures inside `particle` and `sheet` rather than in a
  // field of its own, because it is built out of four tables the effect editor
  // gathers itself -- so there is no `file` field here to find them by. Spelled
  // out, or the sheet an effect plays reads as a file nothing wants.
  for (const record of records.vfx ?? []) {
    const here = byRecord.get(fileOf('vfx', record)) ?? [];
    for (const half of ['particle', 'sheet']) {
      const image = (record[half] as { image?: unknown } | undefined)?.image;
      // A picture still held inline as a data URL is not a file on disk.
      if (typeof image !== 'string' || !image || image.startsWith('data:')) continue;
      const path = filePath(String(record.path ?? ''), image);
      paths.add(path);
      here.push(path);
    }
    byRecord.set(fileOf('vfx', record), here);
  }

  return { paths, byRecord };
}

/**
 * The folder, as rows in the order they are drawn.
 *
 * The document is the authority on records rather than the scan, because the
 * document is what has your unsaved edits in it — a material you have just
 * renamed should read the new name before you save, and a record you have just
 * added should appear at all.
 *
 * A folder and the record inside it are two rows, not one. They were one for a
 * while — the folder *is* the material — and that reads well right up to the
 * moment you want the textures beside it, which is a folder you can open and
 * therefore a folder that has to be a folder. What survives of the idea is
 * `holds`: a folder wearing its record's picture and its record's name.
 */
export function libraryRows(scan: LibraryScan | null, records: Records): LibraryRow[] {
  if (!scan) return [];

  const onDisk = new Set(scan.tree.filter((entry) => !entry.dir).map((entry) => entry.path));
  const folders = new Set(scan.tree.filter((entry) => entry.dir).map((entry) => entry.path));
  const { paths: used, byRecord } = claimed(records);
  const broken = new Map(scan.errors.map((error) => [error.path, error.message]));

  type Held = { list: LibraryKind; index: number; record: Record<string, unknown> };

  /**
   * file -> the record it holds, and folder -> the record that *is* it.
   *
   * Two maps because a folder no longer answers for a record: prefabs live
   * loose in one folder, several to a folder, so the file is what identifies
   * a record and the folder is only somewhere you keep them.
   */
  const at = new Map<string, Held>();
  const owns = new Map<string, Held>();
  for (const { id: list } of LIBRARY_KINDS) {
    (records[list] ?? []).forEach((record, index) => {
      const folder = String(record.path ?? '');
      if (!folder) return;
      at.set(`${folder}/${recordFile(list, record)}`, { list, index, record });
      if (!LIBRARY_FILE_ONLY.has(list)) owns.set(folder, { list, index, record });
    });
  }

  /** One record's row, wherever its file is or is about to be. */
  const rowFor = (path: string, here: Held): LibraryRow => ({
    row: 'record',
    path,
    name: nameOf(path),
    list: here.list,
    id: String(here.record.id ?? ''),
    index: here.index,
    label: String(here.record.label ?? here.record.id ?? nameOf(path)),
    missing: (byRecord.get(path) ?? []).filter((file) => !onDisk.has(file)),
  });

  const rows: LibraryRow[] = [];
  const written = new Set<string>();

  for (const entry of scan.tree) {
    const { path } = entry;
    const name = nameOf(path);

    if (entry.dir) {
      const here = owns.get(path);
      rows.push({
        row: 'folder',
        path,
        name,
        holds: here ? { list: here.list, index: here.index } : null,
        label: here ? String(here.record.label ?? here.record.id ?? name) : undefined,
      });
      continue;
    }

    if (broken.has(path)) {
      rows.push({ row: 'broken', path, name, message: broken.get(path) ?? '' });
      continue;
    }

    // A record file is a record row, named by the document rather than by the
    // filename -- so a rename reads right before it is saved, at which point
    // the file itself catches up.
    const here = kindOfRecord(name) ? at.get(path) : undefined;
    if (here) {
      written.add(path);
      rows.push(rowFor(path, here));
      continue;
    }
    // A record file the document has no record for: it belongs to a kind the
    // library does not load, or the document dropped it and has not saved.
    if (kindOfRecord(name)) continue;

    rows.push({ row: 'file', path, name, used: used.has(path), size: entry.size ?? 0 });
  }

  // A record just added, or one whose name has changed: its file is not on
  // disk under that name yet. Shown where it is going to be written.
  for (const [file, here] of at) {
    if (written.has(file)) continue;
    const folder = file.slice(0, file.lastIndexOf('/'));
    // And its folder is not there either, for one just added. The library is
    // browsed a folder at a time, so without this row the record file sits one
    // level down from anywhere you can stand and the new record is invisible
    // until a save puts its folder on disk.
    if (folder && !folders.has(folder)) {
      folders.add(folder);
      rows.push({
        row: 'folder',
        path: folder,
        name: nameOf(folder),
        holds: owns.has(folder) ? { list: here.list, index: here.index } : null,
        label: owns.has(folder)
          ? String(here.record.label ?? here.record.id ?? nameOf(folder))
          : undefined,
      });
    }
    rows.push(rowFor(file, here));
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
 * A material is the exception, and says so by handing back the record instead
 * of a path: what a material looks like is what light does to it, which its
 * colour map cannot say — a rough stone and a wet metal made from one map are
 * the same swatch. That one is drawn, by `useMaterialThumb`, on a sphere.
 *
 * A mesh is the one thing with no picture either way. An object that names only
 * a `.glb` keeps its glyph, which is honest — there is nothing to show without
 * standing it up and lighting it.
 */
export function thumbFor(
  row: LibraryRow,
  records: Records,
): { src: string } | { color: number } | { material: Record<string, unknown> } | null {
  if (row.row === 'file') return IMAGE.test(row.name) ? { src: row.path } : null;
  // A folder shows what is inside it, which for a record folder is the record.
  const held = row.row === 'folder' ? row.holds : row.row === 'record' ? row : null;
  if (!held) return null;

  const record = (records[held.list] ?? [])[held.index];
  if (!record) return null;
  const here = String(record.path ?? '');

  // Drawn rather than looked up. See the note above.
  if (held.list === 'materials') return { material: record };

  /** A file this record names directly, if it is a picture. */
  const own = (key: string): string => {
    const named = record[key];
    return typeof named === 'string' && IMAGE.test(named) ? filePath(here, named) : '';
  };

  if (held.list === 'vfx') {
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

  return null;
}

/** Which folder a new record of this kind belongs under, for an Import. */
export function kindOfFolder(path: string): LibraryKind | null {
  const top = path.split('/')[0];
  const found = LIBRARY_KINDS.find((kind) => TOP[kind.id] === top);
  return found?.id ?? null;
}

/** The folder under `assets/` each kind is filed in. */
export const TOP: Record<LibraryKind, string> = {
  materials: 'Materials',
  props: 'Objects',
  terrains: 'Terrain',
  vfx: 'Effects',
  prefabs: 'Prefabs',
};

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
