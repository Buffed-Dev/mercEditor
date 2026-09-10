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
 * The fields are the ones a PBR surface actually reads: a picture, a colour it
 * is multiplied by, how rough and how metallic it is, and what it gives off.
 * Not every knob Babylon has — the ones missing are the ones that need an
 * environment map to mean anything, and this game has none.
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

  bump: { kind: 'file', accept: 'texture', label: 'Normal map' },
  bumpStrength: { kind: 'range', label: 'Normal strength', min: 0, max: 4, step: 0.05, default: 1 },

  emissive: { kind: 'color', label: 'Glow colour', default: 0x000000 },
  emissiveStrength: { kind: 'range', label: 'Glow', min: 0, max: 4, step: 0.05, default: 0 },

  alpha: { kind: 'range', label: 'Opacity', min: 0, max: 1, step: 0.01, default: 1 },
  transparent: { kind: 'bool', label: 'Use texture alpha', default: false },
  backFaces: { kind: 'bool', label: 'Draw back faces', default: false },
  unlit: { kind: 'bool', label: 'Ignore lighting', default: false },
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
  color: number;
  uScale: number;
  vScale: number;
  uOffset: number;
  vOffset: number;
  roughness: number;
  metallic: number;
  bumpStrength: number;
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
) as Omit<Material, 'id' | 'label' | 'path' | 'texture' | 'bump'>;

export function defaultMaterial(id = 'material'): Material {
  return { id, label: id, path: '', texture: '', bump: '', ...DEFAULTS };
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
