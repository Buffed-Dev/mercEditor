import { PREFABS as GAME_PREFABS } from '#game';
import { MAP_LISTS, type GameMap, type MapObject } from './mapFormat.ts';
import { boundsOf, compose, type Transform } from './transform.ts';

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
 * A placement is a transform like any object's — see transform.ts — and the
 * children go through it: turned and scaled about the middle of the prefab's
 * own box, lifted, and stood with that box's corner on the placement's `gx`,
 * `gy`. About the middle, so turning a placement spins it where it stands
 * rather than swinging it round a corner; a box wider than it is tall then
 * overhangs its corner tile once turned, and `prefabBounds` says by how much.
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
/**
 * How close you must be to use one, in tiles, measured from its middle.
 *
 * On the prefab because it is a fact about the thing: a long bench is reachable
 * from further away than a lever, and neither of those is a fact about the
 * action. Left unset, the action says how far it reaches and the prefab's own
 * size is added to it, so a wide thing is not unreachable at one end.
 *
 * There is deliberately no "kind" beside this. A prefab used to carry one, to
 * decide which triggers it could be offered — Interactable, Creature and so on
 * — and it was a second place to say what the triggers already said, free to
 * disagree with them. What a prefab can do is now read off what is *on* it and
 * what is *in* it. See `eventApplies` in game/events/.
 */
/**
 * No name here. A prefab is one file rather than a folder, so what it is
 * called *is* what its file is called — named on the card in the library, the
 * way a file manager names a file, instead of in a box that is a second place
 * to say it from.
 */
export const PREFAB_FIELDS = {
  radius: { kind: 'range', label: 'Use from (tiles)', min: 0, max: 12, step: 0.5 },
  /**
   * Naming an archetype is what makes a prefab an actor: it spawns as one
   * body with that archetype's numbers, and the archetype's `brain` drives it.
   * Empty, and it is scenery — flattened onto the map like everything else.
   */
  archetype: { kind: 'archetype', label: 'Archetype' },
} as const;

export type Prefab = {
  id: string;
  label: string;
  /** The folder this record was found in. See `path` on Material. */
  path: string;
  /** The footprint, measured from the contents rather than authored. */
  w: number;
  h: number;
  /** Archetype id; set, this prefab is an actor. See PREFAB_FIELDS. */
  archetype?: string;
  /** Base-value overrides over the archetype's own, by attribute id. */
  attributes?: Record<string, number>;
} & { [K in PrefabList]: MapObject[] } & {
    /**
     * Whatever else the record carries — its triggers, most of all.
     *
     * Open for the same reason `MapObject` is: a record may hold fields this
     * file has never heard of, and they belong to whoever reads them. Saying so
     * here is what stops the next person narrowing it back down and quietly
     * dropping them again.
     */
    [key: string]: unknown;
  };

/** A prefab that spawns as a body rather than flattening into the map. */
export const isActorPrefab = (prefab: { archetype?: unknown }): boolean =>
  typeof prefab.archetype === 'string' && prefab.archetype !== '';

/** A prefab as its file writes it: every list optional, `w`/`h` ignored. */
export type PrefabInput = Partial<Omit<Prefab, PrefabList>> & {
  [K in PrefabList]?: readonly MapObject[];
};

/** One prefab standing on a map: which one, where, and which way round. */
export type PlacedPrefab = Transform & {
  id?: string;
  /** What this one of them says differently. See `override`. */
  set?: Record<string, unknown>;
};

/**
 * One placement's settings, laid over the prefab's own.
 *
 * The prefab holds the default — a portal that goes nowhere in particular, a
 * bench that opens crafting — and a placement says what *this* one of them
 * does. That is the whole of what makes a prefab worth placing twice: forty
 * doors out of one record, each leading somewhere else.
 *
 * **A key lands only on children that already carry it.** A prefab is a whole
 * arrangement, and one holding two portals has no defensible answer to which of
 * them you meant; guessing quietly is worse than doing the obvious thing to
 * both. Two that must differ are two prefabs, or a placement unpacked into its
 * objects — which the editor already offers.
 *
 * A key is a plain variable name and reaches wherever that name already sits:
 * on the child itself, or inside one of its wirings. Those are the two places a
 * variable lives — a portal keeps `to` as its own field, while an action chosen
 * in the inspector keeps its settings in the bag beside its name — and one rule
 * covering both beats a path syntax the person typing it has to get right.
 */
