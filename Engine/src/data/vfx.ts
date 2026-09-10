import { VFX as GAME_VFX } from '#game';

/**
 * Visual effects: a puff of particles, described as data.
 *
 * One definition, used wherever something should sparkle, burn or explode — a
 * shine on a chest is the same kind of thing as the flash an ability makes when
 * it lands, so both name an entry in this list rather than each carrying their
 * own bespoke code.
 *
 * An effect is two halves and a list of additions to each:
 *
 *   emitter   where particles come from, how many, and for how long
 *   particle  what one of them is and what it does with its life
 *
 * Each half has a handful of settings that every effect has, and a `modifiers`
 * list of the ones most effects do not want. That split is the whole shape of
 * this file. A flat table of forty fields is a form nobody can read and a
 * runtime that computes forty things whether or not they were asked for; a
 * short table plus a list keeps the panel to what an effect is actually doing,
 * and keeps the cost to it too.
 *
 * Adding a modifier kind here makes it appear in the editor's Add menu, be
 * saved, and be applied — no editor code, and one branch in the runtime.
 */

/** The longest side an imported sprite is shrunk to, in pixels. */
export const VFX_IMAGE_MAX = 128;

/**
 * What a swing is, where no ability has said otherwise — a map effect, or the
 * preview. Wide enough to read as a swing and no claim to be anything else.
 */
export const SLASH_FALLBACK = { aim: 0, arc: 120 };

// ---------------------------------------------------------------- curves

/**
 * How a value gets from its start to its end.
 *
 * Not a curve editor: five shapes cover what anyone reaches for, and each is a
 * sentence about the effect rather than a set of handles to drag. `bell` is the
 * odd one — it runs to the end value and back — which is what "fades in and out
 * again" needs and what a pair of numbers alone cannot say.
 */
export const VFX_CURVES = [
  ['linear', 'Even'],
  ['hold', 'Hold'],
  ['quick', 'Quick'],
  ['smooth', 'Smooth'],
  ['bell', 'There and back'],
] as const;

/** Where along the ramp a curve is at `t`, both in 0..1. */
export function curveAt(curve: string | undefined, t: number): number {
  const at = Math.min(1, Math.max(0, t));
  switch (curve) {
    // Stays near the start, then goes.
    case 'hold':
      return at * at * at;
    // Goes at once, then eases in to the end.
    case 'quick':
      return 1 - (1 - at) ** 3;
    case 'smooth':
      return at * at * (3 - 2 * at);
    // Out to the end value and back again.
    case 'bell':
      return 1 - Math.abs(at * 2 - 1);
    default:
      return at;
  }
}

// ---------------------------------------------------------------- emitter

/**
 * The shapes particles can be born from, and which of the geometry fields each
 * one actually uses — the same trick data/lights.ts plays with light types, so
 * a shape's own settings appear in the panel and nothing else does.
 *
 * These are Babylon's own emitters, named for what they look like rather than
 * for the class behind them. `disc` and `ring` are both the cylinder one,
 * flattened: filled to the middle, and only its rim.
 */
export const EMITTER_SHAPES = {
  point: {
    label: 'Point',
    hint: 'Everything from one spot. The spread decides which way it is thrown.',
    fields: [],
  },
  cone: {
    label: 'Cone',
    hint: 'The workhorse. Narrow it and it is a column; open it and it is a fountain.',
    fields: ['radius', 'spread'],
  },
  sphere: {
    label: 'Ball',
    hint: 'Thrown in every direction at once, which is what an explosion is.',
    fields: ['radius'],
  },
  hemisphere: {
    label: 'Dome',
    hint: 'A ball with its bottom half cut off, so nothing is thrown into the floor.',
    fields: ['radius'],
  },
  box: {
    label: 'Box',
    hint: 'Filled evenly through a rectangle. For rain, dust, and anything that fills a room.',
    fields: ['sizeX', 'sizeY', 'sizeZ', 'spread'],
  },
  cylinder: {
    label: 'Cylinder',
    hint: 'A standing tube, thrown outward from its middle.',
    fields: ['radius', 'height', 'spread'],
  },
  disc: {
    label: 'Disc',
    hint: 'A filled circle on the ground, thrown outward. A shockwave that fills in.',
    fields: ['radius', 'spread'],
  },
  ring: {
    label: 'Ring',
    hint: 'Only the rim of that circle, which is the shockwave itself.',
    fields: ['radius', 'spread'],
  },
} as const;

