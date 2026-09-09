import { AdvancedDynamicTexture } from '@babylonjs/gui/2D/advancedDynamicTexture.js';
import { Matrix, Vector3 } from '@babylonjs/core/Maths/math.vector.js';
import { Plane } from '@babylonjs/core/Maths/math.plane.js';
// Side-effect only: this is what adds `createPickingRay` to Scene.
import '@babylonjs/core/Culling/ray.js';

import { START_MAP } from './data/maps/index.ts';
import { endRun } from './data/maps/generate.ts';
import { SLOT_BINDINGS } from './data/abilities.ts';
import { createRenderer } from './render/engine.js';
import { createLevel } from './render/level.js';
import { CURRENCIES } from './data/currencies.ts';
import { createCharacter } from './game/character.js';
import { LEVEL_H } from './data/dimensions.ts';
import { DEFAULT_FRUSTUM, SCREEN_FORWARD, SCREEN_RIGHT } from './render/isoCamera.js';
import { createHud } from './gui/hud.js';
import { createGroundLabels } from './gui/groundLabels.js';
import { createCharacterPanel } from './ui/character.js';
import { createCraftingPanel } from './ui/crafting.js';
import { createAbilitiesPanel } from './ui/abilities.js';
import { createHeldItemView } from './ui/heldItem.js';
import { createItemCursor } from './ui/itemCursor.js';
import { createInput } from './ui/input.js';

/**
 * The application: the renderer, the current level, and the wiring between
 * input and gameplay.
 *
 * There is no editor here, and nothing under Engine/src/ imports one. The editor is a
 * separate page built from a separate entry — see Engine/editor/main.js — so a
 * published game has no way to reach it and no idea it exists.
 *
 * Everything below is bootstrap and glue. The simulation lives in game/, what
 * it looks like lives in render/, what it says lives in gui/ and ui/, and none
 * of them reach for each other — they are joined up here.
 */

const CAMERA_LERP = 6; // how quickly the camera catches up, per second
const FADE_MS = 220; // half a transition: out, swap, back in

/**
 * Longest the fade will hold itself open waiting for the new map to be
 * drawable. Reached only if something cannot compile at all, and coming up to
 * a half-drawn map beats never coming up at all.
 */
const READY_MS = 1500;

// --------------------------------------------------------------- renderer

const canvasHost = document.getElementById('game');
const renderer = createRenderer(canvasHost);
const { scene, camera } = renderer;

// One fullscreen layer for everything the game draws over the world: the
// read-outs and the item name plates.
const ui = AdvancedDynamicTexture.CreateFullscreenUI('ui', true, scene);
const hud = createHud(ui);

// ------------------------------------------------------------------ level

let level = null;
let transitioning = false;

/**
 * The two things a level is handed rather than allowed to own.
 *
 * `hero` is the player: the bag, the purse and whatever is on the cursor. A
 * level is rebuilt at every doorway and would take all three with it. The purse
 * starts with whatever each currency says it starts with, which is why the
 * definitions are read here and nowhere else.
 *
 * `place` is the world's own state — how far the base has been built up. It is
 * a property of the base, not of whoever is standing in it, so two players in
 * one base will see one bench. Passed down as an object rather than kept as a
 * module-level value because that is the shape a server hands over.
 */
const hero = createCharacter({ currencies: CURRENCIES });
const place = { baseLevel: 1 };

/** Survives level changes, so toggling it off stays off through a portal. */
let showDebug = true;

/** What the ability bar was last built for, so it is rebuilt only when it moves. */
let boundSlots = '';

/** Where the camera is heading. Lerped toward the player every frame. */
const cameraTarget = new Vector3();

/**
 * The purse, for the status line. Read off the level rather than the character,
 * so what the money is *called* comes from the same rules the bench is charging
 * by.
 */
function purseLine() {
  return level
    .purse()
    .map(({ label, amount }) => `${amount} ${label}`)
    .join('   ');
}

function snapCamera() {
  cameraTarget.set(level.pos.gx, level.height * LEVEL_H, level.pos.gy);
  renderer.lookAt(cameraTarget.x, cameraTarget.y, cameraTarget.z);
}

