/**
 * Light sources a map can declare, described as data so that one definition
 * drives three things at once: what the map view creates, what the editor panel
 * offers, and what the serializer writes back to the map file. Adding a field
 * here makes it appear in the editor without touching the UI code.
 *
 * Positions are tile indices like every other map object; `height` is in world
 * units above the tile. Ambient fill still lives in `env`, because it belongs
 * to the map as a whole rather than to a place in it.
 */

export const LIGHT_FIELDS = {
  color: { kind: 'color', label: 'Colour', default: 0xffb46a },
  groundColor: { kind: 'color', label: 'Ground colour', default: 0x4a4030 },
  // Exponential: a lamp is about 3 and a sun is about 200, and on a straight
  // scale every lamp anyone would set sits inside the first two pixels of the
  // sweep. The curve gives the bottom of the range most of the travel without
  // taking the top of it away.
  intensity: { kind: 'number', label: 'Intensity', min: 0, max: 200, step: 0.5, default: 12, curve: 'exp' },
  height: { kind: 'number', label: 'Height', min: 0.1, max: 20, step: 0.1, default: 1.1 },
  distance: { kind: 'number', label: 'Range (tiles)', min: 0, max: 60, step: 0.5, default: 9, curve: 'exp' },
  decay: { kind: 'number', label: 'Decay', min: 0, max: 4, step: 0.1, default: 1.6 },
  angle: { kind: 'number', label: 'Cone angle (deg)', min: 5, max: 89, step: 1, default: 40 },
  penumbra: { kind: 'number', label: 'Edge softness', min: 0, max: 1, step: 0.05, default: 0.4 },
  azimuth: { kind: 'number', label: 'Compass (deg)', min: 0, max: 360, step: 1, default: 225 },
  elevation: { kind: 'number', label: 'Height angle (deg)', min: 5, max: 89, step: 1, default: 36 },
  castShadow: { kind: 'bool', label: 'Casts shadows', default: false },
  // How much light the shadow removes. Below 1 the shadow is only partial,
  // which is usually a lie you want when the ambient fill is low.
  shadowDarkness: { kind: 'number', label: 'Shadow darkness', min: 0, max: 1, step: 0.05, default: 1 },
  // Blur width in shadow-map texels. Small reads as a hard sunlit edge, large
  // as an overcast day.
  shadowSoftness: { kind: 'number', label: 'Shadow softness', min: 0, max: 12, step: 0.5, default: 3 },
} as const;

/**
 * What each field holds once it is on a light.
 *
 * Written out rather than derived from `LIGHT_FIELDS`, because `as const` makes
 * every default a literal type — `intensity` would come out as `12`, not
 * `number`, and no light could then be dimmed. Thirteen boring lines beat a
 * mapped type that has to be argued with.
 */
type LightValues = {
  color: number;
  groundColor: number;
  intensity: number;
  height: number;
  distance: number;
  decay: number;
  angle: number;
  penumbra: number;
  azimuth: number;
  elevation: number;
  castShadow: boolean;
  shadowDarkness: number;
  shadowSoftness: number;
};

export const LIGHT_TYPES = {
  point: {
    label: 'Point',
    hint: 'Glows in all directions from its tile. The workhorse for torches and lamps.',
    fields: ['color', 'intensity', 'height', 'distance', 'decay', 'castShadow', 'shadowDarkness', 'shadowSoftness'],
  },
  spot: {
    label: 'Spot',
    hint: 'A cone aimed straight down at its tile.',
    fields: ['color', 'intensity', 'height', 'distance', 'decay', 'angle', 'penumbra', 'castShadow', 'shadowDarkness', 'shadowSoftness'],
  },
  directional: {
    label: 'Sun',
    hint: 'Parallel light across the whole map. Its tile only sets what the shadow camera looks at.',
    fields: ['color', 'intensity', 'azimuth', 'elevation', 'castShadow', 'shadowDarkness', 'shadowSoftness'],
  },
  hemisphere: {
    label: 'Sky fill',
    hint: 'Sky colour above, bounce colour below, everywhere at once. Position is ignored.',
    fields: ['color', 'groundColor', 'intensity'],
  },
} as const;

/** Which kind of light. The four `LIGHT_TYPES` keys and nothing else. */
export type LightType = keyof typeof LIGHT_TYPES;

/**
 * A light as a map stores it.
 *
 * The value fields are optional because which ones exist is decided by `type` —
 * a sky fill has no cone angle, and a sun ignores its own position. Making them
 * all required would oblige every caller to invent numbers that the renderer
 * would then ignore.
 */
export type Light = { type: LightType; gx: number; gy: number } & Partial<LightValues>;

/**
 * A light as a map file writes it.
 *
 * `type` is a plain string for the reason every other Input type in this
 * folder has one: the file is hand-edited, and `normalizeLight` is the single
 * place that decides what an unrecognised kind becomes.
 */
export type LightInput = Partial<Omit<Light, 'type'>> & {
  type?: string;
  /** Whatever else a map file wrote on it, `group` included. */
  [key: string]: unknown;
};

export const isLightType = (value: unknown): value is LightType =>
  typeof value === 'string' && value in LIGHT_TYPES;

/** Sensible starting values per type, so a freshly placed light is visible. */
const TYPE_OVERRIDES: Record<LightType, Partial<LightValues>> = {
  point: { intensity: 14, color: 0xffb46a },
  spot: { intensity: 30, height: 3.2, color: 0xffe9c4 },
  directional: { intensity: 2.3, color: 0xfff4dc },
  hemisphere: { intensity: 1.1, color: 0xcfe9ff, groundColor: 0x6f9445 },
};

export function defaultLight(type: string, gx: number, gy: number): Light {
  // Resolved before it is stored, not just before it is read. The unchecked
  // `type` used to be written onto the light while the *fields* came from the
  // point fallback, so a bad type produced a light that disagreed with itself.
  const kind: LightType = isLightType(type) ? type : 'point';
  const light: Light = { type: kind, gx, gy };
  for (const field of LIGHT_TYPES[kind].fields) {
    (light as Record<string, unknown>)[field] = LIGHT_FIELDS[field].default;
  }
  return { ...light, ...TYPE_OVERRIDES[kind] };
}

/** Fill in anything a hand-written map left out, so the map view sees no gaps. */
export function normalizeLight(def: LightInput): Light {
  const type: LightType = isLightType(def.type) ? def.type : 'point';
  return { ...defaultLight(type, def.gx ?? 0, def.gy ?? 0), ...def, type };
}