export const EMITTER_FIELDS = {
  shape: {
    kind: 'select',
    label: 'Shape',
    options: Object.entries(EMITTER_SHAPES).map(([id, spec]) => [id, spec.label]),
    default: 'cone',
  },
  radius: { kind: 'range', label: 'Radius (tiles)', min: 0, max: 8, step: 0.05, default: 0.2, curve: 'exp' },
  height: { kind: 'range', label: 'Height (tiles)', min: 0, max: 8, step: 0.05, default: 1 },
  sizeX: { kind: 'range', label: 'Width (tiles)', min: 0, max: 16, step: 0.1, default: 1 },
  sizeY: { kind: 'range', label: 'Depth (tiles)', min: 0, max: 16, step: 0.1, default: 1 },
  sizeZ: { kind: 'range', label: 'Tall (tiles)', min: 0, max: 16, step: 0.1, default: 1 },
  // How wide the throw is, measured off the shape's own idea of outward. 0 is a
  // column, 180 is anywhere at all.
  spread: { kind: 'range', label: 'Spread (deg)', min: 0, max: 180, step: 5, default: 40 },
  // How high above whatever it is standing on the whole thing sits.
  lift: { kind: 'range', label: 'Lift (tiles)', min: 0, max: 6, step: 0.05, default: 0.3 },
  /**
   * Continuous spends `count` every second for as long as it emits; burst
   * spends all of it at once. One number either way, because it is the same
   * question — how many — and only the spending differs.
   */
  mode: {
    kind: 'select',
    label: 'Emit',
    options: [
      ['continuous', 'Continuous'],
      ['burst', 'Burst'],
    ],
    default: 'continuous',
  },
  count: { kind: 'range', label: 'Count', min: 0, max: 500, step: 5, default: 60, curve: 'exp' },
  // 0 means it never stops, which is what an effect standing on a map wants.
  // Thrown by an ability it is stopped after one lifetime whatever this says.
  duration: { kind: 'range', label: 'Emits for (sec)', min: 0, max: 10, step: 0.05, default: 0 },
} as const;

/** The rows an emitter always shows, before its shape's own and its modifiers. */
export const EMITTER_KEYS = ['shape', 'mode', 'count', 'lift', 'duration'] as const;

// --------------------------------------------------------------- particle

export const PARTICLE_SHAPES = [
  ['dot', 'Soft dot'],
  ['glow', 'Glow'],
  ['spark', 'Hard dot'],
  ['square', 'Square'],
  ['ring', 'Ring'],
  ['star', 'Star'],
  ['streak', 'Streak'],
  ['sprite', 'Sprite'],
] as const;

export const PARTICLE_FIELDS = {
  shape: { kind: 'select', label: 'Shape', options: PARTICLE_SHAPES, default: 'dot' },
  // A picture to use instead of a drawn shape, carried inline as a data URL so
  // an effect is one whole thing: it copies to another game, survives a rename,
  // and cannot arrive somewhere with its picture missing. Only when the shape
  // is Sprite; the editor shrinks whatever is dropped on it to VFX_IMAGE_MAX.
  image: { kind: 'image', label: 'Image', default: '' },
  color: { kind: 'color', label: 'Colour', default: 0xffc866 },
  // Additive blending, and how hard. 0 draws the particle as ordinary
  // transparency. Past 1 there is nothing left in an 8-bit frame to get
  // brighter, so a higher number drives the middle of the sprite to white
  // sooner and carries the brightness outward into its falloff.
  glow: { kind: 'range', label: 'Glow', min: 0, max: 4, step: 0.1, default: 1 },
  opacity: { kind: 'range', label: 'Opacity', min: 0.05, max: 1, step: 0.05, default: 1 },
  // Particles are not lit — no light in a map touches one — but they *are*
  // graded, and a map with tone mapping on turns a hot flame into a smudge.
  raw: { kind: 'bool', label: 'Raw colour', default: true },
  life: { kind: 'range', label: 'Lifetime (sec)', min: 0.05, max: 8, step: 0.05, default: 0.8 },
  size: { kind: 'range', label: 'Size (tiles)', min: 0.01, max: 3, step: 0.01, default: 0.18 },
  speed: { kind: 'range', label: 'Speed (tiles/sec)', min: 0, max: 20, step: 0.1, default: 1.4 },
  gravity: { kind: 'range', label: 'Gravity', min: -20, max: 20, step: 0.1, default: 0 },
} as const;

export const PARTICLE_KEYS = [
  'shape',
  'image',
  'color',
  'glow',
  'opacity',
  'raw',
  'life',
  'size',
  'speed',
  'gravity',
] as const;

/** Which of a particle's rows are worth showing, given the shape it is. */
export function particleKeys(particle?: { shape?: string }): string[] {
  return (PARTICLE_KEYS as readonly string[]).filter(
    (key) => key !== 'image' || particle?.shape === 'sprite',
  );
}

// -------------------------------------------------------------- movements

export const MOVEMENT_FIELDS = {
  turn: { kind: 'range', label: 'Turn (deg/sec)', min: -720, max: 720, step: 15, default: 90 },
  rise: { kind: 'range', label: 'Rise (tiles/sec)', min: -10, max: 10, step: 0.1, default: 0.5 },
  widen: { kind: 'range', label: 'Widen (tiles/sec)', min: -5, max: 5, step: 0.05, default: 0 },
  heading: { kind: 'range', label: 'Direction (deg)', min: 0, max: 360, step: 15, default: 0 },
  force: { kind: 'range', label: 'Force (tiles/sec2)', min: -20, max: 20, step: 0.1, default: 2 },
  flip: { kind: 'bool', label: 'Backhand', default: false },
} as const;

