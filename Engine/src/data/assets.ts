import { ASSET_URLS as GAME_ASSET_URLS } from '#game';

/**
 * Where the bundler put each file, by its name.
 *
 * `#game` is a content folder outside the type checker, and this particular
 * export is built by `import.meta.glob`, which types as `any`. Naming the shape
 * once here is what stops that `any` spreading through every url lookup below.
 */
const ASSET_URLS = GAME_ASSET_URLS as Record<string, string> | undefined;
import { ASSETS as GAME_ASSETS } from '#game/rules/assets.js';

/**
 * The files a game brings with it: models, textures and sprite sheets.
 *
 * An asset is a record *about* a file, not the file itself. The bytes live in
 * `Games/<game>/assets/` as an ordinary .glb or .png that a modelling tool
 * wrote and a person can open again; this list says what each one is and how it
 * should be read — which way up the model stands, how a texture tiles, how a
 * sheet is cut into frames.
 *
 * That split is deliberate. The visual effects next door put their pictures
 * *inside* their rules file as base64, which works for a 32-pixel spark and
 * turned that file into a megabyte the moment anyone dropped a sprite sheet on
 * it. A model is bigger again, and a diff of one is worthless. So the editor
 * uploads the file and writes a path.
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

/**
 * Every setting any kind of asset can carry.
 *
 * One flat list rather than three, because an asset stores its settings beside
 * its id and `kind` decides which of them mean anything -- the same shape the
 * editor's field tables already have. Written out rather than derived from
 * ASSET_FIELDS for the reason given on `LightValues` in ./lights.ts.
 */
type AssetValues = {
  scale: number;
  rotX: number;
  rotY: number;
  rotZ: number;
  lift: number;
  uScale: number;
  vScale: number;
  uOffset: number;
  vOffset: number;
  transparent: boolean;
  columns: number;
  rows: number;
  frameFrom: number;
  frames: number;
  fps: number;
  loop: boolean;
};

export type Asset = {
  id: string;
  label: string;
  kind: AssetKind;
  file: string;
} & Partial<AssetValues>;

/** An asset as a rules file writes it. */
export type AssetInput = Partial<Omit<Asset, 'kind'>> & { kind?: string };

export const ASSET_KIND_KEYS = Object.keys(ASSET_KINDS) as AssetKind[];

/** Every extension any kind will take, for the upload check on both sides. */
// Widened to plain strings: this list exists to be tested against the
// extension of a file somebody picked, which is any string at all.
export const ASSET_EXTENSIONS: string[] = [
  ...new Set(ASSET_KIND_KEYS.flatMap((kind) => ASSET_KINDS[kind].extensions)),
];

/**
 * Fields per kind, in the shape the editor's `fields.js` reads. The common
 * three — id, label, file — are not here: they are on every asset and the panel
 * draws them itself.
 */
export const ASSET_FIELDS = {
  mesh: {
    scale: { kind: 'range', label: 'Scale', min: 0.01, max: 20, step: 0.01, default: 1, curve: 'exp' },
    rotX: { kind: 'range', label: 'Turn X (deg)', min: -180, max: 180, step: 5, default: 0 },
    rotY: { kind: 'range', label: 'Turn Y (deg)', min: -180, max: 180, step: 5, default: 0 },
    rotZ: { kind: 'range', label: 'Turn Z (deg)', min: -180, max: 180, step: 5, default: 0 },
    lift: { kind: 'range', label: 'Lift', min: -4, max: 4, step: 0.05, default: 0 },
  },
  texture: {
    uScale: { kind: 'range', label: 'Tile across', min: 0.1, max: 32, step: 0.1, default: 1 },
    vScale: { kind: 'range', label: 'Tile down', min: 0.1, max: 32, step: 0.1, default: 1 },
    uOffset: { kind: 'range', label: 'Shift across', min: -1, max: 1, step: 0.01, default: 0 },
    vOffset: { kind: 'range', label: 'Shift down', min: -1, max: 1, step: 0.01, default: 0 },
    transparent: { kind: 'bool', label: 'Has transparency', default: false },
  },
  sheet: {
    columns: { kind: 'range', label: 'Columns', min: 1, max: 32, step: 1, default: 1 },
    rows: { kind: 'range', label: 'Rows', min: 1, max: 32, step: 1, default: 1 },
    frameFrom: { kind: 'range', label: 'First frame', min: 0, max: 1023, step: 1, default: 0 },
    frames: { kind: 'range', label: 'Frames', min: 0, max: 1024, step: 1, default: 0 },
    fps: { kind: 'range', label: 'Frames / sec', min: 0.5, max: 60, step: 0.5, default: 12 },
    loop: { kind: 'bool', label: 'Loop', default: true },
  },
} as const;