function loadLevel(mapId, spawnName) {
  level?.destroy();
  level = createLevel(scene, mapId, spawnName, {}, { character: hero, place });
  level.debug.setEnabled(showDebug);
  boundSlots = '';
  renderer.setAmbientOcclusion(level.env.aoStrength);
  snapCamera();
}

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Hold until the map is drawable, moving the bar to how much of it is.
 *
 * The bar is read off the scene rather than run on a timer, so it stops where
 * the wait actually is. `whenReady` is what decides the wait is over — the
 * count includes meshes that will never be drawn — and READY_MS is the same
 * grace as ever: coming up on a half-drawn map beats never coming up.
 */
async function untilReady() {
  let ready = false;
  renderer.whenReady().then(() => {
    ready = true;
  });

  const start = performance.now();
  while (!ready && performance.now() - start < READY_MS) {
    bar.style.width = `${Math.round(renderer.progress() * 100)}%`;
    await wait(60);
  }
  bar.style.width = '100%';
}

/**
 * Fade to black, swap the map behind the cover, fade back. The swap happens
 * while the screen is opaque so the new level's first frame is never seen
 * half-built, and the camera snap is invisible.
 */
async function behindCover(load) {
  if (transitioning) return;
  transitioning = true;

  loading.textContent = 'Loading';
  bar.style.width = '0%';
  fade.classList.add('on');
  await wait(FADE_MS);
  groundLabels.clear();

  // Behind the cover, not in front of it: building a map is the expensive thing
  // the game does, and a cluster is assembled out of its parts at this moment
  // too. Both block, which is exactly why there is something over the screen.
  load();
  loading.textContent = level.name;

  // Behind it as well: a shader that is still compiling is a mesh that is not
  // drawn, and lifting the cover on top of that shows the map arriving in
  // pieces — a black room that fills in a moment later.
  await untilReady();

  fade.classList.remove('on');
  await wait(FADE_MS);

  transitioning = false;
}

async function goToMap(mapId, spawnName) {
  // A door leading into the place you are already standing in is the stair
  // down, not the way back: that ends this run and the next one is assembled
  // on the way through. Any other door leaves the dungeon where it is, so
  // coming back to it comes back to the same one.
  if (!transitioning && mapId === level.id) endRun(mapId);
  await behindCover(() => loadLevel(mapId, spawnName));
}

// -------------------------------------------------------------------- ui

const menu = document.getElementById('menu');
const fade = document.getElementById('fade');
const loading = document.getElementById('loading');
const bar = document.querySelector('#bar > i');

let playing = false;

/**
 * Moving items about: the left button carries, the right one is the shortcut.
 *
 * The rules are in ui/itemCursor.js, which is handed the level's own item
 * operations and decides what each press means. The panel reports raw presses
 * and this connects the two, so the only thing living here is the wiring.
 */
const character = createCharacterPanel(document.getElementById('character'), {
  onCellDown: (where, button) => itemCursor.cellDown(where, button),
  onCellUp: (where) => itemCursor.cellUp(where),
});

/**
 * The bench. Opened by clicking one, and closed by walking away from it —
 * which is also what stops it outliving the level it was opened in.
 */
const crafting = createCraftingPanel(document.getElementById('crafting'), {
  onCraft: (id) => {
    const result = level?.craft(id);
    if (!result || result.ok) return;
    hud.notice(
      {
        locked: 'The bench cannot make that yet.',
        poor: 'Not enough coin.',
        full: 'Your bag is full.',
        busy: 'The bench is already working.',
      }[result.reason] ?? 'The bench cannot make that.',
    );
  },
  onUpgrade: () => {
    const result = level?.upgradeBase();
    if (!result) return;
    if (result.ok) hud.notice(`The base is now level ${result.level}.`);
    else hud.notice(result.reason === 'maxed' ? 'Nothing left to build.' : 'Not enough coin.');
  },
});

/**
 * The abilities screen. Opened with K, and it decides nothing: a drop says
 * which ability landed on which key and the rules for that are in game/.
 */
const abilities = createAbilitiesPanel(document.getElementById('abilities'), {
  onAssign: (index, ability) => level?.assignSlot(index, ability),
});

const heldView = createHeldItemView(document.getElementById('held'));

/** Show what is being carried, and let the sheet know its cells are targets. */
function syncHand() {
  const item = level?.hand ?? null;
  heldView.show(item);
  character.setHolding(Boolean(item));
}