export const MOVEMENT_TYPES = {
  orbit: {
    label: 'Circular',
    hint: 'Swings around the middle of the effect, keeping its distance. A ring that turns.',
    fields: ['turn'],
  },
  spiral: {
    label: 'Cylindrical',
    hint: 'The same swing, climbing and opening out as it goes — a corkscrew.',
    fields: ['turn', 'rise', 'widen'],
  },
  curve: {
    label: 'Arc',
    hint: 'Bends the way it is travelling rather than moving it, so it flies its own curve.',
    fields: ['turn'],
  },
  drift: {
    label: 'Drift',
    hint: 'A steady push one way, whatever it was doing. Wind, or a fire leaning.',
    fields: ['heading', 'force'],
  },
  attract: {
    label: 'Attract',
    hint: 'Pulls back toward the middle. A negative force pushes away instead.',
    fields: ['force'],
  },
  slash: {
    label: 'Slash',
    hint: `Carries each particle around the effect, from one edge of a swing to the other over
      its own lifetime, drawn at the edge of the cone. How wide the swing is and where it
      points come from the ability — its arc and its aim — so the sparks match the blow.`,
    fields: ['flip'],
  },
} as const;

// ------------------------------------------------------------------ sheet

/**
 * The other kind of effect: a picture, animated, on a shape.
 *
 * A particle system draws a thousand of the same small thing and gets its look
 * from how they move. This gets its look from the picture — a flipbook of fire,
 * a shockwave, a rune — played across a strip of a spritesheet onto one mesh.
 * Neither can do the other's job, which is why an effect says which it is
 * rather than the two being settings of one thing.
 */
export const VFX_KINDS = [
  ['particles', 'Particles'],
  ['sheet', 'Sprite sheet'],
] as const;

/** The meshes a sheet can be played on, and the geometry each one needs. */
export const SHEET_SHAPES = {
  plane: {
    label: 'Plane',
    hint: 'A flat quad. With Facing set to the camera it is the ordinary billboard.',
    fields: ['width', 'height'],
  },
  disc: {
    label: 'Disc',
    hint: 'A circle. Laid on the ground it is the shape a shockwave or a rune wants.',
    fields: ['radius'],
  },
  cone: {
    label: 'Cone',
    hint: 'Open at both ends and drawn from both sides — a jet, a funnel, a cone of flame.',
    fields: ['radius', 'height'],
  },
  cylinder: {
    label: 'Cylinder',
    hint: 'A standing tube. A pillar of fire, or a column of light.',
    fields: ['radius', 'height'],
  },
  sphere: {
    label: 'Ball',
    hint: 'A ball with the sheet wrapped around it. Shields and bubbles.',
    fields: ['radius'],
  },
  box: {
    label: 'Box',
    hint: 'A cube with the sheet on every face.',
    fields: ['width', 'height', 'depth'],
  },
} as const;

export const SHEET_FIELDS = {
  shape: {
    kind: 'select',
    label: 'Shape',
    options: Object.entries(SHEET_SHAPES).map(([id, spec]) => [id, spec.label]),
    default: 'plane',
  },
  width: { kind: 'range', label: 'Width (tiles)', min: 0.05, max: 16, step: 0.05, default: 1 },
  height: { kind: 'range', label: 'Height (tiles)', min: 0.05, max: 16, step: 0.05, default: 1 },
  depth: { kind: 'range', label: 'Depth (tiles)', min: 0.05, max: 16, step: 0.05, default: 1 },
  radius: { kind: 'range', label: 'Radius (tiles)', min: 0.05, max: 16, step: 0.05, default: 0.6, curve: 'exp' },
  /**
   * Which way the shape is turned. A flipbook is a picture, and a picture has a
   * front: "camera" keeps it facing you however the shape is placed, "ground"
   * lays it flat like a decal, and "upright" leaves it standing where the
   * transform put it.
   */
  facing: {
    kind: 'select',
    label: 'Facing',
    options: [
      ['camera', 'Camera'],
      ['ground', 'Ground'],
      ['upright', 'Upright'],
    ],
    default: 'camera',
  },
  // The sheet itself, inline as a data URL for the same reason a particle's
  // sprite is: an effect that carries its own picture cannot arrive somewhere
  // without it.
  image: { kind: 'image', label: 'Sheet', default: '' },
  // How the cells are laid out on it. A strip is one row, or one column.
  columns: { kind: 'range', label: 'Columns', min: 1, max: 32, step: 1, default: 4 },
  rows: { kind: 'range', label: 'Rows', min: 1, max: 32, step: 1, default: 4 },
  /**
   * Which stretch of the sheet is played, counting across then down: where it
   * starts, and how many from there. Start 5 and 5 frames plays 5, 6, 7, 8, 9.
   *
   * A count rather than an end frame, because the count is the thing you
   * actually authored — a clip is "eight frames of fire", and where it happens
   * to sit on the sheet is bookkeeping. It also means two clips on one sheet
   * are (0, 8) and (8, 8) rather than a pair of numbers you have to subtract.
   *
   * 0 frames means the rest of the sheet, so a whole sheet needs no counting.
   *
   * Typed rather than dragged: these are `number` fields, so a pixel of drag is
   * one frame. A slider across a thousand cells is one you cannot land on the
   * cell you want.
   */
  frameFrom: { kind: 'number', label: 'Start frame', min: 0, max: 1024, step: 1, default: 0 },
  frames: { kind: 'number', label: 'Frames (0 = rest)', min: 0, max: 1024, step: 1, default: 0 },
  fps: { kind: 'range', label: 'Frames per second', min: 0.5, max: 60, step: 0.5, default: 16 },
  loop: { kind: 'bool', label: 'Loops', default: true },
  /**
   * A colour laid over the sheet, *added* rather than multiplied.
   *
   * That is not a preference. Babylon adds a material's emissive colour to its
   * emissive texture, so there is no multiply to be had here without a shader
   * of our own — and an added colour is genuinely useful anyway: it pushes a
   * fire toward blue without touching the picture. Black adds nothing, which is
   * why that is where it starts.
   */
  color: { kind: 'color', label: 'Added colour', default: 0x000000 },
  // A sheet's brightness is the picture's own, so this is the switch between
  // adding it to the frame and laying it over — not the dial a particle has,
  // which has a flat colour it can scale.
  glow: { kind: 'bool', label: 'Glows', default: true },
  opacity: { kind: 'range', label: 'Opacity', min: 0.05, max: 1, step: 0.05, default: 1 },
  raw: { kind: 'bool', label: 'Raw colour', default: true },
  lift: { kind: 'range', label: 'Lift (tiles)', min: 0, max: 6, step: 0.05, default: 0.5 },
  // How long it stays. 0 means until the animation has run once for a sheet
  // that does not loop, and forever for one that does.
  duration: { kind: 'range', label: 'Lasts (sec)', min: 0, max: 20, step: 0.05, default: 0 },
} as const;

