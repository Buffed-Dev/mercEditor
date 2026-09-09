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
  terrainKeys: { 'gr': 'grass', 'sa': 'sand', 'te': 'terrain' },

  height: [
    '........................',
    '........................',
    '....11111111............',
    '...1111111111...........',
    '..112222211111..........',
    '..112222211111..........',
    '..112222221111..........',
    '..112222211111..........',
    '..112222211111..........',
    '..111111111111..........',
    '..111111111111..........',
    '..111.11111111..........',
    '...1111111111...........',
    '....11311111............',
    '........................',
    '........................',
    '..1111..................',
    '..55555555...........55.',
    '..555555555555555555588.',
    '..555555555555555555588.',
    '..555555555577755558888.',
    '..577777777777777888888.',
    '..577777777777777888888.',
    '........................',
  ],

  terrain: [
    '................................................',
    '................................................',
    '........grgrgrgrgrgrgrgr..............sasasa....',
    '......grgrgrgrgrgrgrgrgrgr..sasasasasasasasa....',
    '....grgrgrgrgrgrgrgrgrgrgrgrsasasasasasasasa....',
    '....grgrgrgrgrgrgrgrgrgrgrgrsasasasasa..........',
    '....grgrgrgrgrgrgrgrgrgrgrgrsasasasasa..........',
    '....grgrgrgrgrgrgrgrgrgrgrgrsasasasasa..........',
    '....grgrgrgrgrgrgrgrgrsasasasasasasasasasasasa..',
    '....grgrgrgrgrgrgrsasasasasasasasasasasasasasa..',
    '....grgrgrgrgrgrgrsasasasasasasasasasasasasasa..',
    '....grgrgr..grgrgrgrsasasasasasasasasasasasasa..',
    '....sasasasasasasasasasasasasasasasasasasasasa..',
    '....sasasasasasasasasasasasasasasasasasasasasa..',
    '....sasasasasasasasasasasasasasasasasasasasasa..',
    '....sasasasasasasasasasasasasasasasasasasasasa..',
    '....sasasasasasasasasasasasasasasasasasasasasa..',
    '..grgrgrgrgrsasagrgrgrgrgrgrgrgrsasagrgrgrsagrgr',
    '..grgrgrgrgrsasasasagrgrgrgrgrgrgrgrgrgrgrgrgrgr',
    '..grgrgrgrgrgrgrgrgrgrgrgrgrgrgrgrgrgrgrgrgrgrgr',
    '..grgrgrgrgrgrgrgrgrgrgrgrgrgrgrgrgrgrgrgrgrgrgr',
    '..grgrgrgrgrgrgrgrgrgrgrgrgrgrgrgrgrgrgrgrgrgrgr',
    '..grgrgrgrgrgrgrgrgrgrgrgrgrgrgrgrgrgrgrgrgrgrgr',
    '..grgrgrgrgrgrgrgrgrgrgrgrgrgr..grgrgrgrgrgrgrgr',
  ],


  spawns: {},

  walls: [],

  portals: [],

  monsters: [],

  doors: [],

  env: {
    sky: 0x5581aa,
    wallColor: 0x212121,
    floorColor: 0x76c516,
    soilColor: 0x472400,
    lighting: true,
    ambientColor: 0xffffff,
    ambientIntensity: 0.5,
    exposure: 1,
    contrast: 1,
    toneMapping: true,
    ao: true,
    aoStrength: 1,
    fog: false,
    fogReach: 4,
    fogSmooth: 10.5,
    clouds: true,
    cloudShade: 0.2,
    cloudScale: 8,
    cloudSpeed: 3,
    cloudAngle: 0,
  },

  lights: [
    { type: 'directional', gx: 11, gy: 10, color: 0xffe5ad, intensity: 3, azimuth: 309, elevation: 46, castShadow: true, shadowDarkness: 0.7, shadowSoftness: 10 },
    { type: 'hemisphere', gx: 8, gy: 9, color: 0xff8800, groundColor: 0x6f9445, intensity: 0.5 },
  ],

  torches: [],

  props: [],

  vfx: [],

  stations: [],

  chunks: [],
};
