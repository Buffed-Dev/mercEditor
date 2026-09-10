import { PREFABS as GAME_PREFABS } from '#game';
import { MAP_LISTS, type GameMap, type MapObject } from './mapFormat.ts';
import { turnLists } from './maps/rotate.ts';

/**
 * A prefab: an arrangement of objects, placed as one thing.
 *
 * A campfire is a fire, a light, three stones and a pot. Placed by hand that is
 * five things to get right and five things to get right again the next time,
 * and forty campfires is forty edits when the pot moves. A prefab is that
 * arrangement under one id, so the map holds one entry and editing the prefab
 * reaches every placement of it.
 *
 * **A prefab is a map with no terrain.** That is the whole design, and almost
 * everything follows from it: the contents are the map's own lists under the
 * map's own names, so the object tree walks it, the inspector edits it and the
 * editor's document opens it, none of them having to be told what a prefab is.
 *
 * No terrain, because a thing you drop anywhere cannot bring the ground with
 * it — and the ground already has an answer, which is a chunk (see
 * maps/chunks.ts). A prefab is what stands on the ground.
 *
 * Rotation is quarter turns and only quarter turns. The children sit on integer
 * tiles, so a prefab at forty-five degrees has nowhere to put them; there is no
 * representation for it and no amount of care in the placement UI invents one.
 * Worth knowing before somebody asks for the turn slider a prop has.
 */

/**
 * The lists a prefab carries: the map's own, plus the two that hang off a map
 * beside them.
 *
 * Not `decals`. Those are paint on the ground rather than things standing on
 * it, and the ground is not what a prefab brings.
 */
export const PREFAB_LISTS = [...MAP_LISTS, 'props', 'vfx'] as const;

export type PrefabList = (typeof PREFAB_LISTS)[number];

/**
 * What a prefab shows in the inspector, which is its name and nothing else.
 *
 * A prefab has no properties of its own — it is only its contents, and those
 * are edited by standing them on a grid rather than by typing numbers at them.
 * `w` and `h` are not here on purpose: they are measured from the contents (see
 * `normalizePrefab`), so there is nothing to type and nothing to drift.
 */
export const PREFAB_FIELDS = {
  label: { kind: 'text', label: 'Name' },
} as const;

export type Prefab = {
  id: string;
  label: string;
  /** The folder this record was found in. See `path` on Material. */
  path: string;
  /** The footprint, measured from the contents rather than authored. */
  w: number;
  h: number;
} & { [K in PrefabList]: MapObject[] };

/** A prefab as its file writes it: every list optional, `w`/`h` ignored. */
export type PrefabInput = Partial<Omit<Prefab, PrefabList>> & {
  [K in PrefabList]?: readonly MapObject[];
};

/** One prefab standing on a map: which one, where, and which way round. */
export type PlacedPrefab = {
  id?: string;
  gx: number;
  gy: number;
  /** Quarter turns clockwise, in degrees: 0, 90, 180 or 270. */
  rot?: number;
};

/**
 * One empty list per name.
 *
 * `fromEntries` forgets which keys it was handed, so the cast is what says
 * these are the nine PREFAB_LISTS — the names themselves are still read from
 * that one array, so there is no second copy to keep in step.
 */
const empty = (): { [K in PrefabList]: MapObject[] } =>
  Object.fromEntries(PREFAB_LISTS.map((list) => [list, [] as MapObject[]])) as unknown as {
    [K in PrefabList]: MapObject[];
  };

export function defaultPrefab(id = 'prefab'): Prefab {
  return { id, label: id, path: '', w: 0, h: 0, ...empty() };
}

/** A placed thing, or null if it is not one. Tiles have to be numbers. */
const placed = (entry: unknown): MapObject | null => {
  const value = entry as MapObject | null;
  return value && typeof value.gx === 'number' && typeof value.gy === 'number' ? value : null;
};

/**
 * A prefab read back from its file, measured and moved to its own corner.
 *
 * Offsets are tile-relative, and normalized here so the top-left of what is in
 * it is (0, 0) — the same thing `chunksOf` does when it cuts a chunk out. Two
 * prefabs built in different corners of a map are then the same prefab, and a
 * placement's position means the same thing for both.
 *
 * `w` and `h` fall out of that measurement. Deriving them rather than reading
 * them is what stops a footprint that says 3×2 from sitting over contents that
 * are 4×2, which nothing would notice until something refused to be placed
 * next to it.
 */
export function normalizePrefab(input: PrefabInput = {}): Prefab {
  const lists = empty();
  for (const name of PREFAB_LISTS) {
    for (const entry of input[name] ?? []) {
      const one = placed(entry);
      if (one) lists[name].push({ ...one });
    }
  }

  const all = PREFAB_LISTS.flatMap((name) => lists[name]);
  const minX = all.length ? Math.min(...all.map((one) => one.gx)) : 0;
  const minY = all.length ? Math.min(...all.map((one) => one.gy)) : 0;
  for (const one of all) {
    one.gx -= minX;
    one.gy -= minY;
  }

  return {
    id: input.id ?? 'prefab',
    label: input.label ?? input.id ?? 'prefab',
    path: input.path ?? '',
    w: all.length ? Math.max(...all.map((one) => one.gx)) + 1 : 0,
    h: all.length ? Math.max(...all.map((one) => one.gy)) + 1 : 0,
    ...lists,
  };
}

