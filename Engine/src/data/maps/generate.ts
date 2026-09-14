import { DEFAULT_CHUNK_COUNT, chunkCount, chunksOf } from './chunks.ts';
import {
  MAP_LISTS,
  SPAWN_CHAR,
  type GameMap,
  type GeneratedInfo,
  type MapObject,
  type Placed,
} from '../mapFormat.ts';
import { turnEntry, turnLists } from './rotate.ts';
import type { ChunkPart } from './chunks.ts';

/** Which edge of a part a doorway sits on. */
export type Side = '+x' | '-x' | '+y' | '-y';

/** A step of one tile. */
export type Dir = { x: number; y: number };

/** A run of door tiles along one edge, treated as a single opening. */
export type Doorway = { side: Side; dir: Dir; gx: number; gy: number; width: number };

/** A doorway still looking for something to join onto, and how far in it is. */
export type OpenDoor = Doorway & { depth: number };

/** Where a part sits in the assembled grid. */
export type Rect = { x: number; y: number; w: number; h: number };

/** A part that has been given a place. */
export type Placement = {
  part: ChunkPart;
  rect: Rect;
  isStart?: boolean;
  depth?: number;
  joinedAt?: Doorway;
};

/** What `fitAgainst` found: a placement that has definitely joined something. */
type Fit = { part: ChunkPart; rect: Rect; joinedAt: Doorway; depth?: number };

/**
 * Generated maps: assembled out of their own chunks.
 *
 * A map marked `generated` is not the place you walk. What you walk is built
 * on the way in by cutting the map's **chunks** out of it — see ./chunks.js —
 * and fitting them together doorway to doorway. Ten of them fitted together are
 * what `dungeon` actually is by the time anyone arrives.
 *
 * The whole point of doing it this way is that a chunk is authored in the map
 * editor with every tool the editor already has, saved in the map file like
 * everything else on the map, and read back by the same parser. Nothing here is
 * a second map format; the only thing a chunk carries that a map does not is
 * where its doors
 * are and which cluster it belongs to.
 *
 * A part declares:
 *
 *   cluster      the cluster it is a piece of, e.g. 'dungeon'
 *   role         'start' — where you arrive, placed first, never rotated
 *                'end'   — held back and placed last, so the way out is deep
 *                (absent) — ordinary filler, placed at random
 *   doors        border tiles that open outward, as { gx, gy }
 *   clusterSize  how many parts a run of this cluster is (on the start part)
 *
 * **Authoring rule, and the only one:** a part's border is walls except where
 * its doors are. Two parts are laid edge to edge, so a border tile that is
 * floor and is not a door is an opening into whatever happens to be placed
 * next to it. The generator does not check this, because "the wall you forgot"
 * and "the shortcut you meant" look identical from here.
 */

/** How wide a part is. Zero for a part with no rows, which draws nothing. */
const colsOf = (part: Pick<ChunkPart, 'rows'>): number => part.rows[0]?.length ?? 0;

/** The outward side of a door, from where it sits on its part's border. */
export function doorSide(part: ChunkPart, door: Placed): Side | null {
  const cols = colsOf(part);
  const rows = part.rows.length;
  if (door.gx === 0) return '-x';
  if (door.gx === cols - 1) return '+x';
  if (door.gy === 0) return '-y';
  if (door.gy === rows - 1) return '+y';
  return null; // not on the border: not a door, whatever it says
}

const DIRS: Record<Side, Dir> = {
  '+x': { x: 1, y: 0 },
  '-x': { x: -1, y: 0 },
  '+y': { x: 0, y: 1 },
  '-y': { x: 0, y: -1 },
};

/**
 * The doorways of a part: every run of touching door tiles on its border.
 *
 * A doorway is as wide as you drew it. Two door tiles side by side on the same
 * edge are one opening two tiles wide, not two openings — which is the only
 * reading that matches what putting them there looks like, and it means a wide
 * doorway needs no new field in the map format, just another tile.
 *
 * The tile reported as the doorway's position is the first one along its edge.
 * Parts are only ever turned and slid, never mirrored, so laying two doorways
 * first-tile to first-tile lines up every tile behind them.
 */
