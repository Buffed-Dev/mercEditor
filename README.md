# Merc

An isometric action-RPG prototype: **Babylon.js**, **Vite** and plain
JavaScript, built out of 3D primitives with a map editor and a rules editor
inside the game.

## Run it

```bash
npm install
npm run dev
```

`npm run build` produces the bundle; `npm run preview` serves it.

## Controls

| Key | Action |
| --- | --- |
| `W` `A` `S` `D` | Move (camera-relative — `W` is always up-screen) |
| `Space` / left mouse | Slot 0 — held, it re-attempts every frame at the cooldown's pace |
| Right mouse | Slot 1 |
| `C` | Character sheet |
| `K` | Abilities — drag one onto a key to bind it |
| `F3` | Show or hide ability telegraphs |
| `Enter` / `Space` / click **PLAY** | Start |
| `Esc` | Back to the menu |

Items: left-click or drag lifts one onto the cursor, right-click equips it, and
a click on an equipment slot, an inventory cell or the ground puts it down
there. A press that lands on the interface but not on a cell puts it back where
it came from rather than throwing it on the floor.

## The editor

The editor is not part of the game. It is a separate program at
`/editor.html`, served only in development, and it opens a **game folder**:
a manifest, a `maps/` folder and a `rules/` folder.

It opens on a **home screen** — a card for every folder under `Games/`, saying
what the game calls itself, where it is and how many maps it has. Click one to
edit it. Nothing 3D is loaded for that screen, so it comes up at once; the
editor itself is fetched only once a game is picked.

Inside, the folder picker in the top bar moves between games without going back
— **All games…** returns to the home screen, and **New game…** starts one by
copying the game that is open, because a blank folder would have no attributes
and no maps, which is not something the editor can open.

It has three workspaces. **Map** edits the terrain, lights and objects of one
map; **Rules** edits the attributes, effects, abilities, archetypes and items
that govern actors, and never touches a map; **VFX** is a library of particle
effects, each shown running while you tune it — fifteen sliders describe a puff
of smoke and none of them tell you what it looks like, which is why that one has
a viewport. VFX and Rules are two views of one document, so an effect is saved
and undone with the rules beside it. All three share one shell — the switch in
the top bar moves between them.

An effect is named rather than copied: a map places one on a tile (a fire, a
shine on a chest) and an ability names the one it throws when it lands, and both
are the same definition.

**Playtest** saves and opens the game in a new tab. The game reads the folder off
disk, so writing the file is how the two are joined; there is no shared level to
hand an unsaved map to. It plays whichever game the dev server was started for,
so playing another one is `GAME=<id> npm run dev`.

Inside the editor: `Ctrl+S` saves, `Ctrl+K` opens the palette — type the name of
any map or any rule to go straight to it — `Ctrl+Z` / `Ctrl+Shift+Z` undo and
redo, `Del` removes the selected object, `F` frames the whole map, and `1`–`9`
pick a brush.

Every number in the editor is one control: the field's name on the left, the
value on the right, filled to where that value sits between its ends. **Drag it
to sweep, click it to type** — `Shift` for a tenth of a step, `Ctrl` for ten.

## Layout

```
index.html          the game: its canvas, menu, character sheet, fault banner
editor.html         the editor: a development tool, never in a build
Engine/             everything that is not a particular game
  src/              the runtime a game runs on, and the game built on it
    main.js         the application: bootstrap, input wiring, the frame's work
    data/           schema and defaults — no game logic, no rendering
      maps/         the map registry; generate.js assembles chunks
    game/           the simulation. No Babylon anywhere in here.
    render/         Babylon: the engine, the scene, the map, the views
    gui/            Babylon GUI: the read-outs and the item name plates
    ui/             DOM: the character sheet, the cursor, input
  editor/           the tool the games are made with
    main.js         which screen: the home screen, or a game's workspace
    games.js        the shelf: what games there are, opening and starting one
    home.js         the home screen — a card per folder under Games/
    workspace.js    the editor pointed at one game; everything Babylon
    ui.js editor.js the map and rules workspaces, sharing one shell
    vfxMode.js      the VFX workspace: the library, and one effect running
Games/
  Merc/             a game: everything about it that is not code
    game.js         the manifest — its id, its label, where it starts
    maps/           map modules, found by the manifest's glob
    rules/          the values the rules editor writes back
```

Five rules hold the shape together:

- **`src/game/` never imports Babylon.** The simulation is grid coordinates,
  attributes and effects; it does not know it is being drawn.
- **`src/render/` never decides anything.** It is told where things are.
- **`src/data/` imports neither.** It is the schema and the defaults, so the editors
  and the game read the same definitions.