/** The settings table for one kind, as a plain lookup. */
const fieldsOf = (kind: AssetKind): Record<string, { default: unknown }> =>
  ASSET_FIELDS[kind];

/** The field names a kind carries, for a panel that draws whatever is there. */
export const assetKeys = (asset?: AssetInput): string[] =>
  isAssetKind(asset?.kind) ? Object.keys(fieldsOf(asset.kind)) : [];

const KIND_DEFAULTS = Object.fromEntries(
  ASSET_KIND_KEYS.map((kind) => [
    kind,
    Object.fromEntries(Object.entries(fieldsOf(kind)).map(([key, f]) => [key, f.default])),
  ]),
  // `fromEntries` forgets its keys; the values are still read from ASSET_FIELDS.
) as Record<AssetKind, Partial<AssetValues>>;

/** The kind a filename implies, so an upload does not have to be told twice. */
export function kindOfFile(name = ''): AssetKind {
  const ext = name.split('.').pop()?.toLowerCase() ?? '';
  return (ASSET_KINDS.mesh.extensions as readonly string[]).includes(ext) ? 'mesh' : 'texture';
}

export function defaultAsset(id = 'asset', kind: AssetKind = 'mesh', file = ''): Asset {
  return { id, label: id, kind, file, ...KIND_DEFAULTS[kind] };
}

/**
 * An asset read back from a file, with everything it left out filled in.
 *
 * Only the current kind's fields are kept. An asset that was a texture and is
 * now a sheet has no use for a tiling factor, and carrying the old kind's
 * settings around would put them in the file and in the diff for ever.
 */
export function normalizeAsset(asset: AssetInput = {}): Asset {
  const kind: AssetKind = isAssetKind(asset.kind) ? asset.kind : 'mesh';
  const given = asset as Record<string, unknown>;
  return {
    id: asset.id ?? 'asset',
    label: asset.label ?? asset.id ?? 'asset',
    kind,
    file: asset.file ?? '',
    ...(Object.fromEntries(
      Object.entries(fieldsOf(kind)).map(([key, f]) => [key, given[key] ?? f.default]),
    ) as Partial<AssetValues>),
  };
}

/**
 * How many frames a sheet plays and where it starts, clamped to what the grid
 * actually holds — the same rule the visual effects use, because a clip that
 * runs off the end of its own sheet is not something anyone means.
 */
export function assetFrames(sheet?: Partial<AssetValues> | null): {
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

export const ASSETS: Asset[] = ((GAME_ASSETS as AssetInput[]) ?? []).map(normalizeAsset);

const BY_ID = new Map(ASSETS.map((asset) => [asset.id, asset]));

export const assetById = (id: string): Asset | null => BY_ID.get(id) ?? null;

/**
 * Where an asset's file can actually be fetched from.
 *
 * Through the manifest rather than by pasting the path together, because a
 * build renames every file it emits: `rock.glb` comes out with a hash in it,
 * and only the bundler knows what. Naming a game falls back to the path the dev
 * server serves it at, which is what the editor needs — it is one tool over
 * however many game folders there are, and only one of them is `#game`.
 */
/**
 * The manifest again, keyed by lowercased name, for the files whose case does
 * not match what the record remembers.
 *
 * Windows will not rename `Block-side.glb` to `block-side.glb`: dropping the
 * second one in the folder overwrites the first and keeps the first's name. The
 * editor never notices — it pastes the path together and the dev server hands
 * the file back whatever the case — but a published game looks the name up in
 * here by exact string and finds nothing, so the block comes up as a plain box
 * and only in the game. Silent, and only on one platform.
 *
 * Names that differ only in case are left out: two files that a
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
 * How many times the editor has written over each file, by name.
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

export function assetUrl(asset: AssetInput | null | undefined, game = ''): string {
  if (!asset?.file) return '';
  const built = ASSET_URLS?.[asset.file] ?? URLS_BY_LOWER.get(asset.file.toLowerCase()) ?? null;
  if (built && !game) return built;
  if (!game) return built ?? '';
  const rewritten = rewrites.get(asset.file);
  return `/Games/${game}/assets/${asset.file}${rewritten ? `?v=${rewritten}` : ''}`;
}
