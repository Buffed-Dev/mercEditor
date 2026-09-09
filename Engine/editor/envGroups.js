/**
 * The map's own look, in the order you tune it.
 *
 * The first group is what a map cannot do without — its colours — and the rest
 * are effects it may simply not want. Each of those is a switch and the
 * settings behind it: a map with no fog says so once, and a panel of four
 * headings is one you can take in at a glance where a wall of twenty fields is
 * not. Nothing under an unticked switch is drawn, and nothing under it runs.
 */
/**
 * @typedef {import('./fields/types.ts').FieldSpec} FieldSpec
 * @typedef {{key?: string, label?: string, fields: FieldSpec[]}} EnvGroup
 */

/** @type {EnvGroup[]} */
export const ENV_GROUPS = [
  {
    fields: [
      { key: 'sky', kind: 'color', label: 'Sky / fog' },
      { key: 'floorColor', kind: 'color', label: 'Floor' },
      { key: 'wallColor', kind: 'color', label: 'Wall' },
      { key: 'soilColor', kind: 'color', label: 'Soil' },
    ],
  },
  {
    key: 'lighting',
    label: 'Environment',
    fields: [
      { key: 'ambientColor', kind: 'color', label: 'Ambient' },
      { key: 'ambientIntensity', kind: 'range', label: 'Ambient level', min: 0, max: 10, step: 0.05 },
      { key: 'exposure', kind: 'range', label: 'Exposure', min: 0, max: 4, step: 0.05 },
      { key: 'contrast', kind: 'range', label: 'Contrast', min: 0, max: 4, step: 0.05 },
      { key: 'toneMapping', kind: 'bool', label: 'Tone mapping' },
    ],
  },
  {
    key: 'ao',
    label: 'Contact shade',
    fields: [{ key: 'aoStrength', kind: 'range', label: 'Strength', min: 0, max: 2, step: 0.05 }],
  },
  {
    key: 'fog',
    label: 'Fog',
    fields: [
      { key: 'fogReach', kind: 'range', label: 'Reach (tiles)', min: 0, max: 24, step: 0.5 },
      { key: 'fogSmooth', kind: 'range', label: 'Softness', min: 0, max: 24, step: 0.5 },
    ],
  },
  {
    key: 'clouds',
    label: 'Clouds',
    fields: [
      { key: 'cloudShade', kind: 'range', label: 'Shade', min: 0, max: 1, step: 0.05 },
      { key: 'cloudScale', kind: 'range', label: 'Size (tiles)', min: 2, max: 60, step: 1, curve: 'exp' },
      { key: 'cloudSpeed', kind: 'range', label: 'Speed', min: 0, max: 6, step: 0.1 },
      { key: 'cloudAngle', kind: 'range', label: 'Heading (deg)', min: 0, max: 360, step: 15 },
    ],
  },
];