- **`main.js` joins them up.** Nothing else knows about more than one layer.
- **Nothing under `src/` imports `editor/`.** The arrow points one way: the
  editor reaches into the engine to draw what a map means, and the game never
  reaches back. `vite build` takes `index.html` alone, so a published game has
  no editor in it and no way to ask for one.

A game folder is content, not code — the files under `maps/` and `rules/` have
no imports at all. `#game` is how the runtime asks for the one it was built for,
answered by `vite.config.js` (`GAME=other npm run dev`) and by package.json's
`imports` for plain Node. A second game is a second folder.

## The engine

`render/engine.js` owns the Babylon `Engine`, the one `Scene`, the isometric
camera and the render loop. There is exactly one of each for the life of the
application.

A level is **not** a Scene. It is a subtree under its own `TransformNode`, built
when a map loads and disposed when it unloads; the map editor mounts its own
root the same way and the game's is switched off while it is up. That is what
lets the camera, the shadow configuration and the post-processing pipeline be
built once and never rebuilt.

The scene is **right-handed**, matching the convention the gameplay code already
uses: `gx → x`, `gy → z`, `y` up, and a heading is `atan2(dx, dz)`. Babylon
supports both; picking the one the simulation already speaks means no axis is
flipped anywhere between the grid and the screen. One consequence to know about:
Babylon's own mesh builders wind their triangles the opposite way round from
three.js, so `render/terrain.js` — the only geometry built by hand — winds to
match, and computes its normals accordingly.

The camera is **orthographic**, looking down the `(1, 1, 1)` diagonal. It moves
but never turns, which is why billboarding is a constant quaternion rather than
a per-frame recomputation, and why a spark can be a fixed world size and still
look the same size everywhere on screen.

Babylon owns the loop, so there is one animation frame in the whole application
and one source of delta time. The per-frame work is wrapped: a throw is reported
in the banner and the loop carries on, because a frozen window with nothing on
screen to explain it is the worst way to find a bug.

**Shaders are compiled up front.** A material is not drawn at all until its
shader is ready, and which shaders a map needs depends on the lights it places —
so the map you start on cannot warm up the others. `warmMaps` in `src/main.js`
builds each one for a moment while the menu is still up, and the ground is drawn
with a single material for the whole application rather than one per map, since
`PBRCustomMaterial` registers a fresh shader name per instance and would
recompile a large shader on every map load. Between them, a portal transition
now compiles nothing. `goToMap` still waits for the scene behind its own black
screen, so anything missed arrives before the fade lifts rather than after.

## Rendering

**Terrain** (`render/terrain.js`) is one mesh built from the height of each
tile's four corners. There is no ramp geometry and no corner piece, because
there is nothing to choose between: a tile is two triangles creased along one of
its diagonals, and its corners sit wherever the corner heights put them. Four
equal corners make flat ground, two high and two low make a ramp, and one high
corner makes a pyramid hip. The three cases people usually hand-author are the
same case.

Which diagonal the crease runs along is `foldsOnMainDiagonal` in
`game/world.js`, and it goes where the corners disagree most. That is what makes
a plateau's outside corner a pyramid — two ramp planes meeting along a hip that
runs all the way out to the corner — rather than a tile that is half flat with
the ramp apparently stopping in its middle.

`World.heightAt` reads those same two planes through the same predicate, so the
surface you stand on *is* the surface you can see: exactly, not approximately.
The tests sample the drawn triangles against the height field across a tile,
because the two agree at every corner however the tile is creased — only the
middle tells them apart.

**Walls** are thin instances of one box — one draw call for every block on the
map. Monsters, projectiles and dropped items are Babylon instances of a template
mesh for the same reason.

**Environment** is the map's `env` block: sky and edge fog, the flat ambient light,
Babylon's exposure/contrast/tone mapping, how hard ambient occlusion shades a
corner, and the three colours the ground and walls are made of. Most of it the
map view puts on the scene itself; `aoStrength` is the exception, because the
occlusion pipeline belongs to the renderer and outlives every map, so whoever
loads the map passes it on.

A test holds the four lists that have to agree — the editor's controls, the
defaults, the file format and whatever actually reads the value — to the same
set of keys. A colour picker that changes nothing is the failure this had
before.

**Lighting** comes entirely from the map's `lights` list. Shadows use Babylon's
contact-hardening filter (percentage-closer soft shadows): sharp where a caster
meets the floor, opening up with distance. The frustum is fitted to the casters
every frame, so no resolution is wasted on empty space.

