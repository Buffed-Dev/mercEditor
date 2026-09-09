// The map file format, shared by every map in data/maps/.
//
// Terrain is a height per tile, written as an ASCII grid:
//
//   '.'  ground, level 0
//   '1'  one level up   '2'  two levels up, and so on to '9'
//   '@'  ground at level 0 + the map's default spawn
//
// Rows must all be the same length; row index is gy, column index is gx.
//
// **A tile is a flat top with vertical sides.** The number is how many blocks
// tall the column is, so a tile is level with itself all the way across and
// steps to whatever its neighbour is. Nothing is interpolated and no tile's
// height depends on the tile beside it.
//
// This used to be the other way round: corners took the height of the tallest
// tile touching them and every rise became a walkable slope, whether or not
// anyone wanted one. Ramps were free and steps were impossible. Now steps are
// free and **a ramp is a thing you place** — a tile named in the map's `tops`
// list, which slopes across itself from one level below its own to its own.
// See src/data/blocks.js.
//
// What you may climb is the map's `stepHeight`, in levels. A rise within it is
// a step up; anything more is a cliff and behaves as one, which is what makes a
// tall column a wall without anything having to declare itself one.
//
// **Walls are objects, not terrain.** They stand on whatever the ground under
// them happens to be and stack on each other, so they are a list of tiles like
// torches and portals rather than a character in the grid. Everything that is
// not terrain is declared the same way, keyed by integer tile coordinates; the
// tile's centre is (gx + 0.5, gy + 0.5).

export const SPAWN_CHAR = '@';

/**
 * A map's environment: everything about how it looks that is not a thing
 * standing on it.
 *
 * Here rather than in the renderer because two other places need the same
 * answer — the editor, which draws a panel from it, and the serializer, which
 * writes it back out. It used to live in three, and the copies drifted.
 *
 * Four of these are switches rather than values. A map that wants no fog should
 * say so once, not by setting a reach nobody can read as "off" — and a panel
 * with four settings folded away behind a switch is a panel you can take in at
 * a glance. Everything under a switch is skipped entirely when it is off, so it
 * costs nothing at all rather than costing a multiply by zero.
 */
export const DEFAULT_ENV = {
  sky: 0x9fd4ef,
  wallColor: 0xd6cdb8,
  floorColor: 0x8cc45f,
  soilColor: 0x7a5a3a,

  // Ambient fill and the grading over the top of it. Off, a map is lit by its
  // own lights alone and shown at the values they produce.
  lighting: true,
  ambientColor: 0xf2f6ff,
  ambientIntensity: 2.2,
  exposure: 1,
  contrast: 1,
  toneMapping: false,

  // How enclosed a corner reads as. Off, nothing is darkened for being in one.
  ao: true,
  aoStrength: 0.9,

  // Fog rolling in off the edges, measured in tiles: how far in from the edge
  // it reaches, and how many of those are the soft fade rather than solid sky.
  fog: true,
  fogReach: 6,
  fogSmooth: 4,

  // Cloud shadows crossing the ground. Size is how many tiles across one cloud
  // is, speed how many tiles a second they travel, heading which way they go.
  clouds: false,
  cloudShade: 0.4,
  cloudScale: 14,
  cloudSpeed: 0.6,
  cloudAngle: 45,
};

/**
 * A map's environment settings, filled in.
 *
 * Taken from `DEFAULT_ENV` rather than written out beside it, because that
 * table is already the list of what an env has and what each one defaults to.
 * Deliberately not `as const`: these are values to be edited, not literals.
 */
export type MapEnv = typeof DEFAULT_ENV;

/**
 * An env as a map file writes it.
 *
 * `clouds` widens to a number because that is how maps written before clouds
 * had an on/off switch say it -- see `normalizeEnv`.
 */
export type MapEnvInput = Partial<Omit<MapEnv, 'clouds'>> & { clouds?: boolean | number };

/** Anything a map puts at a tile. */
export type Placed = { gx: number; gy: number };

/**
 * One of a map's placed things, whatever kind.
 *
 * Open past the position on purpose: what else a portal or a monster carries
 * belongs to the renderer that reads it, not to the file format. The parts of
 * the data layer that handle these lists only ever ask where something is and
 * move it, so a position plus 'and whatever else it had' is the whole contract
 * here, and it stays honest rather than inventing fields.
 */
export type MapObject = Placed & { [key: string]: unknown };

/** A wall, which stacks. */
export type Wall = Placed & { stack?: number };

/** What assembling a run recorded about itself. See ./maps/generate.ts. */
export type GeneratedInfo = { seed: number; parts: number; endDepth: number };

/** The lists a map keeps of things standing somewhere. */
export const MAP_LISTS = [
  'walls',
  'portals',
  'monsters',
  'torches',
  'stations',
  'lights',
  'doors',
] as const;

export type MapList = (typeof MAP_LISTS)[number];

