import { getMap } from '../data/maps/index.ts';
import { ATTRIBUTES } from '../data/attributes.ts';
import { EFFECTS } from '../data/effects.ts';
import { ABILITIES, abilityMap } from '../data/abilities.ts';
import { ARCHETYPES, archetypeMap } from '../data/archetypes.ts';
import { World } from '../game/world.ts';
import { createActor, grantStartingEffects, tickActor } from '../game/actor.ts';
import {
  advanceChain,
  beginCast,
  beginCooldown,
  canActivate,
  chainGapFraction,
  chainIndex,
  chainReady,
  castProgress,
  coneHits,
  cooldownFraction,
  endCast,
  payCost,
  turnActor,
  updateCastSlow,
  updateChain,
} from '../game/abilities.ts';
import { beginDash, updateDash } from '../game/dash.ts';
import { createEffectRuntime } from '../game/effects.ts';
import { EQUIPMENT_SLOTS } from '../game/inventory.ts';
import { createGround, nearestFree } from '../game/ground.ts';
import { collect, rollLoot, sweepCoin } from '../game/loot.ts';
import {
  assignSlot,
  knownAbilities,
  loadoutView,
  mainHandAbility,
  syncSlots,
} from '../game/loadout.ts';
import {
  equipFromBag,
  placeInBag,
  placeInSlot,
  strip,
  takeFromBag,
  takeFromSlot,
  unequipToBag,
  wear,
} from '../game/equipment.ts';
import { ITEMS, currenciesOf } from '../data/items.ts';
import { BASE_LEVELS } from '../data/baseLevels.ts';
import { CATEGORIES } from '../data/categories.ts';
import { LOOT_TABLES } from '../data/lootTables.ts';
import { RECIPES } from '../data/recipes.ts';
import {
  advanceCraft,
  beginCraft,
  craftingView,
  finishCraft,
  purseView,
  upgradeBase,
} from '../game/crafting.ts';
import { createProjectiles } from '../game/projectiles.ts';
import { spawnMonsters, updateMonsters } from '../game/monsters.ts';
import { Vector3 } from '@babylonjs/core/Maths/math.vector.js';
import { LEVEL_H } from '../data/dimensions.ts';
import { buildMapView } from './mapView.js';
import { createDebugViews } from './debug.ts';
import { createMonsterViews } from './monsters.ts';
import { createProjectileViews } from './projectiles.ts';
import { createGroundItemViews } from './groundItems.ts';
import { createTrailViews } from './trail.ts';
import { createVfxRuntime } from './vfx.ts';
import { VFX } from '../data/vfx.ts';
import { createPlayer } from './player.ts';

/**
 * One loaded map: its World, its slice of the scene, the player and whatever
 * monsters the map declares. Everything here is per-map and disposable —
 * changing map means building a new Level and destroying the old one, never
 * mutating this.
 *
 * The Babylon Scene is *not* per-level. There is one for the application, and a
 * level is a subtree of it under `root`; `destroy` drops that subtree. That is
 * why the scene is handed in rather than built here.
 *
 * The level owns ability activation, because it is the only place that has the
 * actor list, the world and the effect runtime all at once. What an ability
 * *is* — its reach, its cooldown, what it applies — is entirely data.
 *
 * @param {import('@babylonjs/core/scene.js').Scene} scene the one scene
 * @param {string|object} source a registered map id, or a map object straight
 * from the editor so an unsaved edit can be play-tested without writing a file.
 * @param {object} rules attribute/effect/ability/archetype definitions, likewise
 * so the editor can play-test unsaved rule edits.
 * @param {{character: object, place: object}} owners what outlives the level:
 * the character carrying the bag and the purse, and the shared world state the
 * base's level sits in. Both are handed in, because a level is disposable and
 * neither of them is.
 */