export function doorsOf(part: ChunkPart): Doorway[] {
  type Tile = { gx: number; gy: number; side: Side };
  const tiles: Tile[] = (part.doors ?? [])
    .map((door) => ({ gx: door.gx, gy: door.gy, side: doorSide(part, door) }))
    .filter((door): door is Tile => door.side !== null);

  // A doorway runs along its edge: up the side ones, across the top and bottom.
  const alongOf = (side: Side): 'gx' | 'gy' => (side === '+x' || side === '-x' ? 'gy' : 'gx');

  const edges = new Map<string, Tile[]>();
  for (const tile of tiles) {
    const key = `${tile.side}:${alongOf(tile.side) === 'gy' ? tile.gx : tile.gy}`;
    if (!edges.has(key)) edges.set(key, []);
    edges.get(key)!.push(tile);
  }

  const doorways: Tile[][] = [];
  for (const list of edges.values()) {
    // Only a key that something was pushed under is in the map, so every list
    // here has a first tile to take the edge's axis from.
    const first = list[0];
    if (!first) continue;
    const along = alongOf(first.side);
    list.sort((a, b) => a[along] - b[along]);

    let run: Tile[] = [first];
    for (const tile of list.slice(1)) {
      if (tile[along] === run[run.length - 1]![along] + 1) run.push(tile);
      else {
        doorways.push(run);
        run = [tile];
      }
    }
    doorways.push(run);
  }

  return doorways.flatMap((run) => {
    const head = run[0];
    if (!head) return [];
    return [{
    side: head.side,
    dir: DIRS[head.side],
    gx: Math.min(...run.map((tile) => tile.gx)),
    gy: Math.min(...run.map((tile) => tile.gy)),
    width: run.length,
    }];
  });
}

// --------------------------------------------------------------- rotation

/**
 * A part turned a quarter of the way round, `k` times.
 *
 * The tiles and everything standing on them go through ../rotate.ts, which is
 * the same turn a prefab takes and is where the two facts live: where a tile
 * lands, and that anything carrying a direction has to turn with it or it comes
 * out of a rotated part pointing at a wall.
 *
 * What is left here is the two things only a chunk has — the terrain rows, and
 * the named spawns.
 *
 * Every list turns, rather than the seven that used to be written out by hand.
 * That is what lets a chunk carry a prefab: `MAP_LISTS` gained one, and a list
 * this function had not been told about would have come out of a rotated room
 * sitting where it was before the room turned.
 */
export function rotatePart(part: ChunkPart, k = 0): ChunkPart {
  const turns = ((k % 4) + 4) % 4;
  if (turns === 0) return part;
  if (turns > 1) return rotatePart(rotatePart(part, 1), turns - 1);

  const cols = colsOf(part);
  const rows = part.rows.length;

  const grid = Array.from({ length: cols }, (_, gy) =>
    Array.from({ length: rows }, (_, gx) => part.rows[rows - 1 - gx]?.[gy] ?? '.').join(''),
  );

  const lists: Record<string, MapObject[]> = {};
  for (const name of MAP_LISTS) lists[name] = [...(part[name] ?? [])];
  const turned = turnLists(lists, cols, rows, 1);

  const spawns: Record<string, Placed> = {};
  for (const [name, spawn] of Object.entries(part.spawns ?? {})) {
    spawns[name] = turnEntry(spawn, rows);
  }

  return { ...part, rows: grid, spawns, ...turned.lists } as ChunkPart;
}

// --------------------------------------------------------------- the run
//
// A dungeon is generated once and then kept. Walking out to base and back in
// has to be the same dungeon or the place has no geography at all — you could
// not go home to sell and come back for the bit you missed.
//
// It is dropped when the run is over: you died, or you took the stair down,
// which is a different dungeon by definition.

