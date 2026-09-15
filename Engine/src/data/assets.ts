import { ASSET_URLS as GAME_ASSET_URLS, FILE_IDS as GAME_FILE_IDS } from '#game';

/**
 * Where the bundler put each file, by its path under `assets/`.
 *
 * `#game` is a content folder outside the type checker, and this particular
 * export is built by `import.meta.glob`, which types as `any`. Naming the shape
 * once here is what stops that `any` spreading through every url lookup below.
 */
const ASSET_URLS = GAME_ASSET_URLS as Record<string, string> | undefined;

/**
 * The files a game brings with it: models, textures and sprite sheets.
 *
 * A file is not a record. It is bytes in `Games/<game>/assets/` that a
 * modelling tool wrote and a person can open again, and it is named by
 * whatever uses it — a material names its two pictures, an object names its
 * mesh — relative to that record's own folder.
 *
 * There used to be a record *about* each file as well, carrying a scale, a
 * tiling factor, a frame count. Every one of those settings already existed on
 * the thing that used the file: MATERIAL_FIELDS has the same four tiling
 * numbers, PROP_FIELDS the same scale and lift, the effect sheet the same six
 * frame fields. Two places to say one thing, and they drifted — thirty-three
 * files against fourteen records — which is what this layer's removal fixes.
 *
 * What is left here is the part that was never duplicated: what kind of file an
 * extension implies, how a sheet is cut into frames, and where a path can
 * actually be fetched from.
 */

/** What kinds of file the editor accepts, and what each is good for. */
export const ASSET_KINDS = {
  mesh: {
    label: 'Mesh',
    accept: '.glb,.gltf',
    extensions: ['glb', 'gltf'],
    blurb: `A model, as glTF. Everything about how it is built — its materials, its
      own UVs — came with it; what is here is only how it sits in a world whose
      tile is one unit across.`,
  },
  texture: {
    label: 'Texture',
    accept: 'image/*',
    extensions: ['png', 'jpg', 'jpeg', 'webp'],
    blurb: `A picture to lay over a mesh, through the UVs the mesh already has.
      Tiling and offset are for a surface that repeats — a floor, a wall — and are
      left at 1 and 0 for a texture painted for one particular model.`,
  },
  sheet: {
    label: 'Sprite sheet',
    accept: 'image/*',
    extensions: ['png', 'jpg', 'jpeg', 'webp'],
    blurb: `A grid of frames in one picture, played in order. Cells are counted
      left to right, top to bottom, from the top-left.`,
  },
} as const;

/** Which of the three things a file is. */
export type AssetKind = keyof typeof ASSET_KINDS;

export const isAssetKind = (value: unknown): value is AssetKind =>
  typeof value === 'string' && value in ASSET_KINDS;

export const ASSET_KIND_KEYS = Object.keys(ASSET_KINDS) as AssetKind[];

/** Every extension any kind will take, for the upload check on both sides. */
// Widened to plain strings: this list exists to be tested against the
// extension of a file somebody picked, which is any string at all.
export const ASSET_EXTENSIONS: string[] = [
  ...new Set(ASSET_KIND_KEYS.flatMap((kind) => ASSET_KINDS[kind].extensions)),
];

/** The kind a filename implies, so an upload does not have to be told twice. */
export function kindOfFile(name = ''): AssetKind {
  const ext = name.split('.').pop()?.toLowerCase() ?? '';
  return (ASSET_KINDS.mesh.extensions as readonly string[]).includes(ext) ? 'mesh' : 'texture';
}

/** Anything carrying the six numbers that cut a picture into frames. */
export type SheetLike = {
  columns?: number;
  rows?: number;
  frameFrom?: number;
  frames?: number;
  fps?: number;
  loop?: boolean;
};

/**
 * How many frames a sheet plays and where it starts, clamped to what the grid
 * actually holds — the same rule the visual effects use, because a clip that
 * runs off the end of its own sheet is not something anyone means.
 */
export function assetFrames(sheet?: SheetLike | null): {
  columns: number;
  rows: number;
  first: number;
  count: number;
} {
  const columns = Math.max(1, Math.round(sheet?.columns ?? 1));
  const rows = Math.max(1, Math.round(sheet?.rows ?? 1));
  const all = columns * rows;
  const first = Math.min(Math.max(0, Math.round(sheet?.frameFrom ?? 0)), all - 1);
  const asked = Math.round(sheet?.frames ?? 0);
  const left = all - first;
  return { columns, rows, first, count: asked > 0 ? Math.min(asked, left) : left };
}

