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
};

/** Sensible starting values per type, so a freshly placed light is visible. */
const TYPE_OVERRIDES = {
  point: { intensity: 14, color: 0xffb46a },
  spot: { intensity: 30, height: 3.2, color: 0xffe9c4 },
  directional: { intensity: 2.3, color: 0xfff4dc },
  hemisphere: { intensity: 1.1, color: 0xcfe9ff, groundColor: 0x6f9445 },
};

export function defaultLight(type, gx, gy) {
  const spec = LIGHT_TYPES[type] ?? LIGHT_TYPES.point;
  const light = { type, gx, gy };
  for (const field of spec.fields) {
    light[field] = LIGHT_FIELDS[field].default;
  }
  return { ...light, ...TYPE_OVERRIDES[type] };
}

/** Fill in anything a hand-written map left out, so the map view sees no gaps. */
export function normalizeLight(def) {
  const type = LIGHT_TYPES[def.type] ? def.type : 'point';
  return { ...defaultLight(type, def.gx ?? 0, def.gy ?? 0), ...def, type };
}