export const PREFABS: Prefab[] = ((GAME_PREFABS as PrefabInput[]) ?? []).map(normalizePrefab);

const BY_ID = new Map(PREFABS.map((prefab) => [prefab.id, prefab]));

export const prefabById = (id: string): Prefab | null => BY_ID.get(id) ?? null;

/** How a prefab id is looked up, so a draft can answer instead of the game's. */
export type PrefabLookup = (id: string) => Prefab | null;

/**
 * One placement, as the objects it stands for.
 *
 * Turned first and moved second, because the turn is about the prefab's own
 * corner: turning after moving would swing it around the map's origin.
 *
 * Used by expansion and by unpacking both, so the rotation lives in one place
 * and a prefab exploded by hand is the same objects the game was drawing.
 */
export function prefabObjects(
  prefab: Prefab,
  at: PlacedPrefab,
): Record<string, MapObject[]> {
  const lists: Record<string, MapObject[]> = {};
  for (const name of PREFAB_LISTS) lists[name] = prefab[name].map((one) => ({ ...one }));

  const turned = turnLists(lists, prefab.w, prefab.h, Math.round((at.rot ?? 0) / 90));
  for (const list of Object.values(turned.lists)) {
    for (const one of list) {
      one.gx += at.gx;
      one.gy += at.gy;
    }
  }
  return turned.lists;
}

/** The box a placement covers, once its turn is taken into account. */
export function prefabFootprint(prefab: Prefab, at: PlacedPrefab): { w: number; h: number } {
  const turns = Math.round((at.rot ?? 0) / 90);
  return ((turns % 4) + 4) % 4 === 0 || ((turns % 4) + 4) % 4 === 2
    ? { w: prefab.w, h: prefab.h }
    : { w: prefab.h, h: prefab.w };
}

/** How deep a prefab may reach through other prefabs. */
const MAX_DEPTH = 4;

/**
 * A map with its prefab placements turned into the objects they stand for.
 *
 * Done once, when the map is opened, rather than where it is drawn. Six
 * separate things read these lists — what blocks a tile, what can be stood on,
 * where the portals are, the monsters, the lights, and the view itself — and
 * expanding at the drawing end would fix what you see while leaving the player
 * walking through a prefab's boulder. Once `map.props` simply *has* the
 * children in it, none of those six needs to know prefabs exist at all. That is
 * the whole argument.
 *
 * **Children are appended, never inserted.** Every index into the original
 * lists stays what it was, which is what the editor's picking depends on: the
 * scene tags a wall with its index in the list it was drawn from, and a child
 * spliced in ahead of it would silently make that tag point at something else.
 * Treat it as a contract; there is a test holding it.
 *
 * A map with no placements comes back as itself, so nothing that has never seen
 * a prefab pays anything for them.
 */
export function expandPrefabs(
  map: GameMap,
  lookup: PrefabLookup = prefabById,
  depth = 0,
): GameMap {
  const placements = map.prefabs;
  if (!placements?.length || depth > MAX_DEPTH) return map;

  const out = { ...map } as Record<string, unknown>;
  const added: Record<string, MapObject[]> = {};
  for (const name of PREFAB_LISTS) added[name] = [];

  placements.forEach((at, index) => {
    const spot = placed(at);
    // A placement naming a prefab that is gone draws nothing, the same way a
    // prop naming a definition that is gone does. Silent and symmetrical.
    const prefab = spot?.id ? lookup(String(spot.id)) : null;
    if (!spot || !prefab) return;

    for (const [name, list] of Object.entries(prefabObjects(prefab, spot as PlacedPrefab))) {
      for (const child of list) {
        // Which placement drew it, so the editor can resolve a pick on a child
        // back to the one thing you can select. Never written to a file: this
        // is the expanded copy, and the expanded copy is never what saves.
        added[name]?.push({ ...child, prefab: index });
      }
    }
  });

  for (const name of PREFAB_LISTS) {
    if (!added[name].length) continue;
    const was = (map as Record<string, unknown>)[name] as readonly MapObject[] | undefined;
    out[name] = [...(was ?? []), ...added[name]];
  }

  // A door is a hole in a wall, so a prefab door landing on a map's wall has to
  // take it with it. The editor already refuses to leave the two on one tile
  // (see `place` in editor/document.ts), but that rule runs when you draw and
  // this is the one moment the two lists meet without anybody drawing.
  const doors = out.doors as readonly MapObject[] | undefined;
  const walls = out.walls as readonly MapObject[] | undefined;
  if (doors?.length && walls?.length) {
    const holes = new Set(doors.map((door) => `${door.gx},${door.gy}`));
    out.walls = walls.filter((wall) => !holes.has(`${wall.gx},${wall.gy}`));
  }

  return out as GameMap;
}