/**
 * A map as a file in `Games/*\/maps` writes it.
 *
 * Almost everything is optional because a map file says only what it has: a
 * handwritten room has rows and a spawn and nothing else, while one the editor
 * has been through carries every list. `terrain` and `rows` are two spellings
 * of the same grid, the second being what maps written before the terrain
 * codec used.
 */
export type GameMap = {
  id: string;
  name?: string;
  terrain?: readonly string[];
  terrainKeys?: Record<string, string>;
  terrainRim?: unknown;
  rows?: readonly string[];
  height?: number;
  startZ?: number;
  stepHeight?: number;
  spawns?: Record<string, Placed>;
  env?: MapEnvInput;
  vfx?: unknown;
  props?: readonly MapObject[];
  decals?: readonly MapObject[];
  /**
   * Set on a map that is rebuilt from chunks each run.
   *
   * A source map says `true`; a map that has just been assembled carries what
   * the assembly recorded instead. Everything that reads this only asks
   * whether it is there, so both spellings answer the same question.
   */
  generated?: boolean | GeneratedInfo;
  chunks?: readonly unknown[];
  chunkCount?: number;
} & { readonly [K in MapList]?: readonly MapObject[] };

/** A grid of levels, read off a map's rows. */
export type ParsedMap = {
  cols: number;
  rows: number;
  levels: number[][];
  levelAt: (tx: number, ty: number) => number | null;
  spawn: Placed;
};

/**
 * A map's env, with everything it left out filled in.
 *
 * The clouds took their switch's name before they had one — `clouds` was how
 * strong they were — so a number found there is read as both: on, and that
 * strong. Nothing else has ever changed shape.
 */
export function normalizeEnv(env: MapEnvInput = {}): MapEnv {
  const { clouds, ...rest } = env;
  const full: MapEnv = {
    ...DEFAULT_ENV,
    ...rest,
    clouds: typeof clouds === 'boolean' ? clouds : DEFAULT_ENV.clouds,
  };
  if (typeof clouds === 'number') {
    full.clouds = clouds > 0;
    full.cloudShade = clouds;
  }
  return full;
}


/**
 * Kept only so a map written before walls became objects can still be read and
 * converted. Nothing in the grid means "wall" any more.
 */
export const WALL_CHAR = '#';

/**
 * The highest a tile can stand. A level is one character, so this is what one
 * digit can say — and at half a unit each, nine of them is a long way up.
 */
export const MAX_LEVEL = 9;

/** The height a terrain character stands for. Anything unknown is ground. */
export function levelFromChar(char: string): number {
  const level = Number.parseInt(char, 10);
  return Number.isNaN(level) ? 0 : Math.min(MAX_LEVEL, level);
}

/**
 * The character for a floor at a given level.
 *
 * Level 0 is written '.' rather than '0'. Both parse the same, but '.' is what
 * every hand-written map already uses for plain ground, and a map speckled with
 * zeroes would be a worse file to read.
 */
export function levelChar(level: number): string {
  const clamped = Math.min(MAX_LEVEL, Math.max(0, Math.round(level)));
  return clamped === 0 ? '.' : String(clamped);
}

/** The height grid and the spawn tile. */
export function parseMap(rows: readonly string[]): ParsedMap {
  const cols = rows[0].length;
  rows.forEach((row, i) => {
    if (row.length !== cols) {
      throw new Error(`Map row ${i} is ${row.length} chars, expected ${cols}`);
    }
  });

  let spawn: Placed = { gx: cols / 2, gy: rows.length / 2 };

  const levels = rows.map((row, gy) =>
    [...row].map((char, gx) => {
      if (char === SPAWN_CHAR) spawn = { gx: gx + 0.5, gy: gy + 0.5 };
      return levelFromChar(char);
    }),
  );

  const height = rows.length;
  const levelAt = (tx: number, ty: number): number | null =>
    tx < 0 || ty < 0 || tx >= cols || ty >= height ? null : levels[ty][tx];

  return { cols, rows: height, levels, levelAt, spawn };
}

/**
 * Look up one of a map's named arrival points. `default` is the '@' tile from
 * the ASCII; anything else comes from the map's `spawns` table, which is what
 * portals target so you arrive beside the door you came out of rather than at
 * the map's start.
 */
export function spawnPoint(map: GameMap, parsed: ParsedMap, name = 'default'): Placed {
  const named = map.spawns?.[name];
  if (named) return { gx: named.gx + 0.5, gy: named.gy + 0.5 };
  return { ...parsed.spawn };
}

/**
 * How many wall blocks stand on each tile, keyed "gx,gy".
 *
 * A wall entry without a stack is one block, which is what every wall converted
 * from the old '#' grid is.
 */
export function wallStacks(walls: readonly Wall[] = []): Map<string, number> {
  const stacks = new Map<string, number>();
  for (const wall of walls) {
    stacks.set(`${wall.gx},${wall.gy}`, Math.max(1, Math.round(wall.stack ?? 1)));
  }
  return stacks;
}