// The level is handed over as a getter: it is replaced on every map change, and
// the cursor must never be holding a reference to the old one.
const itemCursor = createItemCursor(() => (playing ? level : null), {
  say: (text) => hud.notice(text),
  onChange: syncHand,
});

/**
 * Use the thing named by one of the ids the name plates carry.
 *
 * Both kinds come through here, because they are the same list — see
 * level.groundAnchors — and so do both ways of asking: clicking the plate, and
 * the interact key finding the nearest one. Whatever a plate can do, the key
 * does, because there is only the one path.
 */
function interactWith(id) {
  if (!id) return;
  if (id.startsWith('station')) {
    crafting.setOpen(true);
    return;
  }
  const result = level?.pickUp(id);
  if (result && !result.ok && result.reason === 'full') hud.notice('Your bag is full.');
}

const groundLabels = createGroundLabels(ui, scene, {
  // A bench's plate is only ever published while you are standing at one, so
  // arriving here at all means it is in reach.
  onPick: interactWith,
});

// ------------------------------------------------------------------ input

const input = createInput({
  world: '#game',

  onKeyDown(event) {
    // Escape backs out of wherever you are. The panels are the things in front
    // of the game, so they close first — otherwise the only way to shut one
    // would be the key that opened it.
    if (event.code === 'Escape') {
      if (abilities.open) abilities.setOpen(false);
      else if (crafting.open) crafting.setOpen(false);
      else if (character.open) character.setOpen(false);
      else showMenu();
    }

    // The sheet is a read-out, not a mode: the game keeps running behind it, so
    // this only toggles what is drawn.
    if (event.code === 'KeyC' && playing) {
      event.preventDefault();
      character.toggle();
    }

    // The abilities screen is a read-out like the sheet: the game keeps running
    // behind it, so this only toggles what is drawn.
    if (event.code === 'KeyK' && playing) {
      event.preventDefault();
      abilities.toggle();
    }

    // Use whatever you are standing at: a bench opens, a drop goes in the bag.
    // The nearest wins, so walking onto something is how you choose it.
    if (event.code === 'KeyF' && playing) {
      event.preventDefault();
      const target = level?.interactTarget();
      // Silent when there is nothing there: the key is pressed hopefully while
      // walking, and a refusal every time would be noise, not information.
      if (target) interactWith(target.id);
    }

    // Debug shapes are on by default because they are the point of being able
    // to see them; F3 gets them out of the way for a screenshot.
    if (event.code === 'F3') {
      event.preventDefault();
      showDebug = !showDebug;
      level.debug.setEnabled(showDebug);
    }

    if (!playing && ['Enter', 'Space'].includes(event.code)) startGame();
    if (playing && ['KeyW', 'KeyA', 'KeyS', 'KeyD', 'Space'].includes(event.code)) {
      event.preventDefault();
    }
  },

  onMove: (at) => heldView.moveTo(at.x, at.y),

  onPress({ button, where, x, y }) {
    heldView.moveTo(x, y);

    // A control — a menu button — has answered the press itself.
    if (where === 'control') return;

    if (where === 'interface') {
      itemCursor.uiDown(button);
      return;
    }

    // An item name plate is drawn inside the canvas, so the DOM reports a press
    // on one as a press on the world. It must not also swing — but it is still
    // a press on the ground, so an item on the cursor still goes down there.
    // Returning early here instead is what used to make dropping stop working
    // once there were enough plates to be standing on one.
    if (groundLabels.hovering) input.buttons.suppress(button);

    // Carrying something and pressing the world puts it down there. This is the
    // same press that would otherwise attack, so it has to be swallowed.
    if (itemCursor.worldDown(button)) input.buttons.suppress(button);
  },

  onRelease({ where }) {
    // A cell will have handled it already.
    if (where === 'control') return;
    if (where === 'world') itemCursor.worldUp();
    else itemCursor.uiUp();
  },
});

// Right-click is an ability slot, so the browser menu has to stay out of it.
renderer.canvas.addEventListener('contextmenu', (event) => {
  if (playing) event.preventDefault();
});

// ------------------------------------------------------------------ aiming