/** Map id -> the run its chunks were last assembled into. */
const runs = new Map<string, GameMap>();

/**
 * The dungeon you are in, built on the way in and kept until the run ends.
 *
 * Takes the map rather than its id, so generation never reaches back into the
 * registry that called it. The caller is holding it already.
 */
export function currentRun(source: GameMap, options?: AssembleOptions): GameMap {
  let map = runs.get(source.id);
  if (!map) {
    map = generateMap(source, options);
    runs.set(source.id, map);
  }
  return map;
}

/** Start the next one over. No argument ends every run there is. */
export function endRun(id?: string): void {
  if (id === undefined) runs.clear();
  else runs.delete(id);
}

// -------------------------------------------------------------- generation

/** Deterministic, so a seed is a layout you can go back to. */
function rngFrom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const shuffled = <T>(items: readonly T[], random: () => number): T[] => {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [out[i], out[j]] = [out[j]!, out[i]!];
  }
  return out;
};

const overlaps = (a: Rect, b: Rect) =>
  a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

/**
 * Fit one more part onto an open door, or say it could not be done.
 *
 * Tries every candidate part at every rotation, joined by every one of its own
 * doors — first fit wins, and the order is already shuffled, so "first" is
 * "random" without a second pass to pick from.
 */
function fitAgainst(
  door: OpenDoor,
  candidates: readonly ChunkPart[],
  placed: readonly Placement[],
  random: () => number,
): Fit | null {
  // The tile the new part's door has to occupy, and the way that door must
  // face: straight back at the one it is joining.
  const target = { gx: door.gx + door.dir.x, gy: door.gy + door.dir.y };
  const facing = { x: -door.dir.x, y: -door.dir.y };

  for (const part of candidates) {
    for (const k of shuffled([0, 1, 2, 3], random)) {
      const turned = rotatePart(part, k);
      for (const mine of shuffled(doorsOf(turned), random)) {
        if (mine.dir.x !== facing.x || mine.dir.y !== facing.y) continue;
        // Widths need not match. Two doorways are laid first tile to first
        // tile, so they meet over as many tiles as the narrower one has, and
        // whatever hangs off the end faces the other part's border wall — which
        // is a wall, so it is closed. A three-wide opening onto a two-wide one
        // is a two-wide opening, which is what it looks like.

        const rect = {
          x: target.gx - mine.gx,
          y: target.gy - mine.gy,
          w: colsOf(turned),
          h: turned.rows.length,
        };
        if (placed.some((other) => overlaps(rect, other.rect))) continue;

        return { part: turned, rect, joinedAt: mine };
      }
    }
  }
  return null;
}

/**
 * Assemble a cluster into one ordinary map object.
 *
 * The output is a map like any other — rows, prefabs — so
 * `createLevel` builds it with no idea it was generated, and everything
 * downstream of it (the World, collision, the editor's own preview) is the same
 * code that runs for a hand-written map.
 *
 * @param {string} id the cluster name
 * @param {object} options
 * @param {number} options.count how many parts to fit, default from the start
 *   part's `clusterSize`
 * @param {number} options.seed reproduces a layout exactly
 * @param {object[]} options.overrides parts being edited, each standing in for
 *   the saved file of the same id so unsaved edits can be walked. The editor
 *   holds the whole map open at once, so this takes the map rather than an id.
 */
export function generateMap(map: GameMap | null | undefined, options: AssembleOptions = {}): GameMap {
  if (!map) throw new Error('Nothing to generate: no such map');
  return assemble(map.id, chunksOf(map), { count: chunkCount(map), ...options });
}

/**
 * The generator itself, over a set of parts handed to it.
 *
 * Separate from the lookup above only so it can be run on parts that are not in
 * the registry — which is what a test does, and what the registry cannot offer
 * outside a browser anyway.
 */
/** How a run is put together: how many pieces, and from which seed. */
export type AssembleOptions = { count?: number; seed?: number };