/** The rows a sheet always shows, before its shape's own and its modifiers. */
export const SHEET_KEYS = [
  'shape',
  'facing',
  'image',
  'columns',
  'rows',
  'frameFrom',
  'frames',
  'fps',
  'loop',
  'color',
  'glow',
  'opacity',
  'raw',
  'lift',
  'duration',
] as const;

/** Which of a sheet's rows are worth showing, given the shape it is on. */
export function sheetKeys(sheet?: { shape?: string }): string[] {
  const shape = isSheetShape(sheet?.shape) ? SHEET_SHAPES[sheet.shape] : SHEET_SHAPES.plane;
  const [first, ...rest] = SHEET_KEYS;
  return [first, ...shape.fields, ...rest];
}

/**
 * Which cells the sheet plays: where it starts, and how many from there.
 *
 * Everything is clamped to what is actually on the sheet, and a range that ends
 * before it begins still plays one frame — a clip of nothing is not a thing
 * anyone means to author, and a divide by zero downstream is worse than a still
 * picture.
 */
export function sheetFrames(sheet: Partial<VfxSheet>): {
  columns: number;
  rows: number;
  first: number;
  count: number;
} {
  const columns = Math.max(1, Math.round(sheet.columns ?? 1));
  const rows = Math.max(1, Math.round(sheet.rows ?? 1));
  const all = columns * rows;

  const first = Math.min(Math.max(0, Math.round(sheet.frameFrom ?? 0)), all - 1);
  const left = all - first;
  const asked = Math.round(sheet.frames ?? 0);

  return { columns, rows, first, count: asked > 0 ? Math.min(asked, left) : left };
}

// -------------------------------------------------------------- modifiers

/**
 * The things that can be added to a section.
 *
 * `where` says which sections offer it, because most of these mean something in
 * both places and one or two do not: an emitter has no lifetime to randomise
 * over, and a particle has no transform of its own to set.
 */
/** How a value travels from its start to its end. */
export type VfxCurve = (typeof VFX_CURVES)[number][0];

/** Which of the two machines an effect is. */
export type VfxKind = (typeof VFX_KINDS)[number][0];

/** Which part of an effect a modifier can sit on. */
export type VfxSection = 'emitter' | 'particle' | 'sheet';

/** The volume particles are born from. */
export type EmitterShape = keyof typeof EMITTER_SHAPES;

/** What one particle is drawn as. */
export type ParticleShape = (typeof PARTICLE_SHAPES)[number][0];

/** The body a sprite sheet is wrapped around. */
export type SheetShape = keyof typeof SHEET_SHAPES;

/** How a movement modifier carries what it is attached to. */
export type MovementType = keyof typeof MOVEMENT_TYPES;

/**
 * Every setting any modifier can carry.
 *
 * One flat list rather than one type per kind, because a modifier stores its
 * settings beside its `kind` and that is what decides which of them mean
 * anything -- exactly the shape `MODIFIER_FIELDS` already has. Written out
 * rather than derived from that table for the reason given on `LightValues`
 * in ./lights.ts: `as const` would pin every default to a literal, and a
 * modifier whose scale could only ever be 1 is no use to anyone.
 */
export type ModifierValues = {
  turn: number;
  rise: number;
  widen: number;
  heading: number;
  force: number;
  flip: boolean;
  scaleFrom: number;
  scaleTo: number;
  scaleCurve: VfxCurve;
  fadeFrom: number;
  fadeTo: number;
  fadeCurve: VfxCurve;
  colorFrom: number;
  colorTo: number;
  colorCurve: VfxCurve;
  varySize: number;
  varyOpacity: number;
  varyPosition: number;
  varyRotation: number;
  posX: number;
  posY: number;
  posZ: number;
  rotX: number;
  rotY: number;
  rotZ: number;
  scaleX: number;
  scaleY: number;
  scaleZ: number;
  spin: number;
  spinStart: number;
};

