import { defaultLight } from '../src/data/lights.ts';
import { defaultChunk } from '../src/data/maps/chunks.js';
import { DEFAULT_ENV, normalizeEnv } from '../src/data/mapFormat.js';
import { decodeTerrain } from '../src/data/terrain/codec.ts';
import { resizeGrid, idx, levelAt, kindAt, EMPTY } from '../src/data/terrain/grid.ts';
import { createHistory } from './history.ts';
import { beginStroke } from './terrain/stroke.ts';

/**
 * The map being edited: a deep copy of a map module that the editor mutates
 * freely. Nothing here touches the live map objects the game imported, so
 * abandoning an edit costs nothing and a bad edit cannot corrupt a loaded map.
 *
 * Terrain lives in the ASCII rows; everything else (torches, portals,
 * monsters, named spawns) is an object list keyed by tile, exactly as in a
 * hand-written map file.
 */

/**
 * Everything the Paint tool can put down.
 *
 * Shaping the ground is not in here, because it is not something you place —
 * it is a height, and it belongs to a tool of its own with a level beside it.
 * What is left is a flat list of things that stand *on* the ground, none of
 * which carry a level: they sit on whatever the terrain under them happens to
 * be, which is what lets a wall and a hillside be edited independently.
 *
 * The spawn marker is here despite living in the grid rather than in a list.
 * It is a thing you place on a tile, which is what the palette is for; where
 * it is stored is the format's business, not the palette's.
 */
/**
 * The asset catalogue: everything that can be put on a map.
 *
 * One flat list with a `group` on each, rather than a set of lists the panel
 * knows the names of — so a new kind of thing is a line here and appears in the
 * editor without the editor being told about it. `list` is where an instance of
 * it is stored and `kind` is which sort of that list's thing it is; between
 * them, placing is one path however many assets there are.
 *
 * `group` is only how the panel arranges them. It carries no meaning further
 * in: two assets in one group have nothing in common but a heading.
 */
export const ASSET_GROUPS = [
  ['structure', 'Structure'],
  ['actors', 'Actors'],
  ['fixtures', 'Fixtures'],
  ['layout', 'Layout'],
];

export const ASSETS = [
  { id: 'wall', label: 'Wall', list: 'walls', group: 'structure', icon: 'stack-2' },
  { id: 'door', label: 'Door', list: 'doors', group: 'structure', icon: 'door' },
  { id: 'portal', label: 'Portal', list: 'portals', group: 'structure', icon: 'door' },

  { id: 'grunt', label: 'Grunt', list: 'monsters', kind: 'grunt', group: 'actors', icon: 'ghost' },
  { id: 'brute', label: 'Brute', list: 'monsters', kind: 'brute', group: 'actors', icon: 'ghost' },
  // A vase is a monster that cannot move or see — see game/monsters.js — so it
  // is placed out of the same list and needs nothing else here.
  { id: 'vase', label: 'Vase', list: 'monsters', kind: 'vase', group: 'actors', icon: 'box' },

  { id: 'light', label: 'Light', list: 'lights', group: 'fixtures', icon: 'sun' },
  { id: 'torch', label: 'Torch', list: 'torches', group: 'fixtures', icon: 'flame' },
  { id: 'vfx', label: 'Effect', list: 'vfx', group: 'fixtures', icon: 'sparkles' },
  { id: 'station', label: 'Station', list: 'stations', group: 'fixtures', icon: 'hammer' },
  { id: 'prop', label: 'Object', list: 'props', group: 'fixtures', icon: 'box' },

  { id: 'chunk', label: 'Chunk', list: 'chunks', group: 'layout', icon: 'stack-2' },
  // Where the player comes up. Not one of the named spawns beside it: those are
  // where a portal puts you, and every map has exactly one of these.
  { id: 'spawn', label: 'Start', group: 'layout', icon: 'target-arrow' },
];


const UNDO_LIMIT = 60;

/** "chunk", "chunk2", "chunk3"… — the first name not already taken. */
function freshChunkName(chunks) {
  const taken = new Set(chunks.map((c) => c.name));
  if (!taken.has('chunk')) return 'chunk';
  for (let n = 2; ; n++) if (!taken.has(`chunk${n}`)) return `chunk${n}`;
}

