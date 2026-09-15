import { MATERIAL_FIELDS } from '../../src/data/materials.ts';
import { PROFILE_FIELDS } from '../../src/data/profiles.ts';
import { TERRAIN_FIELDS } from '../../src/data/terrains.ts';

/**
 * The asset library's model: what an entry under `assets/` is, what it is
 * called, how it sorts, and what names what.
 *
 * No React and no requests in here, so all of it can be tested directly.
 */

/** A json asset type, as its file names it: `grass.material.json`. */
export type JsonType = 'material' | 'block' | 'prefab' | 'effect' | 'profile';

/** A plain file type, from its extension. */
export type FileType = 'texture' | 'model';

export type EntryType = 'folder' | JsonType | FileType | 'other';

/** One thing in the tree, as the dev server lists it. Paths are from `assets/`. */
export type AssetEntry = {
  path: string;
  dir: boolean;
  type: EntryType;
  /** A texture's or model's id, from its sidecar. */
  id?: string;
  size?: number;
  mtime?: number;
  draft?: boolean;
};

/** Which rules-document list each json type is kept in. */
export const LIST_OF: Record<JsonType, 'materials' | 'terrains' | 'prefabs' | 'vfx' | 'profiles'> = {
  material: 'materials',
  block: 'terrains',
  prefab: 'prefabs',
  effect: 'vfx',
  profile: 'profiles',
};

export const TYPE_OF_LIST: Record<string, JsonType> = {
  materials: 'material',
  terrains: 'block',
  prefabs: 'prefab',
  vfx: 'effect',
  profiles: 'profile',
};

export const JSON_TYPES = Object.keys(LIST_OF) as JsonType[];

export const TYPE_LABEL: Record<EntryType, string> = {
  folder: 'Folder',
  material: 'Material',
  block: 'Block',
  prefab: 'Prefab',
  effect: 'Effect',
  profile: 'Edge profile',
  texture: 'Texture',
  model: 'Model',
  other: 'File',
};

/** Extension → file type. Anything else is refused on import. */
export const EXTENSIONS: Record<string, FileType> = {
  png: 'texture',
  jpg: 'texture',
  jpeg: 'texture',
  webp: 'texture',
  glb: 'model',
  gltf: 'model',
};

export const ACCEPT = Object.keys(EXTENSIONS)
  .map((ext) => `.${ext}`)
  .join(',');

export const nameOf = (path: string) => path.slice(path.lastIndexOf('/') + 1);
export const folderOf = (path: string) => (path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '');
export const join = (folder: string, name: string) => (folder ? `${folder}/${name}` : name);

/** What a file name is, by its name alone. */
export function typeOfName(name: string): EntryType {
  const lower = name.toLowerCase();
  const parts = lower.split('.');
  if (parts.length >= 3 && parts.at(-1) === 'json' && (JSON_TYPES as string[]).includes(parts.at(-2)!)) {
    return parts.at(-2) as JsonType;
  }
  return EXTENSIONS[parts.at(-1) ?? ''] ?? 'other';
}

/** The type a picked file will be imported as, or null if it cannot be. */
export const fileTypeOf = (name: string): FileType | null => EXTENSIONS[name.split('.').pop()?.toLowerCase() ?? ''] ?? null;

/**
 * The name shown on a card, and edited by rename: a json asset without its
 * `.type.json`, a file without its extension, a folder as it is.
 */
export function displayName(entry: Pick<AssetEntry, 'path' | 'type'>): string {
  const name = nameOf(entry.path);
  if (entry.type === 'folder') return name;
  if ((JSON_TYPES as string[]).includes(entry.type)) return name.slice(0, -(`.${entry.type}.json`.length));
  const dot = name.lastIndexOf('.');
  return dot > 0 ? name.slice(0, dot) : name;
}

/** The file name a display name becomes, keeping what kind of entry it is. */
export function fileNameFor(entry: Pick<AssetEntry, 'path' | 'type'>, display: string): string {
  const clean = display.trim();
  if (entry.type === 'folder') return clean;
  if ((JSON_TYPES as string[]).includes(entry.type)) return `${clean}.${entry.type}.json`;
  const name = nameOf(entry.path);
  const dot = name.lastIndexOf('.');
  return dot > 0 ? `${clean}${name.slice(dot)}` : clean;
}