/** One modifier: which kind, which flavour of it, and its settings. */
export type VfxModifier = {
  kind: ModifierKind;
  /** Only a `movement` modifier has one. */
  type?: MovementType;
} & Partial<ModifierValues>;

/** A modifier as a rules file writes it. */
export type ModifierInput = { kind?: string; type?: string } & Partial<ModifierValues>;

export type VfxEmitter = {
  shape: EmitterShape;
  mode: 'continuous' | 'burst';
  radius: number;
  height: number;
  sizeX: number;
  sizeY: number;
  sizeZ: number;
  spread: number;
  lift: number;
  count: number;
  duration: number;
  modifiers: VfxModifier[];
};

export type VfxParticle = {
  shape: ParticleShape;
  image: string;
  color: number;
  glow: number;
  opacity: number;
  raw: boolean;
  life: number;
  size: number;
  speed: number;
  gravity: number;
  modifiers: VfxModifier[];
};

export type VfxSheet = {
  shape: SheetShape;
  facing: 'camera' | 'ground' | 'upright';
  image: string;
  columns: number;
  rows: number;
  frameFrom: number;
  frames: number;
  fps: number;
  loop: boolean;
  color: number;
  glow: boolean;
  opacity: number;
  raw: boolean;
  lift: number;
  duration: number;
  width: number;
  height: number;
  depth: number;
  radius: number;
  modifiers: VfxModifier[];
};

/** A visual effect, filled in. */
export type Vfx = {
  id: string;
  label: string;
  /** The folder this record was found in. See `path` on Material. */
  path: string;
  kind: VfxKind;
  emitter: VfxEmitter;
  particle: VfxParticle;
  sheet: VfxSheet;
};

/**
 * An effect as a rules file writes it.
 *
 * Carries both spellings. The flat fields after `sheet` are the shape effects
 * had before an emitter and a particle were told apart, and `upconvert` below
 * is what reads them; `isLegacy` decides which of the two a record is.
 */
/**
 * One half of an effect, as a rules file writes it.
 *
 * `shape` and the modifiers are widened back out: the file is hand-edited, and
 * a shape or a modifier kind the tables no longer have is exactly what
 * `normalizeVfx` exists to decide about.
 */
type Loose<T> = Omit<Partial<T>, 'shape' | 'modifiers'> & {
  shape?: string;
  modifiers?: readonly ModifierInput[];
};

export type VfxInput = {
  id?: string;
  label?: string;
  path?: string;
  kind?: string;
  emitter?: Loose<VfxEmitter> | string;
  particle?: Loose<VfxParticle>;
  sheet?: Loose<VfxSheet>;
  spread?: number;
  radius?: number;
  height?: number;
  duration?: number;
  burst?: number;
  rate?: number;
  image?: string;
  shape?: string;
  color?: number;
  glow?: boolean | number;
  opacity?: number;
  raw?: boolean;
  life?: number;
  size?: number;
  speed?: number;
  gravity?: number;
  sizeEnd?: number;
  fade?: string;
  fadeTo?: number;
  vary?: number;
  spin?: number;
  angle?: number;
  movements?: readonly ModifierInput[];
};

/** Reaches a field table by a key worked out at runtime. */
const fieldDefault = (table: object, key: string): unknown =>
  (table as Record<string, { default: unknown }>)[key]?.default;

export const isParticleShape = (value: unknown): value is ParticleShape =>
  PARTICLE_SHAPES.some(([id]) => id === value);

export const isVfxCurve = (value: unknown): value is VfxCurve =>
  VFX_CURVES.some(([id]) => id === value);