// structuredClone, not a JSON round trip: the terrain grid is typed arrays and
// JSON would quietly turn each one into an object keyed by index.
const clone = (value) => structuredClone(value);

/**
 * A fresh map: an empty grid.
 *
 * Empty rather than a floor inside a wall border, because empty is now a real
 * state. A new map is space to build in, and the first thing you do is paint
 * an island into it — which is a different and better start than being handed
 * a rectangle and having to carve it down.
 */
export function blankMap(id, cols = 24, rows = 24) {
  return {
    id,
    name: id.replace(/(^|-)(\w)/g, (_, sep, c) => (sep ? ' ' : '') + c.toUpperCase()),
    terrainKeys: {},
    height: Array.from({ length: rows }, () => '.'.repeat(cols)),
    terrain: Array.from({ length: rows }, () => '..'.repeat(cols)),
    spawns: {},
    walls: [],
    doors: [],
    portals: [],
    monsters: [],
    torches: [],
    stations: [],
    chunks: [],
    lights: [],
    vfx: [],
    props: [],
    env: { ...DEFAULT_ENV },
  };
}

export function createDocument(map) {
  // The terrain grid is decoded once and then never replaced, only written
  // into. Its identity has to be stable because undo entries hold a reference
  // to it: swapping the object under them would leave older entries writing
  // into a grid nobody is looking at any more.
  const decoded = decodeTerrain(map);
  const terrain = decoded.grid;
  /** Terrain ids by grid value - 1. Append-only: an index in use is forever. */
  const terrainIds = [...decoded.terrainIds];

  const doc = clone({
    id: map.id,
    name: map.name,
    spawns: map.spawns ?? {},
    walls: (map.walls ?? []).map((wall) => ({
      ...wall,
      stack: Math.max(1, Math.round(wall.stack ?? 1)),
    })),
    // Whether what you walk is this grid or something assembled from the
    // chunks drawn on it. Off on an ordinary map, and the chunks stay put
    // either way — the switch is a switch, not a delete.
    generated: Boolean(map.generated),
    chunkCount: map.chunkCount ?? 0,
    // How high the player comes up above the tile the start is on. A number on
    // the map rather than on the start itself, because the start is a character
    // in the terrain and a character has nowhere to keep one.
    startZ: map.startZ ?? 0,
    // How the platform's exposed edge rolls over into its cliff. Absent on a
    // map that has never been tuned, which reads as the default profile.
    terrainRim: map.terrainRim ?? null,
    // The most a step can rise and still be walkable, in levels.
    stepHeight: map.stepHeight ?? 1,
    chunks: map.chunks ?? [],
    doors: map.doors ?? [],
    portals: map.portals ?? [],
    monsters: map.monsters ?? [],
    torches: map.torches ?? [],
    stations: map.stations ?? [],
    lights: map.lights ?? [],
    vfx: map.vfx ?? [],
    props: map.props ?? [],
    env: normalizeEnv(map.env),
  });
  doc.terrain = terrain;
  doc.terrainIds = terrainIds;

  const history = createHistory(UNDO_LIMIT);

  /**
   * Everything except the terrain grid, which is undone by strokes instead.
   *
   * Keeping the grid out of snapshots is what lets the two kinds of entry share
   * one stack safely: a snapshot restores object lists into the same `doc`, and
   * the grid a stroke is holding is never swapped out from under it.
   */
  const snapshot = () => {
    const { terrain: _grid, ...rest } = doc;
    return clone(rest);
  };
  const restore = (state) => {
    for (const key of Object.keys(state)) doc[key] = state[key];
  };

  /**
   * Snapshot before a mutation, so every edit is exactly one undo step.
   *
   * `checkpointed` is false when a caller is making many writes that belong to
   * one gesture; it takes the snapshot itself, once, before the first.
   */
  function checkpoint(checkpointed = true) {
    if (!checkpointed) {
      history.touch();
      return;
    }
    const before = snapshot();
    let after = null;
    history.push({
      label: 'edit',
      // A snapshot cannot say which cells moved, so it carries no rectangle and
      // undoing one rebuilds the whole view. That is correct, and it is why
      // terrain does not use this path.
      undo() {
        after = snapshot();
        restore(before);
      },
      redo() {
        restore(after);
      },
    });
  }

  const inBounds = (gx, gy) => gx >= 0 && gy >= 0 && gx < terrain.cols && gy < terrain.rows;

  /** Objects sitting on a tile, across every object list. */
  function objectsAt(gx, gy) {
    // Chunks are not in this list on purpose: they are rectangles you draw
    // things *inside*, so a tile being in one must not stop anything landing
    // on it.
    return ['torches', 'portals', 'monsters', 'lights', 'vfx', 'doors', 'stations', 'props']
      .flatMap((list) => doc[list].map((entry) => ({ list, entry })))
      .filter(({ entry }) => entry.gx === gx && entry.gy === gy);
  }

  /** How many wall blocks stand on a tile. */
  function wallAt(gx, gy) {
    return doc.walls.find((wall) => wall.gx === gx && wall.gy === gy) ?? null;
  }

  /**
   * The grid value for a terrain id, adding it to the map's table if new.
   *
   * The table is append-only. An index that has ever been written into the grid
   * has to keep meaning the same thing forever, so ids are never removed and
   * never reordered — an unused entry in a saved map's legend is a line of
   * noise, and renumbering would repaint every cell that used it.
   */
  function kindOf(id) {
    if (!id) return EMPTY;
    const at = terrainIds.indexOf(id);
    if (at >= 0) return at + 1;
    terrainIds.push(id);
    return terrainIds.length;
  }

  /** Which terrain is on a tile, as an id, or '' where there is no cell. */
  function terrainAt(gx, gy) {
    const kind = kindAt(terrain, gx, gy);
    return kind === EMPTY ? '' : (terrainIds[kind - 1] ?? '');
  }

  return {
    /**
     * The tile the player comes up on.
     *
     * A named spawn like any other now. It used to be a character in the
     * terrain grid, which meant the grid had to carry something that was not
     * terrain, and only one of them could exist because only one character
     * could be found by searching.
     */
    get start() {
      return doc.spawns.default ?? null;
    },
    setStart(gx, gy) {
      checkpoint();
      doc.spawns.default = { gx, gy };
      return true;
    },
    // Public so that an edit spanning several objects can be one undo step:
    // take the snapshot once, then write them all uncheckpointed.
    checkpoint,
    get map() {
      return doc;
    },
    get cols() {
      return terrain.cols;
    },
    get rows() {
      return terrain.rows;
    },
    /** The live grid. Written through strokes; never replaced. */
    get terrain() {
      return terrain;
    },
    get terrainIds() {
      return terrainIds;
    },
    /** Problems found while reading the map, as sentences naming where. */
    get problems() {
      return decoded.problems;
    },
    get dirty() {
      return history.dirty;
    },
    get canUndo() {
      return history.canUndo;
    },
    get canRedo() {
      return history.canRedo;
    },

    inBounds,
    objectsAt,

    kindOf,
    terrainAt,
    levelAt: (gx, gy) => levelAt(terrain, gx, gy),

    /**
     * Open a terrain gesture. Every write goes through it, and `commit` turns
     * the whole gesture into one undo step.
     */
    beginStroke: (label) => beginStroke(terrain, label),

    /** Close a gesture. Returns the rectangle it changed, or null. */
    commit(stroke) {
      const entry = stroke?.commit();
      if (!entry) return null;
      history.push(entry);
      return entry.rect;
    },

    /**
     * Put something on the ground. Returns an error string, or null on success.
     *
     * Walls are the one thing that stacks: dropping a wall on a wall makes it
     * taller rather than refusing, which is how a low barrier becomes a tower
     * without a separate control for its height.
     */
    place(gx, gy, brush, options = {}) {
      if (!inBounds(gx, gy)) return 'Outside the map';
      const wall = wallAt(gx, gy);

      if (brush.list === 'walls') {
        checkpoint();
        if (wall) wall.stack = Math.max(1, Math.round(wall.stack ?? 1)) + 1;
        else doc.walls.push({ gx, gy, stack: 1 });
        return null;
      }

      // A door is a hole in a wall, so it takes the wall with it rather than
      // refusing to go where one is. Every door belongs on a part's border and
      // a border is walls, so the rule below would otherwise refuse every door
      // there is anywhere to put one.
      if (brush.list === 'doors') {
        if (doc.doors.some((door) => door.gx === gx && door.gy === gy)) {
          return 'There is already a door there';
        }
        checkpoint();
        if (wall) doc.walls = doc.walls.filter((candidate) => candidate !== wall);
        doc.doors.push({ gx, gy });
        return null;
      }

      // A torch mounts on a wall's face, so it needs one to hang from.
      if (brush.id === 'torch' && !wall) return 'Torches mount on a wall';
      if (brush.id !== 'torch' && brush.id !== 'light' && brush.id !== 'vfx' && wall) {
        return 'There is a wall on that tile';
      }
      // One object may stand on another — that is what a placement's lift is
      // for — so a tile with nothing but objects on it is not full. Anything
      // else there still is: a portal, a monster or a station is a place rather
      // than a thing, and two of those on one tile is a mistake either way.
      const sitting = objectsAt(gx, gy);
      const stacking = brush.list === 'props' && sitting.every(({ list }) => list === 'props');
      if (sitting.length && !stacking) return 'Something is already on that tile';

      checkpoint();
      if (brush.list === 'props') {
        // Which object it is comes from the inspector, the same way an effect's
        // does: the palette has no picker for it, so placing is placing and
        // choosing is choosing.
        // Stood on top of whatever is already there rather than inside it. One
        // unit up, because a tile is one unit across and most things made for
        // one are about that tall — it is a starting height, and the Lift
        // slider in the inspector is what makes it right.
        const under = sitting.map(({ entry }) => entry.lift ?? 0);
        doc.props.push({
          id: options.propId ?? '',
          gx,
          gy,
          rot: 0,
          ...(under.length ? { lift: Math.max(...under) + 1 } : {}),
        });
      } else if (brush.list === 'vfx') {
        // No effect chosen here: the palette has no picker for it and the
        // inspector's dropdown is one click away, so placing is placing and
        // choosing is choosing.
        doc.vfx.push({ id: options.vfxId ?? '', gx, gy });
      } else if (brush.list === 'lights') {
        doc.lights.push(defaultLight(options.lightType ?? 'point', gx, gy));
      } else if (brush.list === 'torches') {
        doc.torches.push({ gx, gy, face: options.face ?? '+x', radius: 5 });
      } else if (brush.list === 'portals') {
        doc.portals.push({
          gx,
          gy,
          to: options.to ?? '',
          spawn: options.spawn ?? 'default',
          color: options.color ?? 0x9d6bff,
          label: options.label ?? options.to ?? 'Portal',
        });
      } else if (brush.list === 'chunks') {
        doc.chunks.push({ ...defaultChunk(gx, gy), name: freshChunkName(doc.chunks) });
      } else if (brush.list === 'stations') {
        doc.stations.push({ gx, gy, label: options.label ?? 'Crafting bench' });
      } else {
        doc.monsters.push({ gx, gy, kind: brush.kind });
      }
      return null;
    },

    /** How many wall blocks stand on a tile, 0 for none. */
    wallStack(gx, gy) {
      const wall = wallAt(gx, gy);
      return wall ? Math.max(1, Math.round(wall.stack ?? 1)) : 0;
    },

    /**
     * Clear a tile of everything standing on it, in one go.
     *
     * Every object and the whole wall stack, however tall. Taking a tower down
     * a block at a time was tidier in principle and worse to use: the eraser's
     * job is "make this tile empty", and needing six clicks to find out whether
     * it is empty yet is not that.
     *
     * The ground itself is untouched — its height is the Terrain tool's, and
     * that tool can lower a tile as easily as it raises one.
     */
    erase(gx, gy) {
      const hits = objectsAt(gx, gy);
      const wall = wallAt(gx, gy);
      if (!hits.length && !wall) return false;

      checkpoint();
      for (const { list, entry } of hits) {
        doc[list] = doc[list].filter((candidate) => candidate !== entry);
      }
      if (wall) doc.walls = doc.walls.filter((candidate) => candidate !== wall);
      return true;
    },

    /** Name a tile as an arrival point that other maps' portals can target. */
    nameSpawn(name, gx, gy) {
      checkpoint();
      doc.spawns[name] = { gx, gy };
    },

    /** `checkpointed` is false when the caller is deleting a batch as one step. */
    removeSpawn(name, checkpointed = true) {
      if (checkpointed) checkpoint();
      delete doc.spawns[name];
    },

    /**
     * Grow or crop the grid, anchored at the top-left.
     *
     * New cells are empty rather than ground at level 0. Growing a map should
     * reveal space to build in, not conjure a floor across it — which is what
     * the old resize did, back when every cell had to have a height.
     *
     * Anything standing outside the new bounds is dropped, since keeping it
     * would write coordinates no tile can hold.
     */
    resize(cols, rows) {
      if (cols === terrain.cols && rows === terrain.rows) return;

      const before = {
        cols: terrain.cols,
        rows: terrain.rows,
        level: terrain.level,
        kind: terrain.kind,
      };
      checkpoint();
      const next = resizeGrid(terrain, cols, rows);
      Object.assign(terrain, next);

      // The grid is not in the snapshot, so resize puts back its own arrays.
      const after = { cols, rows, level: next.level, kind: next.kind };
      history.push({
        label: 'resize',
        undo: () => Object.assign(terrain, before),
        redo: () => Object.assign(terrain, after),
      });

      const keep = (o) => o.gx < cols && o.gy < rows;
      // Props were missed here before, which is how base.js came to carry
      // entries at gy 21-25 on an 18-row map.
      doc.torches = doc.torches.filter(keep);
      doc.doors = doc.doors.filter(keep);
      doc.portals = doc.portals.filter(keep);
      doc.monsters = doc.monsters.filter(keep);
      doc.stations = doc.stations.filter(keep);
      doc.chunks = doc.chunks.filter(keep);
      doc.lights = doc.lights.filter(keep);
      doc.vfx = doc.vfx.filter(keep);
      doc.walls = doc.walls.filter(keep);
      doc.props = doc.props.filter(keep);
      for (const [name, spawn] of Object.entries(doc.spawns)) {
        if (!keep(spawn)) delete doc.spawns[name];
      }
    },

    /**
     * What is on a tile, as a selection: the list it lives in and its index.
     * Named spawns come back keyed by name instead, since that is how they are
     * addressed. Returns null for a bare tile.
     */
    selectionAt(gx, gy) {
      // Walls come last on purpose. A torch is mounted on a wall and a light
      // hangs off one, so on a shared tile the small thing in front is the one
      // you meant; the wall is what is left when there is nothing on it.
      // Chunks come last: they are big, and anything standing inside one is
      // what you meant to click.
      for (const list of [
        'lights',
        'vfx',
        'portals',
        'monsters',
        'stations',
        'doors',
        'torches',
        'walls',
        'chunks',
      ]) {
        const index = doc[list].findIndex((entry) => entry.gx === gx && entry.gy === gy);
        if (index >= 0) return { list, index };
      }
      const spawn = Object.entries(doc.spawns).find(([, s]) => s.gx === gx && s.gy === gy);
      return spawn ? { list: 'spawns', key: spawn[0] } : null;
    },

    /**
     * Add a chunk, and say where it landed.
     *
     * Placed at the origin rather than under the cursor, because this is the
     * button in a panel rather than the brush on the map — there is no tile
     * being pointed at. You drag it where it goes, which is the same gesture
     * that moves everything else.
     */
    addChunk() {
      checkpoint();
      doc.chunks.push({ ...defaultChunk(0, 0), name: freshChunkName(doc.chunks) });
      return doc.chunks.length - 1;
    },

    /**
     * Change one object in one of the indexed lists. `checkpointed` is false
     * while a slider is being dragged, so a drag leaves a single undo step
     * rather than one per pixel.
     */
    updateObject(list, index, patch, checkpointed = true) {
      const entry = doc[list]?.[index];
      if (!entry) return null;
      if (checkpointed) checkpoint();

      // A light's type decides which fields it has, so switching type starts
      // from that type's defaults instead of carrying stale fields across.
      if (list === 'lights' && patch.type && patch.type !== entry.type) {
        doc.lights[index] = defaultLight(patch.type, entry.gx, entry.gy);
        return doc.lights[index];
      }

      Object.assign(entry, patch);
      return entry;
    },

    /**
     * Move an object to another position in its own list.
     *
     * Only within one list, because that is all the file has to say it with: an
     * object's place in the map is its index in `map.lights` or `map.props`,
     * and there is no ordering *between* those lists to change. Dragging a
     * light above a prop in the panel is therefore a grouping, not a reorder,
     * and the panel treats it as one.
     */
    reorderObject(list, from, to) {
      const entries = doc[list];
      if (!Array.isArray(entries)) return false;
      if (from === to || from < 0 || to < 0 || from >= entries.length || to >= entries.length) {
        return false;
      }
      checkpoint();
      const [moved] = entries.splice(from, 1);
      entries.splice(to, 0, moved);
      return true;
    },

    removeObject(list, index, checkpointed = true) {
      if (!doc[list]?.[index]) return false;
      if (checkpointed) checkpoint();
      doc[list].splice(index, 1);
      return true;
    },

    /**
     * Raise or lower a column by a level, within 0 and `max`.
     *
     * Only cells that exist move: raising empty space would be inventing
     * terrain, which is what the paint tool is for.
     */
    raiseGround(gx, gy, delta, max = 9, stroke = null) {
      const level = levelAt(terrain, gx, gy);
      if (level === null) return false;
      const next = Math.min(max, Math.max(0, level + delta));
      if (next === level) return false;
      const own = stroke ?? beginStroke(terrain, 'height');
      const i = idx(terrain, gx, gy);
      own.set(gx, gy, next, terrain.kind[i]);
      if (!stroke) this.commit(own);
      return true;
    },

    /** Rename a named spawn, keeping its position. Returns an error or null. */
    renameSpawn(from, to) {
      const name = to.trim();
      if (!name) return 'A spawn needs a name';
      if (name === from) return null;
      if (doc.spawns[name]) return `There is already a spawn called "${name}"`;
      checkpoint();
      doc.spawns[name] = doc.spawns[from];
      delete doc.spawns[from];
      return null;
    },

    /** Move a named spawn to a tile. */
    moveSpawn(name, gx, gy, checkpointed = true) {
      if (!doc.spawns[name]) return;
      if (checkpointed) checkpoint();
      doc.spawns[name] = { gx, gy };
    },

    /**
     * `checkpointed` is false while a value is still moving, the same way
     * `updateObject` takes it: the caller snapshots once before the gesture
     * starts and writes every intermediate value uncheckpointed, so a drag
     * across a slider is one undo step rather than one per pixel.
     */
    setEnv(key, value, checkpointed = true) {
      checkpoint(checkpointed);
      doc.env[key] = value;
    },

    setMeta(key, value, checkpointed = true) {
      checkpoint(checkpointed);
      doc[key] = value;
    },

    /**
     * Step back. Returns the rectangle that changed, `null` when the whole
     * document did, or `false` when there was nothing to undo — so the caller
     * can rebuild only what moved.
     */
    undo() {
      return history.undo();
    },

    redo() {
      return history.redo();
    },

    markSaved() {
      history.markSaved();
    },

    /**
     * Hear about every change to this document.
     *
     * Every edit goes through the history, so that is where the signal comes
     * from and this only passes it on. What listens is an interface that draws
     * itself from state and needs to know when the state moved.
     *
     * @returns a function that stops listening.
     */
    subscribe: (listener) => history.subscribe(listener),

    /** How many times this document has changed. See history.ts. */
    get revision() {
      return history.revision;
    },
  };
}