export function createLevel(scene, source, spawnName = 'default', rules = {}, { character, place } = {}) {
  const {
    attributes = ATTRIBUTES,
    effects: effectDefs = EFFECTS,
    abilities: abilityDefs = ABILITIES,
    archetypes = ARCHETYPES,
    items = ITEMS,
    recipes = RECIPES,
    categories = CATEGORIES,
    // Money is a category of item now, so an edited item list brings its own.
    currencies = currenciesOf(items, categories),
    lootTables = LOOT_TABLES,
    baseLevels = BASE_LEVELS,
    vfx: vfxDefs = VFX,
  } = rules;

  const map = typeof source === 'string' ? getMap(source) : source;
  const world = new World(map, spawnName);
  const view = buildMapView(scene, world, { vfx: vfxDefs });
  const { root, decals, shadows, torches, portals, env } = view;

  const effects = createEffectRuntime(effectDefs);
  const abilities = abilityMap(abilityDefs);
  const projectiles = createProjectiles();

  const playerView = createPlayer(scene, root, shadows);
  const player = createActor({
    archetype: 'player',
    gx: world.spawn.gx,
    gy: world.spawn.gy,
    attributes,
    archetypes,
  });
  grantStartingEffects(player, effects);

  // The bag comes from the character and goes on with them; the floor stays
  // here. That split is the whole of it — what you are carrying is yours and
  // has to survive a doorway, but a thing lying on the ground belongs to the
  // ground it is lying on.
  const { inventory } = character;
  const ground = createGround();

  // The body is new even when the wardrobe is not. A worn item's stats are
  // modifiers on this actor's attributes, and this actor was built bare a few
  // lines ago, so what the character is still wearing is layered back on.
  // There is no matching strip: the attributes are disposed with the level.
  for (const slot of EQUIPMENT_SLOTS) {
    const worn = inventory.wearing(slot.id);
    if (worn) wear(player.attrs, worn);
  }

  // One index for both the player's label and every monster's loot table.
  const archetypeById = archetypeMap(archetypes);
  const playerLabel = archetypeById.get(player.archetype)?.label ?? player.archetype;

  // And the bar is armed from what that body can now do. A character arriving
  // with empty slots — a new one, or one whose archetype learned something
  // while it was away — finds them filled rather than having to go and do it.
  // After the archetype index above, which is where the bare-hands attack for
  // this kind of actor is written down.
  syncLoadout();

  // The player's position object *is* the level's, so `level.pos` stays the
  // same identity the camera and HUD already read every frame.
  const pos = player.pos;

  const monsters = spawnMonsters(map, { attributes, archetypes });
  const monsterViews = createMonsterViews(scene, root, shadows, monsters);
  // Ability flashes, and the trails the shots leave. The map's own placed
  // effects are the map view's; these are the ones something *does*, so they
  // are thrown one at a time and clean themselves up when they burn out.
  const vfx = createVfxRuntime(scene, vfxDefs);
  /** The ones still playing that belong to an actor — see `carryVfx`. */
  const carried = [];
  const projectileViews = createProjectileViews(scene, root, vfx);
  const groundViews = createGroundItemViews(scene, root, shadows);
  // Handed the decal registry rather than the scene: a telegraph is a shape
  // the ground draws on itself, so there is no mesh to add anywhere.
  const debug = createDebugViews(decals);
  const trails = createTrailViews(scene, root);

  playerView.sync(pos.gx, pos.gy, world.standAt(pos.gx, pos.gy));
  monsterViews.sync(world);

  // The portal the player arrived beside must not fire until they have stepped
  // off it, or a two-way pair would bounce them back and forth forever.
  let portalArmed = world.portalAt(pos.gx, pos.gy) === null;

  /** Seconds since this level was built, for anything that idles. */
  let elapsed = 0;

  /**
   * Make the key bindings agree with what the body can currently do.
   *
   * Called after anything that changes what is worn. It is idempotent, so no
   * caller has to know whether another already did it — which is what makes it
   * safe to sprinkle over six different item gestures rather than trying to
   * find the one place they all pass through, because there is no such place.
   */
  function syncLoadout() {
    const unarmed = archetypeById.get(player.archetype)?.unarmed ?? '';
    return syncSlots(
      character,
      knownAbilities(player.abilities, inventory, unarmed),
      mainHandAbility(unarmed, inventory),
    );
  }

  // The cursor's limbo lives on the character — see ../game/character.ts. An
  // item in limbo belongs to no container, so it cannot live in the interface
  // that draws it; and the level is torn down at every doorway, so it cannot
  // live here either. Read and written through these two, so nothing below
  // changed shape.
  const held = () => character.hand;
  const hold = (item) => character.setHand(item);

  /**
   * The bench within reach, or null.
   *
   * Reach at all, rather than clicking one across the room, because the plate
   * *is* the button: an unfiltered one is a bench you could work at through a
   * wall. The nearest wins, so two side by side still open one thing.
   */
  const STATION_REACH = 2.5;

  /** Clear of the bench itself, so the plate is readable and clickable. */
  const STATION_PLATE_H = 1.3;

  function stationNear() {
    let best = null;
    (map.stations ?? []).forEach((def, index) => {
      const distance = Math.hypot(def.gx + 0.5 - pos.gx, def.gy + 0.5 - pos.gy);
      if (distance > STATION_REACH) return;
      if (!best || distance < best.distance) best = { id: `station${index}`, def, distance };
    });
    return best;
  }

  /**
   * How close you have to be standing to take something off the floor with the
   * interact key. Roughly "at your feet": the key is for the thing you walked
   * up to, and reaching further would make which of two piles you get a
   * surprise. Clicking a name plate is still how you take one across the room.
   */
  const INTERACT_REACH = 1.6;

  /**
   * The nearest thing the interact key would act on, or null.
   *
   * Answered as one of the ids the name plates already use, so the key and a
   * click on the plate go through the same single path — whatever a plate can
   * do, the key does, and neither can grow a case the other is missing.
   *
   * The bench competes on distance like anything else rather than winning
   * outright: standing at one with a drop at your feet, the key takes what you
   * are standing on, which is what walking over to it said you wanted.
   */
  function interactTarget() {
    let best = null;
    const offer = (id, label, distance) => {
      if (!best || distance < best.distance) best = { id, label, distance };
    };

    for (const drop of ground.list()) {
      const distance = Math.hypot(drop.gx - pos.gx, drop.gy - pos.gy);
      if (distance <= INTERACT_REACH) offer(drop.id, drop.item?.label ?? 'Item', distance);
    }

    const station = stationNear();
    if (station) offer(station.id, station.def.label || 'Crafting bench', station.distance);

    return best;
  }

  /** Everything that can be hit, player included. */
  const actors = () => [player, ...monsters.map((monster) => monster.actor)];

  /** Clear out anything the last tick killed, meshes included. */
  function reap() {
    for (let i = monsters.length - 1; i >= 0; i--) {
      if (monsters[i].alive) continue;
      // What falls out is a loot table the archetype names, so two monsters can
      // share one purse and the breakables that are coming can name the same
      // one without becoming monsters to do it.
      //
      // It lands on the floor rather than in the purse: killing something
      // across the room should leave you something to walk over to, and the arc
      // from the corpse is the beat that says the kill paid out.
      dropLoot(archetypeById.get(monsters[i].actor.archetype)?.loot, monsters[i].actor.pos);
      effects.removeByTarget(monsters[i].actor);
      monsterViews.remove(monsters[i]);
      monsters.splice(i, 1);
    }
  }

  /**
   * The effects aimed at whatever was struck. Called once per victim, so a cone
   * that catches three monsters applies these three times.
   */
  function landOnTarget(ability, caster, target) {
    for (const { effect, to } of ability.effects) {
      if (to !== 'self') effects.apply(effect, target, caster);
    }
  }

  /**
   * The effects aimed at the caster. Called exactly once when the ability goes
   * off, hit or miss — otherwise a wide swing through a crowd would wind the
   * attacker once per monster, and a whiff would not wind them at all.
   */
  function landOnSelf(ability, caster) {
    for (const { effect, to } of ability.effects) {
      if (to === 'self') effects.apply(effect, caster, caster);
    }
  }

  /**
   * Fire an ability, if the actor may. `aim` is a heading in the same space as
   * `actor.facing`; it defaults to wherever the actor is already looking, which
   * is what monsters use.
   *
   * @returns {{ok: boolean, reason: string, hits: Array}}
   */
  function activate(actor, abilityId, aim = actor.facing, { interrupt = false } = {}) {
    const ability = abilities.get(abilityId);

    // A combo is not something that happens; it is a decision about which of
    // its steps happens, and then that step goes through everything below
    // exactly as it would in a slot of its own.
    if (ability?.target === 'combo') return activateCombo(ability, actor, aim, { interrupt });

    // A wind-up runs to the end, and while it does the caster is committed:
    // another timed ability has to wait. The exceptions are both deliberate.
    //
    // Firing something else on purpose cancels it, which is what stops a long
    // cast locking you out after a misclick — re-pressing the *same* slot is
    // not that, or a held button would restart its own cast forever and never
    // resolve.
    //
    // An instant ability is the other: it goes off during the wind-up rather
    // than waiting for it, which is the whole of what "instant" buys you. What
    // that does to the cast is the ability's own business — see `interrupts`
    // below — and by default the cast carries on.
    const cutsIn = ability?.cast === 'instant';
    if (actor.cast && !cutsIn && (!interrupt || actor.cast.ability.id === abilityId)) {
      return { ok: false, reason: 'casting', hits: [] };
    }

    // Asked *before* anything is dropped. The cast used to be cancelled here
    // and the replacement checked afterwards, which was harmless while the only
    // gate was the new ability's own cooldown — you had pressed a slot that was
    // ready. The shared global cooldown can refuse a slot that is otherwise
    // ready, and then that order loses you the wind-up and gives you nothing
    // back for it.
    const allowed = canActivate(ability, actor);
    if (!allowed.ok) return { ...allowed, hits: [] };

    // Dropped, not landed: the area goes away rather than flashing, because
    // nothing was ever tested inside it. An instant ability that does not
    // interrupt leaves the wind-up alone — it happened alongside it.
    if (actor.cast && (!cutsIn || ability.interrupts)) endCast(actor).telegraph?.cancel();

    payCost(ability, actor);
    beginCooldown(ability, actor);

    // An ability aimed by facing takes the direction the body already points
    // and leaves it there. Snapping to the cursor first would make "facing"
    // mean "the cursor" and the setting would do nothing.
    const heading = ability.aimedBy === 'facing' ? actor.facing : aim;
    if (ability.aimedBy !== 'facing') actor.facing = heading;

    // A wind-up defers everything below until it runs out. Cost and cooldown
    // are spent up front, so a cancelled cast is a real loss rather than a free
    // look at the enemy.
    if (ability.castTime > 0) {
      const cast = beginCast(ability, actor, heading);
      cast.telegraph = telegraph(ability, actor, heading);
      return { ok: true, reason: '', casting: true, hits: [] };
    }

    return resolve(ability, actor, heading);
  }

  /**
   * One press of a combo: fire the step it is up to, then move the chain on.
   *
   * The step pays its own cost, cast time and cooldown, because it is an
   * ordinary ability and a slam should still wind up when it is the third
   * thing you pressed. The combo pays twice around that: its cost when the
   * chain opens, and its cooldown when the chain closes — the recovery after a
   * finisher, rather than a tax on getting to one.
   *
   * A press that goes nowhere — no charge, still winding up, the step on
   * cooldown — leaves the chain exactly where it was. Losing your place in a
   * combo because a press bounced off the global cooldown would be
   * indistinguishable from the game dropping the input.
   */
  function activateCombo(combo, actor, aim, opts) {
    // A step still winding up owns the chain until it lands. Pressing a slot
    // again is normally allowed to interrupt what it is doing, and for one
    // ability that is right — you changed your mind. Inside a chain it is not:
    // the next press is you asking for the *next* step, and cutting the
    // current one short to start it would mean a held button interrupted every
    // step with the one after it and nothing but the last ever landed.
    if (actor.cast?.combo === combo) return { ok: false, reason: 'casting', hits: [] };

    // The combo's own recovery between blows. Read as a cooldown because that
    // is what it is from the outside: the key is refused for a moment after a
    // step lands, whatever the step itself is doing.
    if (!chainReady(actor, combo)) return { ok: false, reason: 'cooldown', hits: [] };

    const index = chainIndex(actor, combo);
    const step = abilities.get(combo.steps[index]);
    // A step naming a combo would recurse; the editor will not offer one, but
    // a hand-written file can say anything.
    if (!step || step.target === 'combo') return { ok: false, reason: 'unknown', hits: [] };

    // The combo's own gate. Its cost is only asked for at the top of the chain,
    // so a three-step combo charges once rather than three times; its cooldown
    // is only ever running between chains, so asking every press is free.
    const gate = canActivate(combo, actor);
    if (!gate.ok && (gate.reason !== 'cost' || index === 0)) return { ...gate, hits: [] };

    const result = activate(actor, step.id, aim, opts);
    if (!result.ok) return result;

    if (index === 0) payCost(combo, actor);

    // A step with a wind-up moves the chain on when it *lands*, not when it is
    // pressed: what the key does next should follow what you just watched
    // happen, and the window to keep the chain going should start from the
    // blow rather than from a keypress half a second before it.
    if (actor.cast) actor.cast.combo = combo;
    else landChainStep(actor, combo);

    return result;
  }

  /** A step of a combo has landed: move to the next, or close the chain. */
  function landChainStep(actor, combo) {
    if (advanceChain(actor, combo)) beginCooldown(combo, actor);
  }

  /** The ability actually going off — immediately, or at the end of its cast. */
  /**
   * The area a melee ability is winding up to test, drawn from the moment the
   * cast starts. Nothing else has an area to show: a projectile is a body that
   * travels and a dash moves the caster, so neither has a wedge to stand in.
   */
  function telegraph(ability, actor, aim) {
    if (ability.target !== 'melee') return null;
    return debug.telegraph({
      gx: actor.pos.gx,
      gy: actor.pos.gy,
      aim,
      range: ability.range,
      arc: ability.arc,
      castTime: ability.castTime,
    });
  }

  /**
   * Keep a wind-up's shape under the caster, aimed the way it will fire.
   *
   * Position follows, because the hit test runs from wherever the caster ends
   * up and a wind-up does not pin anyone in place. The heading does *not*: a
   * cast fixes its aim when it begins and fires on that, so a shape that turned
   * with the body would be pointing somewhere the swing is not going to test.
   */
  function followTelegraph(cast, actor) {
    cast.telegraph?.place(actor.pos.gx, actor.pos.gy, cast.aim);
  }

  /**
   * The flash an ability makes as it goes off, if it names one.
   *
   * At the caster, except for a swing — a wedge is in *front* of you, so a
   * flash on your own feet is the wrong half of it. Everything else starts
   * where the caster is and travels from there under its own steam.
   *
   * The ability's aim, arc and range go with it. Most effects ignore all three;
   * a slash is drawn from them, so that a swing's sparks are as wide and as far
   * as the swing actually is rather than as wide as somebody guessed. An effect
   * that reaches its own range is played on the caster, or the arc would be
   * drawn a range past where the arc is.
   */
  function playVfx(ability, actor, aim) {
    if (!ability.vfx) return;

    // On the caster, and nowhere else. Where an effect actually sits is its own
    // Transform's business — turned with the aim, so "a tile forward" is
    // forward along the blow — rather than a nudge guessed from the ability's
    // range out here. One place to set it, and it is the place you can see.
    //
    // Read again every frame below, so a swing that takes a moment goes with
    // the body it came off instead of being left on the tile it started from.
    // The heading is the one the ability fired on and does not change, so the
    // effect keeps its bearing even as the caster turns away.
    const at = () => {
      const { gx, gy } = actor.pos;
      return new Vector3(gx, world.heightAt(gx, gy) * LEVEL_H, gy);
    };

    const spot = at();
    const handle = vfx.play(ability.vfx, spot.x, spot.y, spot.z, {
      aim,
      arc: ability.arc,
      range: ability.range,
    });
    if (handle) carried.push({ handle, at });
  }

  /**
   * Keep every effect an ability threw on the actor that threw it.
   *
   * Dropped from the list as soon as its own runtime says it is finished, so
   * this never has to know what a flash is made of or how long it lasts.
   */
  function carryVfx() {
    for (let i = carried.length - 1; i >= 0; i--) {
      const one = carried[i];
      if (!one.handle.alive) carried.splice(i, 1);
      else one.handle.follow(one.at());
    }
  }

  /** @param {object|null} shown the wind-up's shape, if it had one */
  function resolve(ability, actor, aim, shown = null) {
    landOnSelf(ability, actor);
    playVfx(ability, actor, aim);

    if (ability.target === 'dash') {
      beginDash(ability, actor, aim);
      // Mark the true starting point now. The per-frame pass runs after the
      // dash has already moved, so left to itself the first ghost would appear
      // a whole frame's travel down the path — further along the faster it is.
      trails.follow(actor, world);
      return { ok: true, reason: '', hits: [] };
    }

    if (ability.target === 'projectile') {
      projectiles.spawn({
        ability,
        source: actor,
        dirX: Math.sin(aim),
        dirY: Math.cos(aim),
      });
      return { ok: true, reason: '', hits: [] };
    }

    const hits = coneHits(actor, aim, ability, actors());

    // The wedge on screen is the wedge that was measured: an ability that wound
    // up has been showing it the whole time and now flashes it, and one that
    // fired instantly gets the same shape drawn and flashed in a single frame.
    const area = shown ?? telegraph(ability, actor, aim);
    area?.fire();

    for (const target of hits) landOnTarget(ability, actor, target);
    reap();
    return { ok: true, reason: '', hits };
  }

  /**
   * Which step of a combo the next press would fire, for the bar to show.
   *
   * Named rather than numbered on the key, because the number is only
   * meaningful next to the name: "2/3" says you are partway through and
   * "Swipe" says what pressing now actually does.
   */
  function comboStep(ability) {
    if (ability.target !== 'combo' || !ability.steps.length) return null;
    const index = chainIndex(player, ability);
    const step = abilities.get(ability.steps[index]);
    return {
      index: index + 1,
      count: ability.steps.length,
      label: step?.label ?? ability.steps[index],
    };
  }

  /** Advance every wind-up, firing the ones that finish. */
  function updateCasts(dt) {
    for (const actor of actors()) {
      updateChain(actor, dt);
      updateCastSlow(actor, dt);

      const cast = actor.cast;
      if (!cast) continue;

      // A caster killed mid-wind-up drops it, slow and all.
      if (!actor.alive) {
        endCast(actor).telegraph?.cancel();
        continue;
      }

      cast.remaining -= dt;
      // Placed on the finishing frame too, so the shape that flashes is under
      // the caster the hit test is about to run from — not a frame behind it.
      followTelegraph(cast, actor);
      if (cast.remaining > 0) continue;

      // Ended before resolving, so the slow is already gone when the ability
      // lands and a dash or knockback would not fight it.
      const { ability, aim, telegraph: shown, combo } = endCast(actor);
      resolve(ability, actor, aim, shown);
      // Only a wind-up that ran out lands. One dropped — interrupted, or its
      // caster killed — leaves the chain where it was and lets the window
      // decide, which is the same thing that happens to a press that misses.
      if (combo) landChainStep(actor, combo);
    }
  }

  /**
   * Where an item dropped from (gx, gy) should land.
   *
   * Never under a wall, never off the map, and never on top of another drop —
   * two items on one tile would sit inside each other with their names
   * overlapping, and clicking would be a guess. Falls back to the tile asked
   * for when everything nearby is taken, which is better than refusing to drop
   * and leaving the player unable to empty a full bag.
   */
  function landingSpot(gx, gy) {
    const tx = Math.floor(gx);
    const ty = Math.floor(gy);
    const free = (x, y) => !world.isWall(x, y) && !ground.occupied(x, y);
    return nearestFree(tx, ty, free) ?? { tx, ty };
  }

  /**
   * Throw an item on the floor near the player.
   *
   * The player's position travels with it so the view can arc it across rather
   * than have it appear already lying where it landed.
   */
  function toss(item) {
    const { tx, ty } = landingSpot(pos.gx, pos.gy);
    return ground.drop(item, tx, ty, { gx: pos.gx, gy: pos.gy }, elapsed);
  }

  /**
   * Scatter a loot table's payout where something broke.
   *
   * What a table *pays* is decided in ../game/loot.js; this only knows where a
   * thing can land, which is the one part of it that needs the world.
   */
  function dropLoot(tableId, from) {
    if (!tableId) return [];
    // One pile per currency, each finding its own tile: landingSpot already
    // refuses a tile that is taken, so two piles cannot end up inside each
    // other with their plates overlapping.
    return rollLoot(tableId, { lootTables, currencies, items, categories }).map((pile) => {
      const { tx, ty } = landingSpot(from.gx, from.gy);
      return ground.drop(pile, tx, ty, { gx: from.gx, gy: from.gy }, elapsed);
    });
  }

  return {
    id: map.id,
    name: map.name,
    world,
    /** Everything this level drew, so the editor can hide or replace it. */
    root,
    /** Put this map's sky and fog back on the scene, after something else had it. */
    applyEnvironment: view.applyEnvironment,
    player,
    effects,
    abilities,
    projectiles,
    pos,
    env,
    monsters,
    debug,
    // The shapes the ground is painting. Exposed so anything else that wants to
    // mark the floor — a lingering ground effect, an impact — can add one
    // without going through the telegraph.
    decals,
    trails,

    /**
     * Player height in levels, for the camera and the body to track. `standAt`
     * rather than `heightAt`: an object you are meant to stand on is under the
     * player's feet, so it is part of where they are.
     */
    get height() {
      return world.standAt(pos.gx, pos.gy);
    },

    get alive() {
      return player.alive;
    },

    /** What the HUD draws: health, and the state of every ability slot. */
    /** The player's inventory, so items can be granted from outside. */
    inventory,

    /** What is lying on the floor. */
    ground,

    /**
     * Put something from the bag on the floor at the player's feet.
     * @returns the drop, or null if that cell was empty.
     */
    dropFromBag(index) {
      const item = inventory.takeAt(index);
      if (!item) return null;
      return toss(item);
    },

    /**
     * The same, for something being worn — which also takes its modifiers off.
     * Dropping a sword on the floor must not leave you still swinging it.
     */
    dropFromSlot(slotId) {
      const item = inventory.unequip(slotId);
      if (!item) return null;
      strip(player.attrs, item);
      syncLoadout();
      return toss(item);
    },

    /** What is on the cursor, or null. */
    get hand() {
      return held();
    },

    /**
     * Lift something onto the cursor. Refused when the hand is full — the
     * alternative is deciding where the thing already held should go, which is
     * the player's choice to make and not this one's.
     */
    takeFromBag(index) {
      if (held()) return null;
      hold(takeFromBag(inventory, index));
      return held();
    },

    takeFromSlot(slotId) {
      if (held()) return null;
      hold(takeFromSlot(player.attrs, inventory, slotId));
      syncLoadout();
      return held();
    },

    /**
     * Put the held item down in a bag cell. Whatever was there comes back to
     * the cursor, so a swap leaves you holding what you displaced.
     */
    placeInBag(index) {
      if (!held()) return { ok: false, reason: 'empty' };
      hold(placeInBag(inventory, index, held()));
      return { ok: true, reason: '' };
    },

    /** The same, onto the body — which is what puts its stats to work. */
    placeInSlot(slotId) {
      if (!held()) return { ok: false, reason: 'empty' };
      const result = placeInSlot(player.attrs, inventory, slotId, held());
      if (!result.ok) return result;
      hold(result.displaced);
      syncLoadout();
      return result;
    },

    /** Throw the held item on the floor. */
    dropHand() {
      if (!held()) return null;
      const drop = toss(held());
      hold(null);
      return drop;
    },

    /**
     * Put the held item back where it came from.
     *
     * For a press that landed on the interface but not on a cell: a miss is not
     * an instruction to throw the thing away. The original place is tried
     * first, then any free cell, and the floor only when there is genuinely
     * nowhere — the item is never lost.
     *
     * @param {{kind: 'bag'|'slot', id: number|string}|null} origin
     */
    returnHand(origin) {
      if (!held()) return { ok: false, reason: 'empty', to: null };
      const item = held();

      if (origin?.kind === 'slot' && !inventory.wearing(origin.id) && inventory.accepts(origin.id, item)) {
        hold(null);
        inventory.equip(origin.id, item);
        wear(player.attrs, item);
        syncLoadout();
        return { ok: true, reason: '', to: origin };
      }

      if (origin?.kind === 'bag' && inventory.at(origin.id) === null) {
        hold(null);
        inventory.put(origin.id, item);
        return { ok: true, reason: '', to: origin };
      }

      const free = inventory.firstFree();
      if (free >= 0) {
        hold(null);
        inventory.put(free, item);
        return { ok: true, reason: '', to: { kind: 'bag', id: free } };
      }

      hold(null);
      return { ok: true, reason: 'full', to: null, drop: toss(item) };
    },

    /**
     * Get rid of whatever is being held, without asking where.
     *
     * For the moments the cursor stops existing — closing the game, changing
     * map. The bag first, the floor if it is full; never nowhere.
     */
    stowHand() {
      if (!held()) return null;
      const item = held();
      hold(null);
      // Whatever the bag could not take goes on the floor rather than nowhere.
      const left = inventory.add(item);
      if (left) toss(left);
      return item;
    },

    /**
     * Wear something out of the bag.
     *
     * Nothing here decides what an item does — its stats are already modifiers,
     * so this is the same machinery a buff goes through.
     */
    equipFromBag(index) {
      const result = equipFromBag(player.attrs, inventory, index);
      syncLoadout();
      return result;
    },

    /** Take something off, back into the bag. */
    unequipToBag(slotId) {
      const result = unequipToBag(player.attrs, inventory, slotId);
      syncLoadout();
      return result;
    },

    /**
     * Take a drop off the floor.
     *
     * The bag is checked *before* the item is lifted: taking it first and then
     * finding nowhere to put it would mean either dropping it again on a tile
     * that may now be taken, or losing it outright.
     *
     * @returns {{ok: boolean, reason: string, item: object|null}}
     */
    pickUp: (id) => collect(id, { ground, character }),

    /** What the interact key would act on, named, or null. */
    interactTarget,

    /**
     * Where each name plate belongs, in world space: one per dropped item, and
     * one for the bench you are standing at.
     *
     * The same list on purpose. A plate is its own click target, and the hover
     * set that stops a click on one also swinging a sword is kept by whatever
     * draws them — so a bench that arrives through this list needs none of that
     * built again. Drop ids and station ids cannot collide.
     */
    groundAnchors() {
      const anchors = groundViews.anchors();
      const near = stationNear();
      if (!near) return anchors;
      const x = near.def.gx + 0.5;
      const z = near.def.gy + 0.5;
      return [
        ...anchors,
        {
          id: near.id,
          label: near.def.label || 'Crafting bench',
          x,
          y: world.heightAt(x, z) * LEVEL_H + STATION_PLATE_H,
          z,
        },
      ];
    },

    /**
     * What the player can do and what is bound where, for the abilities screen.
     * Read on demand: taking a sword off changes it, and so does dragging one
     * binding onto another.
     */
    loadout: () =>
      loadoutView({
        character,
        abilities: abilityDefs,
        innate: player.abilities,
        inventory,
        unarmed: archetypeById.get(player.archetype)?.unarmed ?? '',
      }),

    /** Bind one ability to one key. Dropping nothing on a key empties it. */
    assignSlot: (index, ability) => assignSlot(character, index, ability),

    /** What the player is carrying, named — for the status line. */
    purse: () => purseView(currencies, character),

    /** Whether there is a bench in reach — what closes the panel when you walk off. */
    nearStation: () => stationNear() !== null,

    /** Everything the bench panel draws. Read on demand: the purse moves. */
    crafting: () =>
      craftingView({ recipes, items, categories, attributes, currencies, baseLevels, character, place }),

    /** Set the bench going. The refusals are in ../game/crafting.js, not here. */
    craft: (recipeId) => beginCraft(recipeId, { recipes, items, categories, character, place }),

    upgradeBase: () => upgradeBase({ character, place, baseLevels }),

    /**
     * Everything the character sheet shows. Read on demand rather than kept,
     * because an attribute's value is computed lazily and a modifier can land
     * between two frames — so a cached copy would be one frame stale exactly
     * when a buff is what the player opened the sheet to look at.
     */
    character() {
      return {
        label: playerLabel,
        stats: player.attrs.ids.map((id) => {
          const def = player.attrs.definition(id);
          return {
            id,
            label: def?.label ?? id,
            kind: def?.kind ?? 'stat',
            value: player.attrs.value(id),
            current: player.attrs.current(id),
          };
        }),
        inventory: inventory.snapshot(),
        hand: held(),
      };
    },

    vitals() {
      return {
        health: player.attrs.current('health'),
        maxHealth: player.attrs.value('health'),
        cast: player.cast
          ? { label: player.cast.ability.label, progress: castProgress(player) }
          : null,
        // One per binding, bound or not: a key you have nothing on is still a
        // key, and a bar that grew and shrank as you changed weapons would move
        // the thing you were aiming for.
        slots: character.slots.map((id) => {
          const ability = id ? abilities.get(id) : null;
          if (!ability) return { id: null, label: '', fraction: 0, ready: false, step: null };
          return {
            id,
            label: ability.label ?? id,
            // 1 the instant it fires, easing to 0 as it comes back up. A combo
            // has two waits — its own cooldown after the finisher, and the
            // recovery between steps — and the key is unusable during either,
            // so the bar shows whichever is running.
            fraction: Math.max(cooldownFraction(ability, player), chainGapFraction(player, ability)),
            ready: canActivate(ability, player).ok,
            step: comboStep(ability),
          };
        }),
      };
    },

    movePlayer(dirX, dirZ, step) {
      // A dash owns the body while it lasts. Steering during one would add the
      // walk on top of the dash and overshoot the range that was authored.
      if (player.dash) return;
      world.move(pos, dirX * step, dirZ * step);
    },

    /**
     * Turn the body toward a heading, smoothly. Separate from moving because
     * the player looks where the cursor is, not where the keys point — the two
     * only agree when you happen to be walking at what you are aiming at.
     */
    facePlayer(heading, dt) {
      // Frozen for the same reason steering is: the dash was aimed once.
      if (player.dash) return;
      // Not straight to the heading: a wind-up in progress caps how fast the
      // body comes round, and is steered by the same turn.
      const turned = turnActor(player, heading, dt);
      playerView.face(Math.sin(turned), Math.cos(turned), dt);
    },

    /** Fire one of the player's ability slots. `aim` comes from the cursor. */
    useSlot(slot, aim) {
      const id = character.slots[slot];
      if (!id) return null;
      // The player is the one who may interrupt: pressing a different slot
      // abandons whatever is winding up.
      const result = activate(player, id, aim, { interrupt: true });
      // Snap the mesh to the direction that was actually used, so the visor
      // agrees with the cone that was just tested — which for a facing-aimed
      // ability is where the body already pointed, not where the cursor is.
      if (result.ok) playerView.snapTo(player.facing);
      return result;
    },

    activate,

    /**
     * @param {boolean} simulate false while paused: props keep animating so the
     * menu is not frozen, but monsters and portals hold still.
     */
    update(dt, simulate) {
      if (simulate) {
        tickActor(player, dt);
        for (const monster of monsters) tickActor(monster.actor, dt);

        // Before the AI runs, so an ability that finishes this frame lands
        // before anything decides to start another one.
        updateCasts(dt);
        for (const actor of actors()) {
          updateDash(actor, world, dt);
          trails.follow(actor, world);
        }
        // After the dashes, so an effect thrown at the start of one arrives
        // where its caster now is rather than a frame behind them.
        carryVfx();
        updateMonsters(monsters, world, pos, dt, activate);

        // Only the outward effects: a projectile's self effects already fired
        // when it was launched, not when it landed.
        projectiles.update(dt, world, actors(), (shot, target) =>
          landOnTarget(shot.ability, shot.source, target),
        );

        // Ticked after the hits land, so a killing blow and its regen tick
        // cannot both apply in the same frame.
        effects.update(dt);
        reap();

        // After reaping, so coin dropped by something that died this frame is
        // swept up in the same one when you were standing over it — which for
        // a melee kill you always are. A pile you are not standing on stays
        // where it fell.
        sweepCoin(pos, { ground, character, now: elapsed });

        // The bench works while the game runs, not while its panel is open:
        // walking away from a bench mid-craft leaves you holding a receipt, not
        // a loss. It follows you because the job is the character's.
        if (advanceCraft(character, dt)) {
          const { item, stowed } = finishCraft(character, { recipes, items, categories });
          // Paid for, so it is never dropped on the floor of the argument that
          // there is nowhere to put it — the actual floor will do.
          if (item && !stowed) toss(item);
        }
      }

      // With the frame's dt, so the body climbs a step rather than hopping it.
      // The one at build time deliberately has none: it should start where it
      // stands, not fly in.
      playerView.sync(pos.gx, pos.gy, this.height, dt);
      monsterViews.sync(world);
      projectileViews.sync(projectiles.list, world);

      // The rest of this runs whether or not the game is simulating: whatever
      // is already on screen should keep fading, turning and flickering while
      // the game is paused rather than freezing mid-animation.
      elapsed += dt;
      groundViews.sync(ground.list(), world, elapsed);
      debug.update(dt);
      // One flush a frame, after everything that owns a shape has moved it.
      decals.sync();
      trails.update(dt);

      // Torch flicker, on the flame mesh only — the torches emit no light now.
      for (const torch of torches) {
        torch.phase += dt * 9;
        const flicker = 0.86 + Math.sin(torch.phase) * 0.07 + Math.sin(torch.phase * 2.7) * 0.05;
        torch.flame.scaling.setAll(0.9 + flicker * 0.2);
      }

      for (const portal of portals) {
        portal.phase += dt;
        // The torus is built lying flat, so it spins about the world's up axis.
        portal.ring.rotation.y += dt * 1.4;
        portal.ring.position.y = 0.55 + Math.sin(portal.phase * 2) * 0.06;
        portal.disc.material.alpha = 0.45 + Math.sin(portal.phase * 3) * 0.12;
      }
    },

    /**
     * The portal the player is standing on and that is allowed to fire, or
     * null. Re-arms once they walk off whatever they arrived next to.
     */
    pendingPortal() {
      const here = this.world.portalAt(pos.gx, pos.gy);
      if (!here) {
        portalArmed = true;
        return null;
      }
      return portalArmed ? here : null;
    },

    destroy() {
      groundViews.dispose();
      trails.dispose();
      debug.dispose();
      projectileViews.dispose();
      monsterViews.dispose();
      playerView.dispose();
      vfx.dispose();
      view.dispose();
    },
  };
}
