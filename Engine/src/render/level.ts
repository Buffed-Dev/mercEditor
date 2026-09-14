import { getMap } from '../data/maps/index.ts';
import { ATTRIBUTES } from '../data/attributes.ts';
import { EFFECTS } from '../data/effects.ts';
import { ABILITIES, abilityMap } from '../data/abilities.ts';
import { ARCHETYPES, archetypeMap } from '../data/archetypes.ts';
import { World } from '../game/world.ts';
import { ACTIONS, runActions } from '../game/actions/index.ts';
import { EVENTS, WIRABLE_LISTS, wiringsFor } from '../game/events/index.ts';
import { PREFABS, isActorPrefab, override, prefabBounds, prefabById } from '../data/prefabs.ts';
import type { PlacedPrefab, Prefab } from '../data/prefabs.ts';
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
import { Monster, updateMonsters } from '../game/monsters.ts';
import { Vector3 } from '@babylonjs/core/Maths/math.vector.js';
import { LEVEL_H } from '../data/dimensions.ts';
import { buildMapView } from './mapView.ts';
import { createDebugViews } from './debug.ts';
import { createActorViews } from './monsters.ts';
import { createProjectileViews } from './projectiles.ts';
import { createGroundItemViews } from './groundItems.ts';
import { createTrailViews } from './trail.ts';
import { createVfxRuntime } from './vfx.ts';
import { VFX } from '../data/vfx.ts';
import type { Scene } from '@babylonjs/core/scene.js';
import type { Ability, AbilityInput } from '../data/abilities.ts';
import type { ArchetypeInput } from '../data/archetypes.ts';
import type { AttributeInput } from '../data/attributes.ts';
import type { BaseLevelInput } from '../data/baseLevels.ts';
import type { CategoryInput } from '../data/categories.ts';
import type { Currency, ItemInput } from '../data/items.ts';
import type { EffectInput } from '../data/effects.ts';
import type { GameMap, MapObject, Placed } from '../data/mapFormat.ts';
import type { ActionIntent } from '../game/actions/index.ts';
import type { LootTableInput } from '../data/lootTables.ts';
import type { RecipeInput } from '../data/recipes.ts';
import type { VfxInput } from '../data/vfx.ts';
import type { Actor } from '../game/actor.ts';
import type { Cast } from '../game/abilities.ts';
import type { Character } from '../game/character.ts';
import type { Place } from '../game/crafting.ts';
import type { ItemInstance } from '../game/items.ts';
import type { Cell } from '../ui/itemCursor.ts';
import type { Telegraph } from './debug.ts';
import type { Plate } from './groundItems.ts';
import type { VfxHandle } from './vfx.ts';

/** Everything a level can be told to use instead of the shipped tables. */
export type LevelRules = {
  attributes?: readonly AttributeInput[];
  effects?: readonly EffectInput[];
  abilities?: readonly AbilityInput[];
  archetypes?: readonly ArchetypeInput[];
  items?: readonly ItemInput[];
  recipes?: readonly RecipeInput[];
  categories?: readonly CategoryInput[];
  currencies?: readonly Currency[];
  lootTables?: readonly LootTableInput[];
  baseLevels?: readonly BaseLevelInput[];
  vfx?: readonly VfxInput[];
};

/** What using an ability did, and to whom. */
export type ActivateResult = {
  ok: boolean;
  reason: string;
  hits: Actor[];
  /** True when the ability has only begun winding up. */
  casting?: boolean;
};

/**
 * A telegraph, as the cast it is hung on describes it.
 *
 * `Cast` says what is done to one without naming the renderer's type, so the
 * level speaks in the same terms -- a real Telegraph satisfies it.
 */
type Shown = NonNullable<Cast['telegraph']>;

/** The nearest thing worth pressing a key at. */
export type InteractTarget = { id: string; label: string; distance: number };