/**
 * A map that was assembled rather than written.
 *
 * Both fields are optional on a map file, because a hand-written map has
 * neither -- but an assembled one always has both, and its callers read them.
 */
export type AssembledMap = GameMap & { rows: string[]; generated: GeneratedInfo };

export function assemble(
  id: string,
  all: readonly ChunkPart[],
  { count, seed = (Math.random() * 2 ** 32) >>> 0 }: AssembleOptions = {},
): AssembledMap {
  if (!all.length) throw new Error(`Cluster "${id}" has no parts`);

  const random = rngFrom(seed);
  // `all` is not empty, so there is a part to start from whether or not one
  // of them says it is the entrance.
  const start = all.find((part) => part.role === 'start') ?? all[0]!;
  const ends = all.filter((part) => part.role === 'end');
  const filler = all.filter((part) => part !== start && part.role !== 'end');
  const wanted = Math.max(1, count ?? DEFAULT_CHUNK_COUNT);

  const placed: Placement[] = [
    {
      part: start,
      rect: { x: 0, y: 0, w: colsOf(start), h: start.rows.length },
      isStart: true,
    },
  ];

  /**
   * Doors with nothing on the other side yet, in world tiles.
   *
   * Each carries the depth of the part it belongs to: how many doorways from
   * the entrance you had to walk through to be standing at it. That is the only
   * measure of "far away" that survives a layout folding back on itself, which
   * a straight-line distance does not.
   */
  let open = doorsOf(start).map((door) => ({ ...door, depth: 0 }));

  /**
   * Fit one more part on, taking the open doors in the order given.
   *
   * A door that nothing fits against is used up either way: nothing will ever
   * fit there, and leaving it in would mean trying it again for every part.
   */
  const attach = (
    candidates: readonly ChunkPart[],
    order: (doors: OpenDoor[]) => OpenDoor[] = (doors) => shuffled(doors, random),
  ): boolean => {
    for (const door of order(open)) {
      open = open.filter((other) => other !== door);

      const fit = fitAgainst(door, candidates, placed, random);
      if (!fit) continue; // that door is a dead end

      fit.depth = door.depth + 1;
      placed.push(fit);
      open = open.concat(
        // Not by identity: `doorsOf` builds fresh objects every call, so the
        // doorway just joined has to be recognised by where it is. Left in, it
        // would go back on the list as somewhere still open — and it is not,
        // there is a part standing against it.
        doorsOf(fit.part)
          .filter(
            (other) =>
              !(
                other.gx === fit.joinedAt.gx &&
                other.gy === fit.joinedAt.gy &&
                other.side === fit.joinedAt.side
              ),
          )
          .map((other) => ({
            ...other,
            gx: other.gx + fit.rect.x,
            gy: other.gy + fit.rect.y,
            depth: fit.depth ?? 0,
          })),
      );
      return true;
    }
    return false;
  };

  /** Deepest first, so the stair down is as far in as the layout allows. */
  const deepestFirst = (doors: OpenDoor[]) =>
    shuffled(doors, random).sort((a, b) => b.depth - a.depth);

  // Filler until the run is one short, then the way out — held back so the exit
  // is at the far end of what was built rather than the first thing you meet.
  while (placed.length < wanted - (ends.length ? 1 : 0)) {
    if (!filler.length || !attach(shuffled(filler, random))) break;
  }
  // Only if there is still room for it: a one-part run is the entrance and
  // nothing else, not the entrance plus the exit anyway.
  if (ends.length && placed.length < wanted) attach(shuffled(ends, random), deepestFirst);

  return compose(id, placed, start, seed);
}

/** How many doorways in from the entrance the deepest placed part is. */