/**
 * Where the cursor is, projected onto the ground.
 *
 * A ray through the camera, intersected with a horizontal plane at the player's
 * current height rather than at zero, so aiming stays honest while standing on
 * a platform.
 */
const aimPlane = new Plane(0, 1, 0, 0);
const aimPoint = new Vector3();

/**
 * The heading to aim an ability along: toward the cursor, in the same
 * atan2(dx, dy) space the actors use. Falls back to the way the player is
 * already facing before the mouse has ever moved.
 */
function aimHeading() {
  if (!input.pointer.seen) return level.player.facing;

  aimPlane.d = -level.height * LEVEL_H;
  const ray = scene.createPickingRay(scene.pointerX, scene.pointerY, Matrix.Identity(), camera);
  const distance = ray.intersectsPlane(aimPlane);
  if (distance === null) return level.player.facing;

  aimPoint.copyFrom(ray.direction).scaleInPlace(distance).addInPlace(ray.origin);

  const dx = aimPoint.x - level.pos.gx;
  const dy = aimPoint.z - level.pos.gy;
  if (Math.hypot(dx, dy) < 1e-4) return level.player.facing;
  return Math.atan2(dx, dy);
}

// ------------------------------------------------------------------- menu

/** Whether the world has ever been entered. The first time is the one that waits. */
let started = false;

function startGame() {
  menu.classList.add('hidden');
  if (started) {
    playing = true;
    return;
  }
  started = true;
  // The map is built at boot, but nothing in it is compiled until the scene has
  // tried to draw it — so the wait is here, on the way in, and not over the
  // title screen. Nobody wants to be told the main menu is loading.
  behindCover(() => {}).then(() => {
    // Backing out to the menu while the cover was up means the answer to "are
    // we playing" changed underneath this, and the menu wins.
    if (menu.classList.contains('hidden')) playing = true;
  });
}

function showMenu() {
  // An item on the cursor belongs to nothing while it is there, so it cannot be
  // left in mid-air: it goes back in the bag, or on the floor if that is full.
  level?.stowHand();
  itemCursor.cancel();
  crafting.setOpen(false);
  abilities.setOpen(false);
  syncHand();
  playing = false;
  menu.classList.remove('hidden');
}

document.getElementById('play').addEventListener('click', startGame);

// ------------------------------------------------------------------ loop

let fpsAccum = 0;
let fpsFrames = 0;
let fps = 0;

loadLevel(START_MAP, 'default');