/** A crafting bench within reach. */

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
export function createLevel(
  scene: Scene,
  source: string | GameMap,
  spawnName = 'default',
  rules: LevelRules = {},
  // No default: a level with no character has nothing to read an inventory
  // off, and the line below did so unconditionally. The one caller passes both.
  { character, place }: { character: Character; place: Place },
) {
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
  const { root, decals, shadows, env } = view;

  const effects = createEffectRuntime(effectDefs);
  const abilities = abilityMap(abilityDefs);
  const projectiles = createProjectiles();

  // One index for both the player's label and every actor's loot table.
  const archetypeById = archetypeMap(archetypes);
  const actorViews = createActorViews(scene, root, shadows);

  /**
   * Everything standing on this map that was built from an archetype.
   *
   * An actor is a prefab naming an archetype, spawned whole — see
   * `isActorPrefab` — and what drives it is the archetype's brain: `ai` gets
   * a Monster, `player` is the one below, `none` just stands there and can be
   * hit. `placement` is the index into `map.prefabs` it came from, which is
   * where its wirings are written.
   */
  type Spawned = { actor: Actor; placement: number | null; ai: Monster | null };
  const spawned: Spawned[] = [];

  function spawnActor(
    prefab: Prefab | null,
    archetype: string,
    at: Placed,
    placement: number | null,
    set?: Record<string, unknown>,
  ): Actor {
    const spec = archetypeById.get(archetype);
    const actor = createActor({
      archetype,
      gx: at.gx,
      gy: at.gy,
      // Melee reach and projectile collision both measure to a body's edge,
      // so the actor needs to know how wide it is.
      radius: prefab && prefab.w > 0 ? Math.min(prefab.w, prefab.h) / 2 : undefined,
      attributes,
      archetypes: archetypeById,
      values: { ...prefab?.attributes, ...(set?.attributes as Record<string, number> | undefined) },
    });
    grantStartingEffects(actor, effects);
    const brain = spec?.brain ?? 'none';
    actorViews.add(actor, prefab, brain === 'ai');
    if (brain !== 'player') spawned.push({ actor, placement, ai: brain === 'ai' ? new Monster(actor) : null });
    return actor;
  }

  // The player is the prefab whose archetype says so, stood at the spawn
  // point; without one the archetype alone will do, in the stand-in body.
  const playerPrefab = PREFABS.find((one) => archetypeById.get(String(one.archetype))?.brain === 'player');
  const player = spawnActor(playerPrefab ?? null, playerPrefab?.archetype ?? 'player', world.spawn, null);

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

  // Everything else that stands up: each actor placement, whole. The player's
  // own prefab placed on a map is skipped — there is one player, and it is
  // where the spawn point says.
  (map.prefabs ?? []).forEach((at, index) => {
    const record = at.id ? prefabById(String(at.id)) : null;
    if (!record || !isActorPrefab(record)) return;
    const archetype = String(record.archetype);
    if (archetypeById.get(archetype)?.brain === 'player') return;
    const box = prefabBounds(record, at as PlacedPrefab);
    const middle = { gx: box.gx + Math.max(1, box.w) / 2, gy: box.gy + Math.max(1, box.h) / 2 };
    spawnActor(record, archetype, middle, index, at.set as Record<string, unknown> | undefined);
  });
  /** The ones with a brain of their own. Spliced as they die; see `reap`. */
  const monsters: Monster[] = spawned.flatMap((one) => (one.ai ? [one.ai] : []));
  // Ability flashes, and the trails the shots leave. The map's own placed
  // effects are the map view's; these are the ones something *does*, so they
  // are thrown one at a time and clean themselves up when they burn out.
  const vfx = createVfxRuntime(scene, vfxDefs);
  /** The ones still playing that belong to an actor — see `carryVfx`. */
  const carried: { handle: VfxHandle; at: () => Vector3 }[] = [];
  const projectileViews = createProjectileViews(scene, root, vfx);
  const groundViews = createGroundItemViews(scene, root, shadows);
  // Handed the decal registry rather than the scene: a telegraph is a shape
  // the ground draws on itself, so there is no mesh to add anywhere.
  const debug = createDebugViews(decals);
  const trails = createTrailViews(scene, root);

  actorViews.sync(world);

  /**
   * One wired thing on this map, resolved down to what runs.
   *
   * `object` is what the wirings are read off. For most lists that is the map
   * entry itself; for a prefab it is the prefab's own record with the
   * placement's settings laid over it, because a prefab's wirings belong to the
   * arrangement and a placement only says what this one of them does.
   *
   * `tiles` is what walking onto it means — one tile for a thing that stands on
   * one, and the whole footprint for a prefab. `centre` is what standing near
   * it is measured from, so a wide bench is not further away at one end.
   */
  type Wired = {
    list: string;
    index: number;
    object: MapObject;
    label: string;
    tiles: readonly string[];
    centre: { x: number; z: number };
    /** What the thing itself says the reach is, or null to let the action say. */
    radius: number | null;
    /** Half its footprint, added to an action's reach when it names no radius. */
    span: number;
  };

  /** A map entry as the thing whose wirings run, or null if it names nothing. */
  function resolveWired(list: string, entry: MapObject, index: number): Wired | null {
    const gx = Number(entry.gx);
    const gy = Number(entry.gy);
    if (!Number.isFinite(gx) || !Number.isFinite(gy)) return null;

    const tile = (w: number, h: number, fromX = gx, fromY = gy) => {
      const keys: string[] = [];
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) keys.push(`${Math.floor(fromX) + x},${Math.floor(fromY) + y}`);
      }
      return keys;
    };

    if (list !== 'prefabs') {
      return {
        list,
        index,
        object: entry,
        label: typeof entry.label === 'string' ? entry.label : '',
        tiles: tile(1, 1),
        centre: { x: gx + 0.5, z: gy + 0.5 },
        radius: null,
        span: 0,
      };
    }

    const record = entry.id ? prefabById(String(entry.id)) : null;
    // A placement naming a prefab that is gone is wired to nothing, the same
    // way it draws nothing. Silent and symmetrical; see expandPrefabs.
    if (!record) return null;
    const box = prefabBounds(record, entry as unknown as PlacedPrefab);
    const { w, h } = box;
    const object = override(record as unknown as MapObject, entry.set as Record<string, unknown>);
    const asked = Number(object.radius);
    return {
      list,
      index,
      object,
      label: record.label,
      tiles: tile(Math.max(1, Math.ceil(w)), Math.max(1, Math.ceil(h)), box.gx, box.gy),
      centre: { x: box.gx + Math.max(1, w) / 2, z: box.gy + Math.max(1, h) / 2 },
      // How close you must be to use it, if the prefab says. Zero is "it does
      // not say" rather than "you must be standing inside it", which no slider
      // starting at zero could otherwise express.
      radius: Number.isFinite(asked) && asked > 0 ? asked : null,
      // How far its own edge is from its middle. Added to an action's reach
      // when the prefab names no radius of its own, so a long bench is not
      // unreachable at one end — and zero for a single tile, which is what
      // every reach was measured against before prefabs could be wired.
      span: Math.max(Math.max(1, w), Math.max(1, h)) / 2 - 0.5,
    };
  }

  /** Every wired thing on this map, by event. */
  const wired = new Map<string, Wired[]>();
  for (const event of Object.keys(EVENTS)) {
    const found: Wired[] = [];
    // Every list that can hold one, prefabs included, and no check of whether
    // the editor would still *offer* this trigger here: what fires is what is
    // written. Re-categorising a prefab must not quietly stop a trigger that is
    // already on it — that would be a map breaking from a change to a picker.
    for (const list of [...WIRABLE_LISTS, 'prefabs']) {
      const entries = (map as Record<string, unknown>)[list];
      if (!Array.isArray(entries)) continue;
      entries.forEach((entry: MapObject, index: number) => {
        const one = resolveWired(list, entry, index);
        if (one && wiringsFor(list, event, one.object).length) found.push(one);
      });
    }
    wired.set(event, found);
  }

  /**
   * The tiles that fire something when walked onto, by "gx,gy".
   *
   * Built once here rather than scanned each frame — which is what the portal
   * lookup this replaces did — so a map with three hundred wired objects costs
   * a frame no more than a map with one.
   */
  const collisionTiles = new Map<string, Wired[]>();
  for (const one of wired.get('collision') ?? []) {
    for (const key of one.tiles) {
      const at = collisionTiles.get(key);
      if (at) at.push(one);
      else collisionTiles.set(key, [one]);
    }
  }

  /**
   * The tile whose collision wirings have already fired. Re-arms by walking off.
   *
   * Starts as the tile the player arrived on, so a portal you were put down
   * beside cannot fire before you have stepped off it — otherwise a two-way
   * pair bounces you back and forth forever. That was a boolean when portals
   * were the only thing that could fire; a tile key is the same rule with the
   * "there was nothing there" case removed.
   */
  let firedTile = `${Math.floor(pos.gx)},${Math.floor(pos.gy)}`;

  /**
   * The engine surface an action may touch.
   *
   * Named slices rather than the level itself, on purpose: every action ever
   * written can reach whatever is in here, so whatever is in here is what can
   * never be changed again. Grow it a field at a time, as a verb needs one.
   */
  const actionContext = () => ({
    player,
    world,
    effects,
    level: { pickUp: (id: string) => collect(id, { ground, character }) },
  });

  /** What actions raised mid-frame, drained by `pendingActions`. */
  const queued: ActionIntent[] = [];

  /** What each actor's health was last frame, so a drop can be noticed. */
  const lastHealth = new WeakMap<object, number>();

  /**
   * Tell anything wired to `hit` that it has been hit.
   *
   * Watched rather than hooked into, because there is no one damage path to
   * hook: a cone, a projectile and a burning effect all arrive by different
   * routes, and none of them should have to learn that this exists. They all
   * move the same number, so watching that number catches every one of them —
   * including the ones nobody has written yet.
   *
   * ponytail: a frame is the resolution, so two arrows landing together fire
   * once. Count the difference into the wiring if that ever matters.
   */
  function fireHits(): void {
    for (const one of spawned) {
      const health = one.actor.attrs.current('health');
      const was = lastHealth.get(one.actor);
      lastHealth.set(one.actor, health);
      if (was === undefined || health >= was) continue;
      fireOn(one, 'hit');
    }
  }

  /**
   * Run what an actor's placement has wired to an event. The wiring is on the
   * placement — the prefab's own record with this one's settings laid over it
   * — because that is the thing an editor typed at; the body was built from it.
   */
  function fireOn(one: Spawned, event: string): void {
    if (one.placement === null) return;
    const placement = (map.prefabs ?? [])[one.placement] as MapObject | undefined;
    const whole = placement ? resolveWired('prefabs', placement, one.placement) : null;
    if (!whole) return;
    queued.push(
      ...runActions(wiringsFor('prefabs', event, whole.object), {
        ...actionContext(),
        object: whole.object,
      }),
    );
  }

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
  const hold = (item: ItemInstance | null | undefined) => character.setHand(item);

  /** Clear of the object itself, so the plate is readable and clickable. */
  const WIRED_PLATE_H = 1.3;

  /** How a wired object is named to the plates and back again. */
  const wiredId = (one: Wired) => `on:${one.list}:${one.index}`;

  /**
   * What a wired object is called on its plate.
   *
   * Its own label if it has one — a map file may put anything in the field —
   * and otherwise what the action it runs is called, so a thing wired to open a
   * panel reads as "Open a panel" rather than as nothing at all.
   */
  function wiredLabel(one: Wired): string {
    if (one.label) return one.label;
    const first = wiringsFor(one.list, 'interact', one.object)[0];
    const spec = typeof first?.do === 'string' ? ACTIONS[first.do] : null;
    return spec?.label ?? 'Thing';
  }

  /**
   * Every wired object within reach of being used, nearest first.
   *
   * Reach at all, rather than clicking one across the room, because the plate
   * *is* the button: an unfiltered one is a bench you could work at through a
   * wall. How far is the action's business (`ActionSpec.reach`) — a bench is a
   * big thing you stand at, a lever is something you put your hand on.
   */
  function useNear(): { one: Wired; distance: number }[] {
    const found: { one: Wired; distance: number }[] = [];
    for (const one of wired.get('interact') ?? []) {
      const distance = Math.hypot(one.centre.x - pos.gx, one.centre.z - pos.gy);
      // What the thing itself says, when it says anything. A reach is a fact
      // about the thing you are walking up to at least as much as about what
      // pressing the key does, and only the thing knows how big it is.
      //
      // Otherwise the furthest any of its actions asks for — a wiring that
      // opens a bench and says a line is reachable from wherever the bench is —
      // plus half the thing's own footprint, so a wide one is not out of reach
      // at its edges while its middle is fine.
      const reach =
        one.radius ??
        wiringsFor(one.list, 'interact', one.object).reduce(
          (far, wiring) =>
            Math.max(far, (typeof wiring.do === 'string' ? ACTIONS[wiring.do]?.reach : 0) ?? 0),
          INTERACT_REACH,
        ) + one.span;
      if (distance <= reach) found.push({ one, distance });
    }
    return found.sort((a, b) => a.distance - b.distance);
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
  function interactTarget(): InteractTarget | null {
    let best: InteractTarget | null = null;
    const offer = (id: string, label: string, distance: number) => {
      if (!best || distance < best.distance) best = { id, label, distance };
    };

    for (const drop of ground.list()) {
      const distance = Math.hypot(drop.gx - pos.gx, drop.gy - pos.gy);
      if (distance <= INTERACT_REACH) offer(drop.id, drop.item?.label ?? 'Item', distance);
    }

    for (const { one, distance } of useNear()) offer(wiredId(one), wiredLabel(one), distance);

    return best;
  }

  /**
   * Run what the interact key or a plate click landed on.
   *
   * A wired object is named by which list it is on and where in it, which is
   * only sound because expansion *appends* prefab children and never inserts
   * them — the same contract the editor's pick tags rest on. See
   * data/prefabs.ts; there is a test holding it.
   */
  function use(id: string): ActionIntent[] {
    const one = (wired.get('interact') ?? []).find((found) => wiredId(found) === id);
    if (!one) return [];
    return runActions(wiringsFor(one.list, 'interact', one.object), {
      ...actionContext(),
      object: one.object,
    });
  }

  /** Everything that can be hit, player included. */

  const actors = () => [player, ...spawned.map((one) => one.actor)];

  /** Clear out anything the last tick killed, meshes included. */
  function reap() {
    for (let i = spawned.length - 1; i >= 0; i--) {
      const one = spawned[i];
      if (!one || one.actor.alive) continue;
      // What falls out is a loot table the archetype names, so two monsters can
      // share one purse and a vase can name the same one without becoming a
      // monster to do it. What *this* one does besides is its `dead` wiring.
      //
      // It lands on the floor rather than in the purse: killing something
      // across the room should leave you something to walk over to, and the arc
      // from the corpse is the beat that says the kill paid out.
      dropLoot(archetypeById.get(one.actor.archetype)?.loot, one.actor.pos);
      fireOn(one, 'dead');
      effects.removeByTarget(one.actor);
      actorViews.remove(one.actor);
      spawned.splice(i, 1);
      if (one.ai) monsters.splice(monsters.indexOf(one.ai), 1);
    }
  }

  /**
   * The effects aimed at whatever was struck. Called once per victim, so a cone
   * that catches three monsters applies these three times.
   */
  function landOnTarget(ability: Ability, caster: Actor, target: Actor): void {
    for (const { effect, to } of ability.effects) {
      if (to !== 'self') effects.apply(effect, target, caster);
    }
  }

  /**
   * The effects aimed at the caster. Called exactly once when the ability goes
   * off, hit or miss — otherwise a wide swing through a crowd would wind the
   * attacker once per monster, and a whiff would not wind them at all.
   */
  function landOnSelf(ability: Ability, caster: Actor): void {
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
  function activate(
    actor: Actor,
    abilityId: string,
    aim = actor.facing,
    { interrupt = false } = {},
  ): ActivateResult {
    const ability = abilities.get(abilityId);

    // A combo is not something that happens; it is a decision about which of
    // its steps happens, and then that step goes through everything below
    // exactly as it would in a slot of its own.
    if (ability?.target === 'combo') return activateCombo(ability, actor, aim, { interrupt });

    // An id nobody recognises is answered as such rather than carried down the
    // rest of this function. `canActivate` below says the same thing, but only
    // after three reads of the ability that would already have thrown.
    if (!ability) return { ok: false, reason: 'unknown', hits: [] };

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
    if (actor.cast && (!cutsIn || ability.interrupts)) endCast(actor)?.telegraph?.cancel();

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
  function activateCombo(
    combo: Ability,
    actor: Actor,
    aim: number,
    opts: { interrupt?: boolean },
  ): ActivateResult {
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
    const step = abilities.get(combo.steps[index] ?? '');
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
  function landChainStep(actor: Actor, combo: Ability): void {
    if (advanceChain(actor, combo)) beginCooldown(combo, actor);
  }

  /** The ability actually going off — immediately, or at the end of its cast. */
  /**
   * The area a melee ability is winding up to test, drawn from the moment the
   * cast starts. Nothing else has an area to show: a projectile is a body that
   * travels and a dash moves the caster, so neither has a wedge to stand in.
   */
  function telegraph(ability: Ability, actor: Actor, aim: number): Telegraph | null {
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
  function followTelegraph(cast: { telegraph?: Shown | null; aim: number }, actor: Actor): void {
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
  function playVfx(ability: Ability, actor: Actor, aim: number): void {
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
  function carryVfx(): void {
    for (let i = carried.length - 1; i >= 0; i--) {
      const one = carried[i]!;
      if (!one.handle.alive) carried.splice(i, 1);
      else one.handle.follow(one.at());
    }
  }

  /** @param {object|null} shown the wind-up's shape, if it had one */
  function resolve(
    ability: Ability,
    actor: Actor,
    aim: number,
    shown: Shown | null = null,
  ): ActivateResult {
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
  function comboStep(ability: Ability) {
    if (ability.target !== 'combo' || !ability.steps.length) return null;
    const index = chainIndex(player, ability);
    // A chain index past the end would be a bug in `chainIndex`, but the step
    // it names is still only a name: an unknown one labels itself.
    const id = ability.steps[index] ?? '';
    const step = abilities.get(id);
    return {
      index: index + 1,
      count: ability.steps.length,
      label: step?.label ?? id,
    };
  }

  /** Advance every wind-up, firing the ones that finish. */
  function updateCasts(dt: number): void {
    for (const actor of actors()) {
      updateChain(actor, dt);
      updateCastSlow(actor, dt);

      const cast = actor.cast;
      if (!cast) continue;

      // A caster killed mid-wind-up drops it, slow and all.
      if (!actor.alive) {
        endCast(actor)?.telegraph?.cancel();
        continue;
      }

      cast.remaining -= dt;
      // Placed on the finishing frame too, so the shape that flashes is under
      // the caster the hit test is about to run from — not a frame behind it.
      followTelegraph(cast, actor);
      if (cast.remaining > 0) continue;

      // Ended before resolving, so the slow is already gone when the ability
      // lands and a dash or knockback would not fight it.
      // `endCast` hands back the same cast that was read above, which is
      // already known to be there.
      endCast(actor);
      const { ability, aim, telegraph: shown, combo } = cast;
      resolve(ability, actor, aim, shown ?? null);
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
  function landingSpot(gx: number, gy: number): { tx: number; ty: number } {
    const tx = Math.floor(gx);
    const ty = Math.floor(gy);
    const free = (x: number, y: number) => !world.isWall(x, y) && !ground.occupied(x, y);
    return nearestFree(tx, ty, free) ?? { tx, ty };
  }

  /**
   * Throw an item on the floor near the player.
   *
   * The player's position travels with it so the view can arc it across rather
   * than have it appear already lying where it landed.
   */
  function toss(item: ItemInstance | null | undefined) {
    const { tx, ty } = landingSpot(pos.gx, pos.gy);
    return ground.drop(item, tx, ty, { gx: pos.gx, gy: pos.gy }, elapsed);
  }

  /**
   * Scatter a loot table's payout where something broke.
   *
   * What a table *pays* is decided in ../game/loot.js; this only knows where a
   * thing can land, which is the one part of it that needs the world.
   */
  function dropLoot(tableId: string | undefined, from: Placed) {
    if (!tableId) return [];
    // One pile per currency, each finding its own tile: landingSpot already
    // refuses a tile that is taken, so two piles cannot end up inside each
    // other with their plates overlapping.
    return rollLoot(tableId, { lootTables, currencies, items, categories }).map((pile) => {
      const { tx, ty } = landingSpot(from.gx, from.gy);
      return ground.drop(pile, tx, ty, { gx: from.gx, gy: from.gy }, elapsed);
    });
  }

  /**
   * How far off the floor the player is standing.
   *
   * A function rather than only a getter, so the frame below can ask without
   * going through `this` -- which would make the returned type depend on
   * itself before it is finished being described.
   */
  const heightNow = () => world.standAt(pos.gx, pos.gy);

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
      return heightNow();
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
    dropFromBag(index: number) {
      const item = inventory.takeAt(index);
      if (!item) return null;
      return toss(item);
    },

    /**
     * The same, for something being worn — which also takes its modifiers off.
     * Dropping a sword on the floor must not leave you still swinging it.
     */
    dropFromSlot(slotId: string) {
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
    takeFromBag(index: number) {
      if (held()) return null;
      hold(takeFromBag(inventory, index));
      return held();
    },

    takeFromSlot(slotId: string) {
      if (held()) return null;
      hold(takeFromSlot(player.attrs, inventory, slotId));
      syncLoadout();
      return held();
    },

    /**
     * Put the held item down in a bag cell. Whatever was there comes back to
     * the cursor, so a swap leaves you holding what you displaced.
     */
    placeInBag(index: number) {
      if (!held()) return { ok: false, reason: 'empty' };
      hold(placeInBag(inventory, index, held()));
      return { ok: true, reason: '' };
    },

    /** The same, onto the body — which is what puts its stats to work. */
    placeInSlot(slotId: string) {
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
    returnHand(origin: Cell | null) {
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
    equipFromBag(index: number) {
      const result = equipFromBag(player.attrs, inventory, index);
      syncLoadout();
      return result;
    },

    /** Take something off, back into the bag. */
    unequipToBag(slotId: string) {
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
    pickUp: (id: string) => collect(id, { ground, character }),

    /** What the interact key would act on, named, or null. */
    interactTarget,

    /**
     * Where each name plate belongs, in world space: one per dropped item, and
     * one for the bench you are standing at.
     *
     * The same list on purpose. A plate is its own click target, and the hover
     * set that stops a click on one also swinging a sword is kept by whatever
     * draws them — so a bench that arrives through this list needs none of that
     * built again. Drop ids and wired-object ids cannot collide.
     */
    groundAnchors(): readonly Plate[] {
      return [
        ...groundViews.anchors(),
        ...useNear().map(({ one }) => {
          const x = Number(one.object.gx) + 0.5;
          const z = Number(one.object.gy) + 0.5;
          return {
            id: wiredId(one),
            label: wiredLabel(one),
            x,
            y: world.heightAt(x, z) * LEVEL_H + WIRED_PLATE_H,
            z,
          };
        }),
      ];
    },

    /** Run what a plate click or the interact key landed on. */
    use,

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
    assignSlot: (index: number, ability: string | null) =>
      assignSlot(character, index, ability),

    /** What the player is carrying, named — for the status line. */
    purse: () => purseView(currencies, character),

    /**
     * Is this wired object still close enough to use?
     *
     * What closes a panel when you walk away from whatever opened it. Asked by
     * id rather than by kind, so the rule is "you left the thing you were at"
     * for every wired object there will ever be, rather than a special case per
     * panel that opens.
     */
    inReach: (id: string) => useNear().some(({ one }) => wiredId(one) === id),

    /** Everything the bench panel draws. Read on demand: the purse moves. */
    crafting: () =>
      craftingView({ recipes, items, categories, attributes, currencies, baseLevels, character, place }),

    /** Set the bench going. The refusals are in ../game/crafting.js, not here. */
    craft: (recipeId: string) =>
      beginCraft(recipeId, { recipes, items, categories, character, place }),

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

    movePlayer(dirX: number, dirZ: number, step: number): void {
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
    facePlayer(heading: number, dt: number): void {
      // Frozen for the same reason steering is: the dash was aimed once.
      if (player.dash) return;
      // Not straight to the heading: a wind-up in progress caps how fast the
      // body comes round, and is steered by the same turn.
      turnActor(player, heading, dt);
    },

    /** Fire one of the player's ability slots. `aim` comes from the cursor. */
    useSlot(slot: number, aim: number): ActivateResult | null {
      const id = character.slots[slot];
      if (!id) return null;
      // The player is the one who may interrupt: pressing a different slot
      // abandons whatever is winding up.
      const result = activate(player, id, aim, { interrupt: true });
      return result;
    },

    activate,

    /**
     * @param {boolean} simulate false while paused: props keep animating so the
     * menu is not frozen, but monsters and portals hold still.
     */
    update(dt: number, simulate: boolean): void {
      if (simulate) {
        for (const actor of actors()) tickActor(actor, dt);

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
        // Before reaping, so a killing blow still tells the thing it killed.
        fireHits();
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
      actorViews.sync(world, dt);
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

    },

    /**
     * What walking onto the current tile set off, run, as intents to apply.
     *
     * Fires on arriving at a tile and not again until the player leaves it, so
     * standing on a portal does not re-trigger it sixty times a second.
     *
     * ponytail: this samples the tile the player is on once a frame, not the
     * path they took to it — a fast enough dash steps clean over a one-tile
     * hazard. Sweep the segment if that ever becomes a complaint.
     */
    pendingActions(): ActionIntent[] {
      // Whatever the frame raised — being hit, so far — drained here so that
      // every action, however it was set off, is carried out in the one place
      // that is allowed to carry one out. See `apply` in main.ts.
      const raised = queued.splice(0, queued.length);

      const key = `${Math.floor(pos.gx)},${Math.floor(pos.gy)}`;
      if (key === firedTile) return raised;
      firedTile = key;
      const here = collisionTiles.get(key);
      if (!here) return raised;
      const context = actionContext();
      return raised.concat(
        here.flatMap((one) =>
          runActions(wiringsFor(one.list, 'collision', one.object), {
            ...context,
            object: one.object,
          }),
        ),
      );
    },

    destroy(): void {
      groundViews.dispose();
      trails.dispose();
      debug.dispose();
      projectileViews.dispose();
      actorViews.dispose();
      vfx.dispose();
      view.dispose();
    },
  };
}

/** One map, running: its world, its actors, and everything drawn for them. */
export type Level = ReturnType<typeof createLevel>;