export const MODIFIER_FIELDS = {
  // A movement's own settings live here too, so one table answers "what is
  // this field" for every modifier, the typed ones included. The names do not
  // collide, and a second lookup would be a second place to forget.
  ...MOVEMENT_FIELDS,

  // --- over time
  scaleFrom: { kind: 'range', label: 'Scale from', min: 0, max: 5, step: 0.05, default: 1 },
  scaleTo: { kind: 'range', label: 'Scale to', min: 0, max: 5, step: 0.05, default: 0 },
  scaleCurve: { kind: 'select', label: 'Scale curve', options: VFX_CURVES, default: 'linear' },
  fadeFrom: { kind: 'range', label: 'Opacity from', min: 0, max: 1, step: 0.05, default: 1 },
  fadeTo: { kind: 'range', label: 'Opacity to', min: 0, max: 1, step: 0.05, default: 0 },
  fadeCurve: { kind: 'select', label: 'Opacity curve', options: VFX_CURVES, default: 'linear' },
  colorFrom: { kind: 'color', label: 'Colour from', default: 0xffc866 },
  colorTo: { kind: 'color', label: 'Colour to', default: 0xff4400 },
  colorCurve: { kind: 'select', label: 'Colour curve', options: VFX_CURVES, default: 'linear' },

  // --- randomise, all as a share of the authored value
  varySize: { kind: 'range', label: 'Size (%)', min: 0, max: 100, step: 5, default: 0 },
  varyOpacity: { kind: 'range', label: 'Opacity (%)', min: 0, max: 100, step: 5, default: 0 },
  varyPosition: { kind: 'range', label: 'Position (%)', min: 0, max: 100, step: 5, default: 0 },
  varyRotation: { kind: 'range', label: 'Rotation (%)', min: 0, max: 100, step: 5, default: 0 },

  // --- transform
  posX: { kind: 'range', label: 'Position X', min: -16, max: 16, step: 0.1, default: 0 },
  posY: { kind: 'range', label: 'Position Y', min: -16, max: 16, step: 0.1, default: 0 },
  posZ: { kind: 'range', label: 'Position Z', min: -16, max: 16, step: 0.1, default: 0 },
  rotX: { kind: 'range', label: 'Rotation X', min: -180, max: 180, step: 15, default: 0 },
  rotY: { kind: 'range', label: 'Rotation Y', min: -180, max: 180, step: 15, default: 0 },
  rotZ: { kind: 'range', label: 'Rotation Z', min: -180, max: 180, step: 15, default: 0 },
  scaleX: { kind: 'range', label: 'Scale X', min: 0, max: 8, step: 0.05, default: 1 },
  scaleY: { kind: 'range', label: 'Scale Y', min: 0, max: 8, step: 0.05, default: 1 },
  scaleZ: { kind: 'range', label: 'Scale Z', min: 0, max: 8, step: 0.05, default: 1 },

  // --- spin, for a particle that has a face worth turning
  spin: { kind: 'range', label: 'Spin (deg/sec)', min: -720, max: 720, step: 15, default: 90 },
  spinStart: { kind: 'range', label: 'Start angle (deg)', min: 0, max: 180, step: 15, default: 0 },
} as const;

/** What one kind of modifier offers. */
type ModifierTypeSpec = {
  label: string;
  where: readonly VfxSection[];
  hint: string;
  fields: readonly string[];
  /** Only `movement` has flavours; the rest are one thing. */
  typed?: Record<string, { label: string; hint: string; fields: readonly string[] }>;
  typeLabel?: string;
  typeDefault?: string;
};

const MODIFIER_TABLE = {
  overTime: {
    label: 'Over time',
    where: ['emitter', 'particle', 'sheet'],
    hint: `Runs a value from its start to its end — over the emitter's own life, or over each
      particle's. Leave a pair equal to say nothing about it.`,
    fields: [
      'scaleFrom',
      'scaleTo',
      'scaleCurve',
      'fadeFrom',
      'fadeTo',
      'fadeCurve',
      'colorFrom',
      'colorTo',
      'colorCurve',
    ],
  },
  randomize: {
    label: 'Randomise',
    where: ['particle'],
    hint: `How far each particle may differ from the settings above, as a share of them. Nothing
      reads as more obviously computer-made than a hundred identical ones.`,
    fields: ['varySize', 'varyOpacity', 'varyPosition', 'varyRotation'],
  },
  transform: {
    label: 'Transform',
    where: ['emitter', 'sheet'],
    hint: `Where the emitter sits, how it is turned and how big it is, relative to whatever it
      was attached to. Scale stretches the shape particles are born from.`,
    fields: ['posX', 'posY', 'posZ', 'rotX', 'rotY', 'rotZ', 'scaleX', 'scaleY', 'scaleZ'],
  },
  spin: {
    label: 'Spin',
    where: ['particle'],
    hint: `Turns each particle as it goes, each picking its own direction. Only worth it on a
      shape with a corner — a dot looks the same at every angle, and a streak is turned by
      where it is going.`,
    fields: ['spin', 'spinStart'],
  },
  movement: {
    label: 'Movement',
    where: ['emitter', 'particle', 'sheet'],
    hint: 'Where it goes once it is under way. Pick a kind; each has its own settings.',
    // A movement's own fields come from its type, so it declares none here.
    fields: [],
    typed: MOVEMENT_TYPES,
    typeLabel: 'Kind',
    typeDefault: 'orbit',
  },
} as const;

/** Which kind of modifier. The `MODIFIER_TYPES` keys and no others. */
export type ModifierKind = keyof typeof MODIFIER_TABLE;

/**
 * The same table, read through one shape.
 *
 * Handed a common type rather than left as the literal object so that
 * `MODIFIER_TYPES[kind]` is one thing to reach into: only `movement` carries
 * `typed`, and against the raw union every read of it would have to ask which
 * member it had first.
 */
export const MODIFIER_TYPES: Record<ModifierKind, ModifierTypeSpec> = MODIFIER_TABLE;

export const isModifierKind = (value: unknown): value is ModifierKind =>
  typeof value === 'string' && value in MODIFIER_TABLE;

export const isSheetShape = (value: unknown): value is SheetShape =>
  typeof value === 'string' && value in SHEET_SHAPES;

export const isEmitterShape = (value: unknown): value is EmitterShape =>
  typeof value === 'string' && value in EMITTER_SHAPES;

