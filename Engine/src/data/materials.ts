import { MATERIALS as GAME_MATERIALS } from '#game';

/**
 * A named surface: how a thing takes the light, kept apart from the thing.
 *
 * Blocks and objects each carry a texture and a tint of their own, which works
 * until two of them are meant to be the same stone — then the same four numbers
 * are typed twice and drift apart the first time one is tuned. A material is
 * those settings under one id, so "mossy stone" is a thing that exists once and
 * is pointed at.
 *
 * The fields are the ones a PBR surface actually reads: the maps it is made of,
 * a colour it is multiplied by, how rough and how metallic it is, and what it
 * gives off. Not every knob Babylon has — what is missing is parallax, which
 * needs tangent-correct UVs the block meshes do not promise, and clear-coat and
 * sheen, which are a lot of shader for a game drawn at this size.
 *
 * The maps used to stop at colour and normal, because there was no environment
 * for a metal to reflect and half of PBR is a description of what a surface
 * does to the light around it. There is one now — see render/environment.ts —
 * so the rest of them mean something.
 *
 * Tiling lives here rather than only on the texture asset because the same
 * picture is tiled differently by different surfaces: one file, a floor that
 * repeats it eight times and a crate that uses it once.
 */

export const MATERIAL_FIELDS = {
  label: { kind: 'text', label: 'Name' },

  texture: { kind: 'file', accept: 'texture', label: 'Colour map' },
  color: { kind: 'color', label: 'Tint', default: 0xffffff },
  // A tiling factor is a multiplier, and the useful ones are between a half and
  // about eight — a straight scale to 32 puts all of them in a fifth of it.
  uScale: { kind: 'range', label: 'Tile across', min: 0.1, max: 32, step: 0.1, default: 1, curve: 'exp' },
  vScale: { kind: 'range', label: 'Tile down', min: 0.1, max: 32, step: 0.1, default: 1, curve: 'exp' },
  uOffset: { kind: 'range', label: 'Shift across', min: -1, max: 1, step: 0.01, default: 0 },
  vOffset: { kind: 'range', label: 'Shift down', min: -1, max: 1, step: 0.01, default: 0 },

  roughness: { kind: 'range', label: 'Roughness', min: 0, max: 1, step: 0.01, default: 0.8 },
  metallic: { kind: 'range', label: 'Metallic', min: 0, max: 1, step: 0.01, default: 0 },
  // glTF packs occlusion, roughness and metalness into one picture's red, green
  // and blue. Given one, the two dials above stop being the answer and start
  // being a multiplier over it, which is what glTF means by them.
  orm: { kind: 'file', accept: 'texture', label: 'Rough/metal map' },

  bump: { kind: 'file', accept: 'texture', label: 'Normal map' },
  bumpStrength: { kind: 'range', label: 'Normal strength', min: 0, max: 4, step: 0.05, default: 1 },

  // Shadow in the creases, painted rather than computed. It only darkens what
  // the *environment* lights, which is why it was worth nothing until now.
  ambient: { kind: 'file', accept: 'texture', label: 'Occlusion map' },
  ambientStrength: { kind: 'range', label: 'Occlusion', min: 0, max: 1, step: 0.01, default: 1 },

  emissive: { kind: 'color', label: 'Glow colour', default: 0x000000 },
  emissiveMap: { kind: 'file', accept: 'texture', label: 'Glow map' },
  emissiveStrength: { kind: 'range', label: 'Glow', min: 0, max: 4, step: 0.05, default: 0 },

  alpha: { kind: 'range', label: 'Opacity', min: 0, max: 1, step: 0.01, default: 1 },
  // A picture of what is solid, for a fence or a leaf whose colour map has no
  // alpha of its own. With one, `transparent` below has nothing left to decide.
  opacityMap: { kind: 'file', accept: 'texture', label: 'Opacity map' },
  transparent: { kind: 'bool', label: 'Use texture alpha', default: false },
  backFaces: { kind: 'bool', label: 'Draw back faces', default: false },
  unlit: { kind: 'bool', label: 'Ignore lighting', default: false },

  // A material whose pictures are sprite sheets, played in step.
  //
  // One set of numbers for the whole material rather than a set per map: an
  // animated surface is animated *as a surface*, and a colour map on frame 3
  // over a normal map on frame 7 is not a thing anyone means. Sheets authored
  // for one material are cut the same way by definition.
  //
  // One column by one row is the whole picture, which is how a material that is
  // not a sheet says so without a switch to forget to set.
  sheetColumns: { kind: 'range', label: 'Sheet columns', min: 1, max: 32, step: 1, default: 1 },
  sheetRows: { kind: 'range', label: 'Sheet rows', min: 1, max: 32, step: 1, default: 1 },
  sheetFrames: { kind: 'range', label: 'Sheet frames', min: 0, max: 1024, step: 1, default: 0 },
  sheetFps: { kind: 'range', label: 'Sheet fps', min: 0.5, max: 60, step: 0.5, default: 12 },
} as const;