renderer.run(
  (dt) => {
    fpsAccum += dt;
    fpsFrames++;
    if (fpsAccum >= 0.25) {
      fps = Math.round(fpsFrames / fpsAccum);
      fpsAccum = 0;
      fpsFrames = 0;
    }

    // Frozen during a transition: the old level is still on screen behind the
    // fade, and stepping it would let the player walk while blind.
    const simulate = playing && !transitioning;

    if (simulate) {
      let forward = 0;
      let right = 0;
      // Where the keys point, kept only as the fallback for a mouse that has
      // never moved. Null when standing still, which is not a heading.
      let walking = null;
      if (input.held('KeyW')) forward += 1;
      if (input.held('KeyS')) forward -= 1;
      if (input.held('KeyD')) right += 1;
      if (input.held('KeyA')) right -= 1;

      if (forward !== 0 || right !== 0) {
        // Ground-plane axes matching the camera, so W is always "up-screen".
        const dx = SCREEN_FORWARD.x * forward + SCREEN_RIGHT.x * right;
        const dz = SCREEN_FORWARD.z * forward + SCREEN_RIGHT.z * right;
        const length = Math.hypot(dx, dz) || 1;
        // Speed is an attribute, so a slow or a haste effect moves the player
        // without anything here knowing such effects exist.
        const speed = level.player.attrs.value('moveSpeed');
        level.movePlayer(dx / length, dz / length, speed * dt);
        walking = Math.atan2(dx / length, dz / length);
      }

      // Every held binding re-attempts its slot each frame; the ability's own
      // cooldown is what paces it, so holding a button attacks continuously.
      const aim = aimHeading();

      // The body follows the cursor rather than the keys: this is a mouse-aimed
      // game, and someone circling a target should keep looking at it instead
      // of at wherever they happen to be strafing. Until the mouse has moved
      // there is nothing to look at but the walk.
      const look = input.pointer.seen ? aim : walking;
      if (look !== null) level.facePlayer(look, dt);
      SLOT_BINDINGS.forEach((binding, slot) => {
        const held =
          binding.button === undefined
            ? input.held(binding.code)
            : input.buttons.isDown(binding.button);
        // Space doubles as slot 0 so the game stays playable from the keyboard.
        if (held || (slot === 0 && input.held('Space'))) level.useSlot(slot, aim);
      });
    }

    level.update(dt, simulate);

    if (simulate) {
      // Death sends you back to base with a fresh level, which is what restores
      // health — no separate respawn path to keep in step.
      if (!level.alive) {
        // Dying is the end of the run, whichever one you were on.
        endRun();
        goToMap(START_MAP, 'default');
      } else {
        const portal = level.pendingPortal();
        if (portal) goToMap(portal.to, portal.spawn);
      }
    }

    // Camera follows the player, keeping the isometric offset.
    const height = level.height;
    const catchUp = Math.min(1, dt * CAMERA_LERP);
    cameraTarget.x += (level.pos.gx - cameraTarget.x) * catchUp;
    cameraTarget.y += (height * LEVEL_H - cameraTarget.y) * catchUp;
    cameraTarget.z += (level.pos.gy - cameraTarget.z) * catchUp;
    renderer.lookAt(cameraTarget.x, cameraTarget.y, cameraTarget.z);

    // The sheet belongs to a running game, and only costs anything while it is
    // actually on screen — `character()` walks every attribute, so it is read
    // when there is something to read it into and not otherwise.
    if (!playing) character.setOpen(false);
    else if (character.open) character.update(level.character());

    if (!playing) abilities.setOpen(false);
    else if (abilities.open) abilities.update(level.loadout());

    // Walking away shuts the bench. Reach is the only thing that closes it
    // besides Escape, which is what keeps it from surviving into a level where
    // there is no bench to have opened it.
    if (!playing || !level.nearStation()) crafting.setOpen(false);
    else if (crafting.open) crafting.update(level.crafting());

    // Name plates track the items every frame, because the camera moves even
    // when nothing on the floor does.
    groundLabels.setVisible(playing);
    if (playing) groundLabels.update(level.groundAnchors());
    else groundLabels.clear();

    const nearby = playing ? level.interactTarget() : null;
    const chasers = level.monsters.filter((monster) => monster.chasing).length;
    const vitals = level.vitals();

    // The bar's names are built once and animated after, so a weapon picked up
    // mid-run has to say so. Rebuilt only when what is bound actually changes,
    // which is a handful of times a session rather than sixty times a second.
    const bound = vitals.slots.map((slot) => slot.id ?? '').join(',');
    if (bound !== boundSlots) {
      boundSlots = bound;
      hud.setAbilities(vitals.slots, SLOT_BINDINGS);
    }

    hud.update({
      playing,
      vitals,
      status:
        `${level.name}   ` +
        // Ahead of the debug numbers on purpose: it is the one thing on this line
        // a player rather than a developer is reading.
        `${purseLine()}   ` +
        `tile ${Math.floor(level.pos.gx)}, ${Math.floor(level.pos.gy)}   ` +
        `height ${height.toFixed(2)}   fps ${fps}   ` +
        (chasers ? `${chasers} chasing   ` : '') +
        // What the key would take, so it is clear there is something to press
        // and clear what pressing it gets you.
        (playing ? `${nearby ? `F = ${nearby.label}   ` : ''}C = character   K = abilities   ESC = menu` : 'paused'),
    });

    return true;
  },
  (error) => hud.fault(error),
);

if (import.meta.env.DEV) {
  window.merc = {
    // Which buttons the game thinks are down. Worth reaching from a console: it
    // is updated straight from the events, so it can be checked without the
    // frame loop running, which is exactly when input bugs are hard to pin.
    input,
    // The two things that outlive a level: worth reaching from a console,
    // since a purse with nothing in it is most of what makes crafting hard to
    // try out before monsters have been killed for it.
    hero,
    place,
    groundLabels,
    itemCursor,
    renderer,
      get playing() {
      return playing;
    },
    get level() {
      return level;
    },
    goToMap,
    start: startGame,
  };
}