/** What may be added to a section, for its Add menu. */
export function modifiersFor(section: VfxSection): [string, string][] {
  return Object.entries(MODIFIER_TYPES)
    .filter(([, spec]) => spec.where.includes(section))
    .map(([kind, spec]) => [kind, spec.label]);
}

/** The fields one modifier actually shows, its type's included. */
export function modifierFields(modifier?: ModifierInput | null): readonly string[] {
  if (!isModifierKind(modifier?.kind)) return [];
  const spec = MODIFIER_TYPES[modifier.kind];
  if (!spec.typed) return spec.fields;
  return (modifier.type ? spec.typed[modifier.type]?.fields : undefined) ?? [];
}

export function defaultModifier(kind: ModifierKind, type?: string): VfxModifier;
export function defaultModifier(kind: string, type?: string): VfxModifier | null;
export function defaultModifier(kind: string, type?: string): VfxModifier | null {
  if (!isModifierKind(kind)) return null;
  const spec = MODIFIER_TYPES[kind];
  const made = { kind } as VfxModifier;
  const fields = made as Record<string, unknown>;
  if (spec.typed) fields.type = type && spec.typed[type] ? type : spec.typeDefault;
  for (const key of modifierFields(made)) fields[key] = fieldDefault(MODIFIER_FIELDS, key);
  for (const key of spec.fields) fields[key] = fieldDefault(MODIFIER_FIELDS, key);
  return made;
}

function normalizeModifier(raw: ModifierInput = {}): VfxModifier | null {
  if (!isModifierKind(raw.kind)) return null;
  const spec = MODIFIER_TYPES[raw.kind];
  const type = spec.typed
    ? ((raw.type && spec.typed[raw.type] ? raw.type : spec.typeDefault) as MovementType | undefined)
    : undefined;
  return {
    ...defaultModifier(raw.kind, type),
    ...raw,
    kind: raw.kind,
    ...(type ? { type } : {}),
  } as VfxModifier;
}

// ------------------------------------------------------------- the effect

export function defaultEmitter(): VfxEmitter {
  const emitter = { modifiers: [] } as unknown as VfxEmitter;
  const fields = emitter as unknown as Record<string, unknown>;
  for (const key of Object.keys(EMITTER_FIELDS)) fields[key] = fieldDefault(EMITTER_FIELDS, key);
  return emitter;
}

export function defaultParticle(): VfxParticle {
  const particle = { modifiers: [] } as unknown as VfxParticle;
  const fields = particle as unknown as Record<string, unknown>;
  for (const key of PARTICLE_KEYS) fields[key] = fieldDefault(PARTICLE_FIELDS, key);
  return particle;
}

export function defaultSheet(): VfxSheet {
  const sheet = { modifiers: [] } as unknown as VfxSheet;
  const fields = sheet as unknown as Record<string, unknown>;
  for (const key of SHEET_KEYS) fields[key] = fieldDefault(SHEET_FIELDS, key);
  for (const key of ['width', 'height', 'depth', 'radius']) {
    fields[key] = fieldDefault(SHEET_FIELDS, key);
  }
  return sheet;
}

export function defaultVfx(id = 'newEffect'): Vfx {
  return {
    id,
    label: 'New effect',
    path: '',
    kind: 'particles',
    emitter: defaultEmitter(),
    particle: defaultParticle(),
    sheet: defaultSheet(),
  };
}

/**
 * The halves an effect of this kind is made of.
 *
 * Both kinds carry both sets — switching between them must not throw away what
 * you had tuned on the other — so this is what says which of them is live.
 */
export function partsOf(kind: string): VfxSection[] {
  return kind === 'sheet' ? ['sheet'] : ['emitter', 'particle'];
}

/**
 * An effect written before this shape existed, read as one that was not.
 *
 * The old form was one flat record — every setting at the top level, `emitter`
 * a string naming a shape, `movements` a list. It is upconverted rather than
 * rejected because the alternative is somebody's saved work turning into a
 * default effect the first time they open the editor.
 */