/**
 * Where each file is, by the id its `.meta` sidecar gives it.
 *
 * The published game fills this from its own sidecars; the editor replaces it
 * with the draft's whenever it reads the draft tree.
 */
const FILE_PATHS = new Map<string, string>(
  Object.entries((GAME_FILE_IDS as Record<string, string> | undefined) ?? {}),
);

/** Replace the id → path table, for the editor reading a draft. */
export function registerFiles(byId: ReadonlyMap<string, string>): void {
  FILE_PATHS.clear();
  for (const [id, path] of byId) FILE_PATHS.set(id, path);
}

/** The path a file id stands for, or '' when no file has it. */
export const pathOfFile = (id: string | undefined): string => (id ? (FILE_PATHS.get(id) ?? '') : '');

/**
 * The file a record names, as a path from `assets/`.
 *
 * A record names its files relative to its own folder, which is what makes
 * moving or renaming that folder cost nothing: `Materials/Grass/` says
 * `Grass_base_color.png`, and it goes on saying it wherever the folder ends up.
 *
 * A leading slash means "from the assets root" instead, for the occasional file
 * two records in different folders genuinely share. Rare on purpose — it is the
 * one reference a folder move has to chase.
 */
export function filePath(from: string | undefined, named: string | undefined): string {
  if (!named) return '';
  // A file is named by the id in its `.meta` sidecar, so it can be moved or
  // renamed without anything that names it changing.
  const byId = FILE_PATHS.get(named);
  if (byId) return byId;
  if (named.startsWith('/')) return named.slice(1);
  return from ? `${from}/${named}` : named;
}

/**
 * The manifest again, keyed by lowercased path, for the files whose case does
 * not match what a record remembers.
 *
 * Windows will not rename `Block-side.glb` to `block-side.glb`: dropping the
 * second one in the folder overwrites the first and keeps the first's name. The
 * editor never notices — it pastes the path together and the dev server hands
 * the file back whatever the case — but a published game looks the name up in
 * here by exact string and finds nothing, so the block comes up as a plain box
 * and only in the game. Silent, and only on one platform.
 *
 * Paths that differ only in case are left out: two files that a
 * case-insensitive lookup could not tell apart are better answered with nothing
 * than with a guess between them.
 */
const URLS_BY_LOWER = (() => {
  const seen = new Map<string, string | null>();
  for (const [file, url] of Object.entries(ASSET_URLS ?? {})) {
    const key = file.toLowerCase();
    seen.set(key, seen.has(key) ? null : url);
  }
  return seen;
})();

/**
 * How many times the editor has written over each file, by path.
 *
 * A model, a texture and the material wearing one are all kept per scene and
 * keyed by the url they came from — which is what stops every brush stroke
 * reloading the map. It also means re-exporting a file over its own name
 * changes nothing on screen until the page is reloaded and the scene, and its
 * cache with it, is a new one.
 *
 * So the url carries a count. Writing the file moves it on, the caches see a
 * key they have never had, and the next map fetches the file again. Only the
 * editor: a published game's urls come from the build, and its files cannot
 * change under it.
 */
const rewrites = new Map<string, number>();

/** Note that a file has been written over, so the next look at it is a fetch. */
export function assetRewritten(file: string | undefined): void {
  if (file) rewrites.set(file, (rewrites.get(file) ?? 0) + 1);
}

/**
 * Where a file can actually be fetched from, given its path under `assets/`.
 *
 * Through the manifest rather than by pasting the path together, because a
 * build renames every file it emits: `rock.glb` comes out with a hash in it,
 * and only the bundler knows what. Naming a game falls back to the path the dev
 * server serves it at, which is what the editor needs — it is one tool over
 * however many game folders there are, and only one of them is `#game`.
 */
export function fileUrl(path: string | undefined, game = ''): string {
  if (!path) return '';
  const built = ASSET_URLS?.[path] ?? URLS_BY_LOWER.get(path.toLowerCase()) ?? null;
  if (built && !game) return built;
  if (!game) return built ?? '';
  const rewritten = rewrites.get(path);
  const segments = `assets/${path}`.split('/').map(encodeURIComponent).join('/');
  return `/__draft/file/${encodeURIComponent(game)}/${segments}${rewritten ? `?v=${rewritten}` : ''}`;
}