**Ambient occlusion** is Babylon's `SSAO2RenderingPipeline`. A shadow map
answers "is this point hidden from that light"; it cannot answer "how enclosed
is this point", which is why a wall meets a floor with no seam and a character
in flat ambient light appears to hover.

**Ground shapes** — the wedge an ability is about to test — are painted by the
ground itself (`render/decals.js`). Nothing is projected: the terrain material
carries a few extra lines of shader that test each fragment's world position
against a small list of decals. It is exact at any zoom, costs no geometry, and
a shape can never hang down the side of a platform, because a fragment whose
normal does not point up is skipped. Walls simply do not use that material.

The JavaScript predicate `decalCovers` and the GLSL are the same rule written
twice, and the tests check them against `coneHits` over a grid of sample points
— so what is drawn and what is hit cannot disagree.

## Interface

Two layers, on purpose:

- **Babylon GUI** (`src/gui/`) draws what belongs to the world: the status line,
  the health, ability and cast bars, and the name plate over every dropped item.
  A plate projects itself onto a world point and is its own click target, so
  picking an item up is a click handler rather than a second raycast that has to
  agree with the first.
- **DOM** (`src/ui/`, `index.html`) draws what is a document: the menu, the
  character sheet, the item on the cursor, and the fault banner. The banner is
  deliberately DOM — a frame that throws may well have thrown inside the
  renderer, and a banner that needs the renderer to appear is no banner at all.

The editors are DOM throughout. They are dense forms and lists — a tool, not a
head-up display.

`ui/input.js` owns every DOM listener the game has. Gameplay systems ask it what
is held; they do not each grow a listener. It also answers the one question
Babylon cannot: whether a press landed on the world, on a control, or on some
other part of the interface — a press that misses an inventory cell but hits the
sheet around it is a miss, not an instruction to throw the carried item away.

## The simulation

`game/world.js` owns the map, the surface heights and the collision rules, and
knows nothing about rendering. Positions are continuous grid coordinates and
heights are in levels; the renderer decides what a level is worth in world
units.

The player is an axis-aligned box in grid space with a half-extent of
`PLAYER_RADIUS` (0.3 tiles). Each frame the two axes are resolved separately:
move along `gx`, and if the move is illegal, snap flush to the blocking tile's
edge; then repeat for `gy`. Resolving the axes independently is what makes the
player slide along a wall rather than stopping dead when pushing into it
diagonally.

A move is legal when all three hold:

1. the footprint overlaps no wall tile (out-of-bounds counts as wall, so the map
   border needs no special case);
2. the surface height changes by no more than `MAX_STEP` (0.34 levels) from the
   previous position — a cliff is a whole level, a ramp only a fraction of one,
   so ramps are the only way on and off a platform;
3. every corner of the footprint sits within `FOOT_TOLERANCE` (0.45 levels) of
   the height under the player's centre, so the player cannot stand half over a
   drop, and cannot walk off the *side* of a ramp.

Rule 3 is why those three constants are related: a ramp pulls a footprint corner
`2 * PLAYER_RADIUS = 0.6` levels across, so the tolerance has to sit above 0.3
(half that, measured from the centre) and below the 1.0 of a real cliff.

This is deterministic grid movement, and it is the game's collision system.
There is no physics engine, and adding one would replace the rules above rather
than support them.

## Items

An item **definition** lives in `data/rules/items.js` and holds ranges: a short
sword is 4–6 attack damage. Rolling one produces an **instance** with settled
numbers, and a rolled stat is `{attribute, op, value}` — which is exactly the
shape a modifier already had. That is why equipping needed no new mechanism:
wearing an item adds its stats as modifiers sourced on the item object, and
taking it off removes them by that same source, so it is reversible without
drift.

An item is in exactly one place at a time — the bag, the body, the floor, or the
cursor — and the tests assert that census after every gesture.

## Editing

The map editor draws the map with the same code the game does, rebuilt whenever
the document changes. A 32×32 map rebuilds in well under a frame, and it means
the editor cannot drift out of sync with how the map will actually look.

Saving writes real files through a dev-only Vite middleware
(`vite-plugin-map-io.js`): maps to `Games/<Name>/maps/`, rules to
`Games/<Name>/rules/`. Every write names the game it is for — the editor belongs
to none of them.

Saving does not reload the page. The plugin sees the change and reports nothing
to update, so a reload in the middle of editing — which is not a refresh, it is
losing the map you were drawing — cannot happen. The browser puts what it just
wrote straight into the registry (`registerMap`) instead of waiting to be
reloaded with it.