function upconvert(def: VfxInput): Vfx {
  const emitter = defaultEmitter();
  const particle = defaultParticle();

  emitter.shape = isEmitterShape(def.emitter) ? def.emitter : 'cone';
  // A spread wide enough to stop being a cone *was* how you asked for a ball.
  if (def.emitter === undefined && (def.spread ?? 0) >= 175) emitter.shape = 'sphere';
  emitter.radius = def.radius ?? emitter.radius;
  emitter.spread = def.spread ?? emitter.spread;
  emitter.lift = def.height ?? emitter.lift;
  emitter.duration = def.duration ?? emitter.duration;
  // One count, spent one of two ways: a burst if it had one, otherwise a rate.
  const burst = def.burst ?? 0;
  emitter.mode = burst > 0 ? 'burst' : 'continuous';
  emitter.count = burst > 0 ? burst : (def.rate ?? emitter.count);
  particle.shape = def.image
    ? 'sprite'
    : (isParticleShape(def.shape) ? def.shape : particle.shape);
  particle.image = def.image ?? '';
  particle.color = def.color ?? particle.color;
  particle.glow = typeof def.glow === 'boolean' ? (def.glow ? 1 : 0) : (def.glow ?? particle.glow);
  particle.opacity = def.opacity ?? particle.opacity;
  particle.raw = def.raw ?? particle.raw;
  particle.life = def.life ?? particle.life;
  particle.size = def.size ?? particle.size;
  particle.speed = def.speed ?? particle.speed;
  particle.gravity = def.gravity ?? particle.gravity;

  // Everything the old form said with a dedicated field is a modifier now.
  const overTime = defaultModifier('overTime');
  overTime.scaleFrom = 1;
  const size = def.size ?? 0;
  overTime.scaleTo = size > 0 ? (def.sizeEnd ?? 0) / size : 0;
  overTime.fadeFrom = 1;
  overTime.fadeTo = 0;
  overTime.fadeCurve =
    def.fade === 'inOut' ? 'bell' : (isVfxCurve(def.fade) ? def.fade : 'linear');
  overTime.colorFrom = def.color ?? particle.color;
  overTime.colorTo = def.fadeTo ?? 0xff4400;
  particle.modifiers.push(overTime);

  const vary = def.vary ?? 0;
  const spinBy = def.spin ?? 0;
  const angle = def.angle ?? 0;
  if (vary > 0 || spinBy > 0 || angle > 0) {
    if (vary > 0) {
      const randomize = defaultModifier('randomize');
      randomize.varySize = Math.round(vary * 100);
      particle.modifiers.push(randomize);
    }
    if (spinBy > 0 || angle > 0) {
      const spin = defaultModifier('spin');
      spin.spin = spinBy;
      spin.spinStart = angle;
      particle.modifiers.push(spin);
    }
  }

  for (const raw of def.movements ?? []) {
    const move = defaultModifier('movement', raw.type);
    particle.modifiers.push({ ...move, ...raw, kind: 'movement' } as VfxModifier);
  }

  // The old colour variation was a second birth colour, which the over-time
  // modifier has no room for. Dropped rather than half-kept: a wrong colour is
  // worse than a colour somebody has to set again.
  return {
    id: def.id ?? 'newEffect',
    label: def.label ?? 'New effect',
    path: def.path ?? '',
    kind: 'particles',
    emitter,
    particle,
    sheet: defaultSheet(),
  };
}

/**
 * Is this a definition from before the shape changed?
 *
 * The old form said `emitter` with a string, so that alone is proof. Otherwise
 * it is one only if it names none of the parts an effect is made of — a record
 * that says nothing is read as the old kind because the old kind is what a
 * record that says nothing used to be, and either way it ends up at defaults.
 */
function isLegacy(def: VfxInput): boolean {
  if (typeof def.emitter === 'string') return true;
  return !def.kind && !def.emitter && !def.particle && !def.sheet;
}

/** Fill in whatever a hand-written or half-edited definition left out. */
/** Drops the modifiers a rules file named that nothing knows how to build. */
const kept = (raw: readonly ModifierInput[] | undefined): VfxModifier[] =>
  (raw ?? []).map(normalizeModifier).filter((modifier): modifier is VfxModifier => modifier !== null);

export function normalizeVfx(def: VfxInput = {}): Vfx {
  if (isLegacy(def)) return upconvert(def);
  const given = typeof def.emitter === 'string' ? undefined : def.emitter;
  const emitterShape = given?.shape;
  const emitter: VfxEmitter = {
    ...defaultEmitter(),
    ...given,
    shape: isEmitterShape(emitterShape) ? emitterShape : 'cone',
    modifiers: kept(given?.modifiers),
  };

  const particleShape = def.particle?.shape;
  const particle: VfxParticle = {
    ...defaultParticle(),
    ...def.particle,
    shape: isParticleShape(particleShape) ? particleShape : 'dot',
    modifiers: kept(def.particle?.modifiers),
  };

  const sheetShape = def.sheet?.shape;
  const sheet: VfxSheet = {
    ...defaultSheet(),
    ...def.sheet,
    shape: isSheetShape(sheetShape) ? sheetShape : 'plane',
    modifiers: kept(def.sheet?.modifiers),
  };

  return {
    id: def.id ?? 'newEffect',
    label: def.label ?? 'New effect',
    path: def.path ?? '',
    kind: def.kind === 'sheet' ? 'sheet' : 'particles',
    emitter,
    particle,
    sheet,
  };
}

/** The modifiers of one kind a section carries, in the order they were added. */
export function modifiersOf(
  part: { modifiers?: readonly VfxModifier[] } | null | undefined,
  kind: ModifierKind,
): VfxModifier[] {
  return (part?.modifiers ?? []).filter((modifier) => modifier.kind === kind);
}

/** The first modifier of a kind, for the ones it makes no sense to have two of. */
export function modifierOf(
  part: { modifiers?: readonly VfxModifier[] } | null | undefined,
  kind: ModifierKind,
): VfxModifier | null {
  return modifiersOf(part, kind)[0] ?? null;
}

export function vfxMap(defs: readonly VfxInput[] = VFX): Map<string, Vfx> {
  return new Map(defs.map((def) => [def.id ?? 'newEffect', normalizeVfx(def)]));
}

/** Left unnormalized: the rules editor reads this straight into what it saves. */
export const VFX = GAME_VFX as VfxInput[];