/** The same rule the dev server holds a segment to, checked before asking it. */
const SEGMENT = /^[A-Za-z0-9][A-Za-z0-9 _()+.,-]{0,79}$/;

/** Why a name will not do, or null. */
export function badName(display: string): string | null {
  const name = display.trim();
  if (!name) return 'A name cannot be empty';
  if (!SEGMENT.test(name)) return 'Use letters, digits, spaces, dashes and underscores, starting with a letter or digit';
  return null;
}

/** Folders first, then names A–Z, case-blind and number-aware. */
export function sortEntries<T extends Pick<AssetEntry, 'path' | 'dir'>>(entries: readonly T[]): T[] {
  return [...entries].sort((a, b) => {
    if (a.dir !== b.dir) return a.dir ? -1 : 1;
    return nameOf(a.path).localeCompare(nameOf(b.path), undefined, { numeric: true, sensitivity: 'base' });
  });
}

/** What is directly inside a folder, sorted. */
export function childrenOf<T extends Pick<AssetEntry, 'path' | 'dir'>>(entries: readonly T[], folder: string): T[] {
  return sortEntries(entries.filter((entry) => folderOf(entry.path) === folder));
}

/** `Assets / Terrain / Grass`, as folder paths to click. */
export function crumbs(folder: string): { name: string; path: string }[] {
  const out = [{ name: 'Assets', path: '' }];
  let at = '';
  for (const part of folder.split('/').filter(Boolean)) {
    at = join(at, part);
    out.push({ name: part, path: at });
  }
  return out;
}

/**
 * A free name for "keep both": `rock.glb` → `rock (1).glb`, and for a json
 * asset `grass.material.json` → `grass (1).material.json`.
 */
export function keepBothName(name: string, taken: (candidate: string) => boolean): string {
  const type = typeOfName(name);
  const suffix = (JSON_TYPES as string[]).includes(type)
    ? `.${type}.json`
    : name.lastIndexOf('.') > 0
      ? name.slice(name.lastIndexOf('.'))
      : '';
  const stem = suffix ? name.slice(0, -suffix.length) : name;
  for (let n = 1; ; n += 1) {
    const candidate = `${stem} (${n})${suffix}`;
    if (!taken(candidate)) return candidate;
  }
}

/** A fresh name in a folder for something new: `New Material`, `New Material 2`… */
export function freshName(base: string, taken: (display: string) => boolean): string {
  if (!taken(base)) return base;
  for (let n = 2; ; n += 1) if (!taken(`${base} ${n}`)) return `${base} ${n}`;
}

/** A file id: short, random, and a valid id everywhere ids are checked. */
export function newFileId(): string {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
  let id = 'f';
  for (let i = 0; i < 11; i += 1) id += chars[Math.floor(Math.random() * chars.length)];
  return id;
}

// --- records as files ---------------------------------------------------------

export type LibraryRecord = Record<string, unknown>;

/** Where a record's file is, from `assets/`. */
export const recordPath = (type: JsonType, record: LibraryRecord) =>
  join(String(record.path ?? ''), `${String(record.label ?? record.id ?? 'asset')}.${type}.json`);

/**
 * A record as its file's text. Its folder and its name are where the file is
 * and what it is called, so neither is written into it; empty lists are left
 * out, and put back by the normalizers on the way in.
 */
export function recordText(record: LibraryRecord): string {
  const { path: _path, label: _label, ...rest } = record;
  for (const [key, value] of Object.entries(rest)) {
    if (Array.isArray(value) && !value.length) delete rest[key];
  }
  return `${JSON.stringify(rest, null, 2)}\n`;
}

/** A record read from its file, told its folder and name. */
export function recordFromFile(path: string, type: JsonType, record: LibraryRecord): LibraryRecord {
  return { ...record, path: folderOf(path), label: displayName({ path, type }) };
}

// --- references -----------------------------------------------------------------

/** Every string anywhere inside a value. */
function strings(value: unknown, out: string[] = []): string[] {
  if (typeof value === 'string') out.push(value);
  else if (Array.isArray(value)) for (const one of value) strings(one, out);
  else if (value && typeof value === 'object') for (const one of Object.values(value)) strings(one, out);
  return out;
}