export function override<T extends Record<string, unknown>>(
  child: T,
  set: Record<string, unknown> | undefined,
): T {
  if (!set) return child;
  const out = { ...child } as Record<string, unknown>;
  /** One wiring, with the setting written in if it is one this wiring has. */
  const into = (one: unknown, key: string, value: unknown) =>
    one && typeof one === 'object' && key in one
      ? { ...(one as Record<string, unknown>), [key]: value }
      : one;

  for (const [key, value] of Object.entries(set)) {
    if (key in out && (out[key] === null || typeof out[key] !== 'object')) out[key] = value;
    for (const [name, held] of Object.entries(out)) {
      // A list of wirings: an event can run several actions, and a setting
      // reaches whichever of them declares it. Two that both take a `to` both
      // get it, for the same reason two children do.
      if (Array.isArray(held)) {
        out[name] = held.map((one) => into(one, key, value));
      } else if (held && typeof held === 'object') {
        out[name] = into(held, key, value);
      }
    }
  }
  return out as T;
}

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
    // Whatever else the record carries, kept. This used to name its fields and
    // nothing else, which quietly threw away anything it had not been told
    // about — a prefab's own triggers, most of all: they saved to the file
    // correctly and were stripped the moment it was read back, both here and in
    // the game, so a wired prefab did nothing and looked like it had never been
    // wired. Same whitelist mistake as the map serializer's, one file along.
    ...input,
    id: input.id ?? 'prefab',
    label: input.label ?? input.id ?? 'prefab',
    path: input.path ?? '',
    // Measured, never read: an authored footprint that disagreed with the
    // contents is exactly what deriving these prevents. So they come *after*
    // the spread, or a stale `w` in a file would win.
    w: all.length ? Math.max(...all.map((one) => one.gx)) + 1 : 0,
    h: all.length ? Math.max(...all.map((one) => one.gy)) + 1 : 0,
    // Likewise the lists: normalized copies, moved to their own corner.
    ...lists,
  } as Prefab;
}

export const PREFABS: Prefab[] = ((GAME_PREFABS as PrefabInput[]) ?? []).map(normalizePrefab);

const BY_ID = new Map(PREFABS.map((prefab) => [prefab.id, prefab]));

export const prefabById = (id: string): Prefab | null => BY_ID.get(id) ?? null;

/** How a prefab id is looked up, so a draft can answer instead of the game's. */
export type PrefabLookup = (id: string) => Prefab | null;

/**
 * One placement, as the objects it stands for.
 *
 * Each child goes through the placement's transform -- see `compose` -- about
 * the middle of the prefab's box, which is then stood on the placement's tile.
 * Turned first and moved second, because the turn is about the prefab: turning
 * after moving would swing it around the map's origin.
 *
 * Used by expansion and by unpacking both, so the arithmetic lives in one
 * place and a prefab exploded by hand is the same objects the game was drawing.
 */
export function prefabObjects(
  prefab: Prefab,
  at: PlacedPrefab,
): Record<string, MapObject[]> {
  // The pivot is the box's middle: children are measured from it, turned, and
  // the middle is put back where the box's corner says it goes.
  const pivot = { x: prefab.w / 2, y: prefab.h / 2 };
  const parent = { ...at, gx: at.gx + pivot.x, gy: at.gy + pivot.y };
  const lists: Record<string, MapObject[]> = {};
  for (const name of PREFAB_LISTS) {
    lists[name] = prefab[name].map(
      (one) => compose(parent, { ...one, gx: one.gx - pivot.x, gy: one.gy - pivot.y }) as MapObject,
    );
  }
  return lists;
}

/** The box a placement covers, once its turn and scale are taken into account. */
export function prefabFootprint(prefab: Prefab, at: PlacedPrefab): { w: number; h: number } {
  const { w, h } = boundsOf(at, prefab.w, prefab.h);
  return { w, h };
}

/**
 * Where that box is: its corner on the map, and its size. A turned placement
 * overhangs the tile its `gx`, `gy` names, so anything asking which tiles a
 * placement covers asks this rather than adding the footprint to the corner.
 */
export function prefabBounds(
  prefab: Prefab,
  at: PlacedPrefab,
): { gx: number; gy: number; w: number; h: number } {
  const box = boundsOf(at, prefab.w, prefab.h);
  return { gx: at.gx + box.minX, gy: at.gy + box.minY, w: box.w, h: box.h };
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
  /**
   * Which prefabs to dissolve. The game keeps actors whole — a body that
   * moves cannot be a handful of props on the floor — while the editor
   * flattens everything, because picking a part of one is how you select it.
   */
  flatten: (prefab: Prefab) => boolean = () => true,
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
    if (!spot || !prefab || !flatten(prefab)) return;

    for (const [name, list] of Object.entries(prefabObjects(prefab, spot as PlacedPrefab))) {
      for (const child of list) {
        // Which placement drew it, so the editor can resolve a pick on a child
        // back to the one thing you can select. Never written to a file: this
        // is the expanded copy, and the expanded copy is never what saves.
        added[name]?.push({ ...override(child, spot.set as Record<string, unknown>), prefab: index });
      }
    }
  });

  for (const name of PREFAB_LISTS) {
    if (!added[name].length) continue;
    const was = (map as Record<string, unknown>)[name] as readonly MapObject[] | undefined;
    out[name] = [...(was ?? []), ...added[name]];
  }

  return out as GameMap;
}