/** Paste the placed parts into one grid, in one coordinate space. */
function compose(
  id: string,
  placed: readonly Placement[],
  start: ChunkPart,
  seed: number,
): AssembledMap {
  // One tile of rock all the way round the parts. Without it a door that
  // nothing was fitted against, on a part at the outer edge, is a floor tile on
  // the map's own boundary — walkable up to a wall that is not there, held back
  // only by being off the grid. With it, every unmatched door opens onto rock
  // and stops, which is what a bricked-up doorway looks like.
  const margin = 1;
  const minX = Math.min(...placed.map((p) => p.rect.x)) - margin;
  const minY = Math.min(...placed.map((p) => p.rect.y)) - margin;
  const cols = Math.max(...placed.map((p) => p.rect.x + p.rect.w)) - minX + margin;
  const rows = Math.max(...placed.map((p) => p.rect.y + p.rect.h)) - minY + margin;

  const grid = Array.from({ length: rows }, () => Array.from({ length: cols }, () => '.'));
  const covered = Array.from({ length: rows }, () => new Array(cols).fill(false));

  const generated: GeneratedInfo = {
    seed,
    parts: placed.length,
    endDepth: Math.max(0, ...placed.filter((e) => e.part.role === 'end').map((e) => e.depth ?? 0)),
  };

  const out = {
    id,
    // The place, not the piece you happen to arrive in: what the status line
    // says is "Dungeon", never "Dungeon Entrance".
    name:
      start.clusterName ??
      id.replace(/(^|-)(\w)/g, (_, sep, c) => (sep ? ' ' : '') + c.toUpperCase()),
    rows: [] as string[],
    spawns: {} as Record<string, Placed>,
    // Placements, carried through like anything else a part stands on. A room
    // built out of prefabs used to arrive empty; see the loop below.
    prefabs: [] as MapObject[],
    lights: [] as MapObject[],
    env: start.env,
    // Worth being able to read back: whether the stair down actually landed
    // somewhere deep is not something you can tell by looking at the map.
    generated,
  };

  // The moved lists are reached by name, which needs an index signature.
  const outLists = out as unknown as Record<string, MapObject[]>;

  for (const { part, rect, isStart } of placed) {
    const ox = rect.x - minX;
    const oy = rect.y - minY;

    part.rows.forEach((row, gy) => {
      [...row].forEach((char, gx) => {
        // Only the start part's '@' survives: it is where you arrive, and a
        // second one somewhere in the run would silently win the parse.
        grid[oy + gy]![ox + gx] = !isStart && char === SPAWN_CHAR ? '.' : char;
        covered[oy + gy]![ox + gx] = true;
      });
    });

    const move = <T extends Placed>({ gx, gy, ...rest }: T): T =>
      ({ ...rest, gx: gx + ox, gy: gy + oy }) as T;
    // `prefabs` was missing here once, and nothing said so: `rotatePart` turns
    // a chunk's placements correctly (there is a test), and then assembly threw
    // them away — a room built out of prefabs came through empty.
    for (const name of ['prefabs'] as const) {
      (outLists[name] ??= []).push(...(part[name] ?? []).map(move));
    }
    for (const [name, spawn] of Object.entries(part.spawns ?? {})) {
      // First writer wins, and the start part is first: it is the one holding
      // the spawn another map's teleport is aiming at.
      out.spawns[name] ??= move(spawn);
    }
    for (const light of part.lights ?? []) {
      // A sun and a sky fill light the whole map at once, so ten parts each
      // carrying one would be ten suns. Only the entrance's set the weather;
      // everything local — a torch glow, a spot — comes along from every part.
      const type = light.type;
      const global = type === 'directional' || type === 'hemisphere';
      if (!global || isStart) out.lights.push(move(light));
    }
  }

  // What no part covers used to be filled with wall objects, which is how an
  // unmatched door came to open onto rock and stop. There is no such thing as a
  // wall any more — one is a prefab like anything else — so a part that wants
  // its border sealed puts that prefab along it, the same as any other content.
  //
  // ponytail: an unmatched door now opens onto open ground rather than rock.
  // Sealing it again means either the fill placing a prefab this file would
  // have to be told the name of, or the terrain under an uncovered tile being
  // cut away — which is the same "there is no ground there" rule that already
  // stops you walking off the edge.

  out.rows = grid.map((row) => row.join(''));
  return out;
}