The files are still watched, so Vite still drops them from its cache: a hand-edit,
or a save from a second browser, shows up on the next page load. Only the
automatic reload is suppressed. Creating a *new* map file still reloads, because
that changes what the manifest's glob matches.

## Generated maps

`base` is a map you walk as drawn. `dungeon` is not: it is marked
**generated**, and what you walk into is assembled out of its **chunks** the
moment you go through the door.

The dungeon you assembled is then **kept for the run**. Walking out to base and
back in returns you to the same one, so you can go home to sell and come back
for the room you skipped. A run ends when you die, or when you take the stair
down — which is a different dungeon by definition. That is all `currentRun`
and `endRun` do.

A **chunk** is a named rectangle on the map's own grid:

```js
generated: true,               // walk the pieces, not this grid
chunkCount: 8,                 // how many to place in a run
chunks: [{ gx: 0, gy: 0, w: 20, h: 16, name: 'entry', role: 'start' }],
doors: [{ gx: 12, gy: 0 }],    // border tiles another chunk joins onto
```

You draw the whole thing on one canvas — rooms side by side with gaps between
them — and mark off which rectangles are the pieces. Everything inside a
rectangle belongs to that piece; everything outside every rectangle is margin,
and the editor says how much of it there is rather than losing it quietly.
Turning the toggle off walks the grid exactly as drawn and keeps the chunks, so
it is a switch and not a delete.

The generator (`src/data/maps/generate.js`) cuts the chunks out
(`src/data/maps/chunks.js`), places the one marked `start`, then keeps picking
an open door and fitting another chunk against it — trying every chunk at every
quarter turn until one fits without overlapping something already placed. A
chunk marked `end` is held back for last, and it is fitted onto the **deepest**
open door rather than a random one — depth being how many doorways in from the
entrance a piece sits, which is the only measure of "far away" that survives a
layout folding back on itself. Over 200 seeds the stair lands three or four
doorways in and never next to the entrance; `map.generated.endDepth` says where
it actually went. Whatever the chunks do not cover becomes solid rock, which is
also what seals a door nothing was fitted against.

The output is one map object, so nothing downstream knows it was generated:
`createLevel` builds it, `World` collides against it. Rotation is the only
fiddly part — a torch's mounting face and a sun's compass bearing are
directions, and they have to turn with the grid.

The pieces live in the map file rather than in files of their own. They used to
be a file each, tied together by a shared name, which meant the editor pasted
them onto a canvas to show them and cut them apart again to save — and anything
the cutting did not know about was lost on the way through. There is nothing to
cut apart now: the canvas *is* the file, so painting, terrain, placing,
erasing, selection, the gizmo, undo and the renderer all work on it unchanged,
and the grid can be resized like any other map's.

One `env` for the whole map. The chunks are rooms in one place, and a room with
its own weather is not one.

Two rules worth knowing:

- **A doorway is as wide as you drew it.** Door tiles that touch along the same
  edge are one opening that wide, not several one-tile openings. Two doorways
  are laid first tile to first tile and meet over as many tiles as the narrower
  one has; whatever hangs off the end faces the other chunk's border wall, so it
  is closed. The door brush knocks the wall through itself — a doorway is a hole
  in a wall, so it does not refuse to go where one is.
- **A chunk's border is walls except where its doors are.** Two chunks are
  laid edge to edge, so a border tile that is floor and is not a door is a hole
  into whichever chunk lands beside it. The generator does not check this; a test
  does, because from inside the generator "the wall you forgot" and "the
  shortcut you meant" look identical.
- **Only the entrance's sun and sky fill are kept.** They light the whole map,
  so eight chunks each carrying one would be eight suns. Point and spot lights
  come along from every chunk.

Generation costs about 4 ms. The wait when you change map is building the level
and compiling its shaders, which is what the loading cover is over.

## Current state

- The game and the editor as separate pages, over a shelf of game folders
- Maps from editable ASCII layouts: walls, platforms, ramps, portals, lights
- Generated maps: dungeons assembled from chunks drawn on the map itself
- Attributes, effects, abilities, archetypes and items, all data-driven
- Melee cones, projectiles, dashes with a spark trail, monsters that chase
- Inventory, equipment, drops on the ground with clickable name plates
- Currencies, prices and loot tables as data: coin off the floor, a crafting
  bench in the world, and recipes gated by a base level you spend it on
- Soft-shadowed sun, screen-space ambient occlusion, shader-painted telegraphs

## Next steps

- `ruleOverrides` in `src/main.js` is never cleared after a rules play-test, so
  the session keeps running on unsaved rules until it is reloaded.
- Deleting a rule leaves dangling references; renaming one chases them.
