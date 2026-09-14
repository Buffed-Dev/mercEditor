// Base — written by the in-game map editor.
// Safe to hand-edit. `height` is one character per cell: '.' at level 0,
// '1'-'9' above it. `terrain` is two characters per cell, keyed by
// `terrainKeys`, and '..' where there is no cell at all. Which edges are
// cliffs, which corners are bevelled and where one surface blends into another
// are all worked out from these two grids — none of it is stored here.
// Coordinates in the lists below are integer tile indices.

export const BASE = {
  id: 'base',
  name: 'Base',
  startZ: 1,
  stepHeight: 6,
  terrainRim: [
    { inset: 0.05, drop: 0 },
    { inset: 0.0389, drop: 0.0013 },
    { inset: 0.0283, drop: 0.005 },
    { inset: 0.0188, drop: 0.0109 },
    { inset: 0.0109, drop: 0.0188 },
    { inset: 0.005, drop: 0.0283 },
    { inset: 0.0013, drop: 0.0389 },
    { inset: 0, drop: 0.05 },
  ],
  terrainKeys: { 'gr': 'grass', 'sa': 'sand', 'gs': 'grassSand' },

  height: [
    '111111111111111111111111',
    '111111111111111111111111',
    '111111111111111111111111',
    '111111111111111111111111',
    '111111111111111111111111',
    '111111111111111111111111',
    '111111111111111111111111',
    '111111111111111111111111',
    '111111111111111111111111',
    '111111111111111111111111',
    '111111111111111111111111',
    '111111111111111111111111',
    '111111111111111111111111',
    '111111111111111111111111',
    '111111111111111111111111',
    '111111111111111111111111',
    '111111111111111111111111',
    '111111111111111111111111',
    '111111111111111111111111',
    '111111111111111111111111',
    '111111111111111111111111',
    '111111111111111111111111',
    '111111111111111111111111',
    '111111111111111111111111',
  ],

  terrain: [
    'sasasasasasasasasasasasasasasasasasasasasasasasa',
    'sasasasasasasasasasasasasasasasasasasasasasasasa',
    'sasasasasasasasasasasasasasasasasasasasasasasasa',
    'sasasagrgrgrgrgrgrgrgrgrgrgrgrgrgrgrgrgrgrsasasa',
    'sasasagrgrgrgrgrgrgrgrgrgrgrgrgrgrgrgrgrgrsasasa',
    'sasasagrgrgrgrgrgrgrgrgrgrgrgrgrgrgrgrgrgrsasasa',
    'sasasagrgrgrgrgrgrgrgrgrgrgrgrgrgrgrgrgrgrsasasa',
    'sasasagrgrgrgrgrgrgrgrgrgrgrgrgrgrgrgrgrgrsasasa',
    'sasasagrgrgrgrgrgrgrgrgrgrgrgrgrgrgrgrgrgrsasasa',
    'sasasagrgrgrgrgrgrgrgrgrgrgrgrgrgrgrgrgrgrsasasa',
    'sasasagrgrgrgrgrgrgrgrgrgrgrgrgrgrgrgrgrgrsasasa',
    'sasasagrgrgrgrgrgrgrgrgrgrgrgrgrgrgrgrgrgrsasasa',
    'sasasagrgrgrgrgrgrgrgrgrgrgrgrgrgrgrgrgrgrsasasa',
    'sasasagrgrgrgrgrgrgrgrgrgrgrgrgrgrgrgrgrgrsasasa',
    'sasasagrgrgrgrgrgrgrgrgrgrgrgrgrgrgrgrgrgrsasasa',
    'sasasagrgrgrgrgrgrgrgrgrgrgrgrgrgrgrgrgrgrsasasa',
    'sasasagrgrgrgrgrgrgrgrgrgrgrgrgrgrgrgrgrgrsasasa',
    'sasasagrgrgrgrgrgrgrgrgrgrgrgrgrgrgrgrgrgrsasasa',
    'sasasagrgrgrgrgrgrgrgrgrgrgrgrgrgrgrgrgrgrsasasa',
    'sasasagrgrgrgrgrgrgrgrgrgrgrgrgrgrgrgrgrgrsasasa',
    'sasasagrgrgrgrgrgrgrgrgrgrgrgrgrgrgrgrgrgrsasasa',
    'sasasasasasasasasasasasasasasasasasasasasasasasa',
    'sasasasasasasasasasasasasasasasasasasasasasasasa',
    'sasasasasasasasasasasasasasasasasasasasasasasasa',
  ],


  spawns: {},


  doors: [],

  env: {
    sky: 0x000000,
    wallColor: 0x212121,
    floorColor: 0x76c516,
    soilColor: 0x472400,
    lighting: true,
    ambientColor: 0xffffff,
    ambientIntensity: 0.4,
    exposure: 1,
    contrast: 1,
    toneMapping: true,
    ao: true,
    aoStrength: 1,
    fog: true,
    fogReach: 7,
    fogSmooth: 14.5,
    clouds: true,
    cloudShade: 0.2,
    cloudScale: 8,
    cloudSpeed: 3,
    cloudAngle: 0,
  },

  lights: [
    { type: 'directional', gx: 11, gy: 10, color: 0xffe5ad, intensity: 3, azimuth: 234, elevation: 46, castShadow: true, shadowDarkness: 0.7, shadowSoftness: 10 },
    { type: 'hemisphere', gx: 8, gy: 9, color: 0xff8800, groundColor: 0x6f9445, intensity: 0.5 },
  ],

  props: [],

  vfx: [],

  prefabs: [
    { gx: 6, gy: 9, id: 'grunt' },
    { gx: 11, gy: 13, id: 'vase' },
    { gx: 4, gy: 10, id: 'test' },
    { gx: 9, gy: 11, id: 'test' },
    { gx: 13, gy: 11, id: 'test' },
    { gx: 12, gy: 8, id: 'test' },
    { gx: 8, gy: 13, id: 'test' },
    { gx: 9, gy: 7, id: 'test' },
  ],

  chunks: [],
};