export type Lists = Partial<Record<'materials' | 'terrains' | 'prefabs' | 'vfx' | 'props' | 'profiles', readonly LibraryRecord[]>>;

export type User = { type: JsonType | 'map'; id: string; label: string };

/**
 * Which assets name an id: a material a block wears, a texture a material
 * shows, a model or effect a prefab places. Also the open maps, when given.
 */
export function usedBy(id: string, lists: Lists, maps: readonly { id: string; value: unknown }[] = []): User[] {
  if (!id) return [];
  const out: User[] = [];
  for (const type of JSON_TYPES) {
    for (const record of lists[LIST_OF[type]] ?? []) {
      if (record.id === id) continue;
      const { id: _id, label: _label, path: _path, ...rest } = record;
      if (strings(rest).includes(id)) out.push({ type, id: String(record.id), label: String(record.label ?? record.id) });
    }
  }
  for (const map of maps) {
    if (strings(map.value).includes(id)) out.push({ type: 'map', id: map.id, label: map.id });
  }
  return out;
}

export type Problem = { path: string; message: string };

const MATERIAL_KEYS = (fields: Record<string, { kind?: string }>) =>
  Object.entries(fields).filter(([, field]) => field.kind === 'material').map(([key]) => key);
const FILE_KEYS = (fields: Record<string, { kind?: string }>) =>
  Object.entries(fields).filter(([, field]) => field.kind === 'file').map(([key]) => key);

/**
 * What would stop a publish: an asset naming a material, file, model or effect
 * that is not there. Map problems are not listed; a map naming something
 * missing draws a placeholder in its place.
 */
export function validate(lists: Lists, fileIds: ReadonlySet<string>): Problem[] {
  const problems: Problem[] = [];
  const has = (list: keyof Lists) => new Set((lists[list] ?? []).map((one) => String(one.id)));
  const materials = has('materials');
  const effects = has('vfx');
  const props = has('props');
  const profiles = has('profiles');
  const missing = (record: LibraryRecord, type: JsonType, what: string, value: string) =>
    problems.push({ path: recordPath(type, record), message: `Names a ${what} that is not there (${value})` });

  const checkFile = (record: LibraryRecord, type: JsonType, value: unknown) => {
    if (typeof value === 'string' && value && !value.startsWith('data:') && !fileIds.has(value)) {
      missing(record, type, 'file', value);
    }
  };

  for (const record of lists.materials ?? []) {
    for (const key of FILE_KEYS(MATERIAL_FIELDS)) checkFile(record, 'material', record[key]);
  }
  for (const record of lists.terrains ?? []) {
    for (const key of MATERIAL_KEYS(TERRAIN_FIELDS)) {
      const value = record[key];
      if (typeof value === 'string' && value && !materials.has(value)) missing(record, 'block', 'material', value);
    }
    const profile = record.defaultSideProfile;
    if (typeof profile === 'string' && profile && !profiles.has(profile)) missing(record, 'block', 'edge profile', profile);
  }
  for (const record of lists.profiles ?? []) {
    for (const key of FILE_KEYS(PROFILE_FIELDS)) checkFile(record, 'profile', record[key]);
    for (const one of (record.transitions as { profile?: string; outerCorner?: string; innerCorner?: string }[] | undefined) ?? []) {
      if (one.profile && !profiles.has(one.profile)) missing(record, 'profile', 'edge profile', one.profile);
      checkFile(record, 'profile', one.outerCorner);
      checkFile(record, 'profile', one.innerCorner);
    }
  }
  for (const record of lists.prefabs ?? []) {
    for (const one of (record.props as { id?: string }[] | undefined) ?? []) {
      if (one.id && !props.has(one.id)) missing(record, 'prefab', 'model', one.id);
    }
    for (const one of (record.vfx as { id?: string }[] | undefined) ?? []) {
      if (one.id && !effects.has(one.id)) missing(record, 'prefab', 'effect', one.id);
    }
  }
  for (const record of lists.vfx ?? []) {
    const images = (value: unknown): void => {
      if (!value || typeof value !== 'object') return;
      for (const [key, inner] of Object.entries(value)) {
        if (key === 'image') checkFile(record, 'effect', inner);
        else images(inner);
      }
    };
    const { id: _id, label: _label, path: _path, ...rest } = record;
    images(rest);
  }
  return problems;
}