/** A surface, as the renderer and the editor both understand it. */
export type Material = {
  id: string;
  label: string;
  /**
   * The folder this record was found in, under `assets/`.
   *
   * Not a field anybody edits: it comes from where the file was, and every
   * file the record names is relative to it. Carried on the record because the
   * renderer needs it to turn a filename into a url, and stripped again on the
   * way out — a record that stated its own address could disagree with where
   * it actually was, and a folder rename would have to chase it.
   */
  path: string;

  texture: string;
  bump: string;
  orm: string;
  ambient: string;
  emissiveMap: string;
  opacityMap: string;
  color: number;
  uScale: number;
  vScale: number;
  uOffset: number;
  vOffset: number;
  roughness: number;
  metallic: number;
  bumpStrength: number;
  ambientStrength: number;
  sheetColumns: number;
  sheetRows: number;
  sheetFrames: number;
  sheetFps: number;
  emissive: number;
  emissiveStrength: number;
  alpha: number;
  transparent: boolean;
  backFaces: boolean;
  unlit: boolean;
};

/** A material as a rules file writes it. See `normalizeMaterial`. */
export type MaterialInput = Partial<Material>;

/** What the preview stands the material on. Shape says different things. */
export const MATERIAL_SHAPES = {
  cube: { label: 'Cube', hint: 'Flat faces at three angles: what tiling and metal do.' },
  sphere: { label: 'Sphere', hint: 'Every angle at once: what roughness and glow do.' },
  plane: { label: 'Plane', hint: 'One face, straight on: what the picture itself looks like.' },
};

/** Which preview body the editor shows a material on. */
export type MaterialShape = keyof typeof MATERIAL_SHAPES;

export const MATERIAL_SHAPE_KEYS = Object.keys(MATERIAL_SHAPES) as MaterialShape[];

// `flatMap` rather than `filter` then `map`: a filter does not tell the
// compiler that the fields which survive it are the ones carrying a default,
// so the map afterwards would be reaching for a property the union does not
// have. The `as` is for `fromEntries`, which forgets which keys it was handed
// -- the values themselves are still read from MATERIAL_FIELDS, so there is no
// second copy of the defaults to keep in step.
const DEFAULTS = Object.fromEntries(
  Object.entries(MATERIAL_FIELDS).flatMap(([key, field]) =>
    'default' in field ? [[key, field.default]] : [],
  ),
) as Omit<
  Material,
  'id' | 'label' | 'path' | 'texture' | 'bump' | 'orm' | 'ambient' | 'emissiveMap' | 'opacityMap'
>;

export function defaultMaterial(id = 'material'): Material {
  return {
    id,
    label: id,
    path: '',
    texture: '',
    bump: '',
    orm: '',
    ambient: '',
    emissiveMap: '',
    opacityMap: '',
    ...DEFAULTS,
  };
}

export function normalizeMaterial(material: MaterialInput = {}): Material {
  const full = defaultMaterial(material.id ?? 'material');
  const given = material as Record<string, unknown>;
  for (const key of Object.keys(full)) {
    if (given[key] !== undefined) (full as Record<string, unknown>)[key] = given[key];
  }
  full.label = material.label ?? full.id;
  return full;
}

export const MATERIALS: Material[] = ((GAME_MATERIALS as MaterialInput[]) ?? []).map(
  normalizeMaterial,
);

const BY_ID = new Map(MATERIALS.map((material) => [material.id, material]));

export const materialById = (id: string): Material | null => BY_ID.get(id) ?? null;
