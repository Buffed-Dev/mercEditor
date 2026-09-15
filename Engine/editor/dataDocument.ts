import { ATTRIBUTES, defaultAttribute } from '../src/data/attributes.ts';
import { ARCHETYPES, defaultArchetype } from '../src/data/archetypes.ts';
import { ABILITIES, defaultAbility } from '../src/data/abilities.ts';
import { EFFECTS, defaultEffect, defaultModifier } from '../src/data/effects.ts';
import { ITEMS, defaultItem, defaultItemStat } from '../src/data/items.ts';
import { RECIPES, defaultRecipe } from '../src/data/recipes.ts';
import { CATEGORIES, behaviourOf, defaultCategory } from '../src/data/categories.ts';
import { defaultCost } from '../src/data/costs.ts';
import { LOOT_TABLES, defaultLootRoll, defaultLootTable } from '../src/data/lootTables.ts';
import { BASE_LEVELS, defaultBaseLevel } from '../src/data/baseLevels.ts';
import { VFX, defaultVfx } from '../src/data/vfx.ts';
import { TERRAINS, TERRAIN_FIELDS, defaultTerrain, normalizeTerrain } from '../src/data/terrains.ts';
import {
  MATERIALS,
  MATERIAL_FIELDS,
  defaultMaterial,
  normalizeMaterial,
} from '../src/data/materials.ts';
import { PROPS, PROP_FIELDS, defaultProp, normalizeProp } from '../src/data/props.ts';
import { PREFABS, defaultPrefab, normalizePrefab } from '../src/data/prefabs.ts';
import { PROFILES, defaultProfile, normalizeProfile } from '../src/data/profiles.ts';
import { ID_PATTERN, idFromLabel } from './serializeData.ts';

// Where a name becomes an id lives beside where it becomes a filename, so
// the two cannot drift. Re-exported because this is where callers look.
export { idFromLabel };
import { createUndoable } from './undoable.ts';

/**
 * One record of a rules list, while the editor holds it.
 *
 * Deliberately loose. This module edits the rules as a graph -- renaming an
 * attribute walks every effect, ability, item and archetype that could name it
 * -- and the shapes it walks through belong to fourteen different lists. Every
 * field it reads goes through one of the three readers below, so a rules file
 * carrying something unexpected is described rather than assumed.
 */
export type RuleRecord = Record<string, unknown>;

/** Every rules list, by name. */
export type RulesData = Record<string, RuleRecord[]>;

/** A nested record, or null when that is not what is there. */
const obj = (value: unknown): RuleRecord | null =>
  value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as RuleRecord)
    : null;

/** A nested list. The same array, so writing through it still writes home. */
const arr = (value: unknown): RuleRecord[] => (Array.isArray(value) ? (value as RuleRecord[]) : []);

/** A field read as text. */
const text = (value: unknown): string => (typeof value === 'string' ? value : '');

/** A list of ids. Every rules list that references another holds one. */
const texts = (value: unknown): string[] => (Array.isArray(value) ? value.map(text) : []);

/**
 * The editable rules document: attributes, effects, abilities, archetypes and
 * items together.
 *
 * They travel as one because they reference each other — an effect names an
 * attribute, an archetype names both, an item's stat lines name attributes too
 * — so an undo that restored one without the others could leave a dangling
 * reference. One document, one history.
 *
 * The three lists are all arrays of objects carrying an `id`, which is what
 * lets the editor's generic list/inspector render them the same way it renders
 * map objects.
 */

const LISTS = [
  'attributes',
  'effects',
  'abilities',
  'archetypes',
  'items',
  'categories',
  'recipes',
  'lootTables',
  'baseLevels',
  'vfx',
  'materials',
  'terrains',
  'props',
  'prefabs',
  'profiles',
];


/**
 * The lists that name assets and materials, and the field descriptions that say
 * which of their fields do.
 *
 * A walk over these is how a rename carries: the fields already declare what
 * they hold, so nothing here has to be kept in step when a block grows another
 * mesh slot. Which is the whole reason it is not a line per field.
 */
const REFERENCE_FIELDS: Record<string, Record<string, { kind?: string }>> = {
  terrains: TERRAIN_FIELDS,
  props: PROP_FIELDS,
  materials: MATERIAL_FIELDS,
};


/**
 * The lists whose records have a shape that has to hold, and what holds it.
 *
 * The same functions the loader reads a file through. Run on the way in as
 * well, so a value that could not have come out of a file cannot get into one
 * either: a block's grid letter is one character, and "bm" typed into the field
 * went to disk as "bm" and came back as "b" — which read as the letter refusing
 * to change, and made three blocks answer to the same letter.
 */
const cleaners: Record<string, ((entry: RuleRecord) => unknown) | undefined> = {
  materials: normalizeMaterial,
  terrains: normalizeTerrain,
  props: normalizeProp,
  prefabs: normalizePrefab,
  profiles: normalizeProfile,
};

const makers: Record<string, ((id: string) => unknown) | undefined> = {
  attributes: defaultAttribute,
  effects: defaultEffect,
  abilities: defaultAbility,
  archetypes: defaultArchetype,
  items: defaultItem,
  categories: defaultCategory,
  recipes: defaultRecipe,
  lootTables: defaultLootTable,
  baseLevels: defaultBaseLevel,
  vfx: defaultVfx,
  materials: defaultMaterial,
  terrains: defaultTerrain,
  props: defaultProp,
  prefabs: defaultPrefab,
  profiles: defaultProfile,
};

/** `attribute`, `attribute2`, `attribute3`… — the first id not already taken. */
function freshId(entries: readonly RuleRecord[], stem: string): string {
  const taken = new Set(entries.map((entry) => entry.id));
  if (!taken.has(stem)) return stem;
  for (let n = 2; ; n++) {
    if (!taken.has(`${stem}${n}`)) return `${stem}${n}`;
  }
}

/**
 * One segment of a folder path, spelled as the dev server will accept it.
 *
 * The same rule as `SEGMENT` in vite-plugin-map-io.js, and deliberately a
 * second copy: this one is here to tell you *before* the request that a name
 * will not do, and that one is there because a client is not something a
 * server may believe.
 */
const SEGMENT = /^[A-Za-z0-9][A-Za-z0-9 _.-]{0,63}$/;

/** Which field kind names a record of each library kind. */
const NAMED_BY: Record<string, string> = {
  materials: 'material',
  vfx: 'vfx',
  props: 'prop',
};

export function createDataDocument(rules: Partial<RulesData> = {}) {
  const history = createUndoable({
    attributes: rules.attributes ?? ATTRIBUTES,
    effects: rules.effects ?? EFFECTS,
    abilities: rules.abilities ?? ABILITIES,
    archetypes: rules.archetypes ?? ARCHETYPES,
    items: rules.items ?? ITEMS,
    categories: rules.categories ?? CATEGORIES,
    recipes: rules.recipes ?? RECIPES,
    lootTables: rules.lootTables ?? LOOT_TABLES,
    baseLevels: rules.baseLevels ?? BASE_LEVELS,
    vfx: rules.vfx ?? VFX,
    // Read through their normalizers, unlike the lists above, so that a record
    // a file left half-written arrives with every field it should have. This
    // is where a missing one stops travelling — the next save writes what is
    // read here.
    materials: (rules.materials ?? MATERIALS).map(normalizeMaterial),
    terrains: (rules.terrains ?? TERRAINS).map(normalizeTerrain),
    props: (rules.props ?? PROPS).map(normalizeProp),
    prefabs: (rules.prefabs ?? PREFABS).map(normalizePrefab),
    profiles: (rules.profiles ?? PROFILES).map(normalizeProfile),
  });

  const data = (): RulesData => history.state as RulesData;

  /**
   * The rows of one list, as something to write to.
   *
   * A game whose rules have never held one of these kinds has no key for it,
   * and adding the first record is what creates the list.
   */
  const rows = (list: string): RuleRecord[] => (data()[list] ??= []);
  const listOf = (list: string): RuleRecord[] => data()[list] ?? [];
  const entryAt = (list: string, index: number): RuleRecord | null =>
    listOf(list)[index] ?? null;

  /** The items that are money, by id — what a price or a payout may name. */
  const currencyIds = (): string[] =>
    listOf('items')
      .filter((item) => behaviourOf(text(item.category), listOf('categories')) === 'currency')
      .map((item) => text(item.id));

  /**
   * Follow an attribute id through everything that names one. Renaming without
   * this leaves effects pointing at an attribute that no longer exists, and the
   * failure is silent — the magnitude just resolves to zero.
   */
  function rewriteAttributeId(from: string, to: string): void {
    for (const effect of listOf('effects')) {
      for (const mod of arr(effect.modifiers)) {
        if (mod.attribute === from) mod.attribute = to;
        const modMagnitude = obj(mod.magnitude);
        if (modMagnitude?.type === 'attribute' && modMagnitude.attribute === from) {
          modMagnitude.attribute = to;
        }
      }
      const magnitude = obj(obj(effect.execution)?.magnitude);
      if (magnitude?.type === 'attribute' && magnitude.attribute === from) {
        magnitude.attribute = to;
      }
    }

    // An ability names attributes too — the one its cooldown scales off and
    // the resource it spends.
    for (const ability of listOf('abilities')) {
      if (ability.cooldownRate === from) ability.cooldownRate = to;
      if (ability.costAttribute === from) ability.costAttribute = to;
    }

    // An item's stat lines name the attribute they roll into.
    for (const item of listOf('items')) {
      for (const stat of arr(item.stats)) {
        if (stat.attribute === from) stat.attribute = to;
      }
    }

    for (const archetype of listOf('archetypes')) {
      const attributes = obj(archetype.attributes);
      if (!attributes || !(from in attributes)) continue;
      attributes[to] = attributes[from];
      delete attributes[from];
    }
  }

  return {
    get data() {
      return data();
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

    lists: LISTS,
    list: listOf,
    entry: entryAt,

    /** Attribute ids, for the pickers a modifier row needs. */
    attributeOptions(): [string, string][] {
      return listOf('attributes').map((attribute): [string, string] => [text(attribute.id), text(attribute.label) || text(attribute.id)]);
    },

    effectOptions(): [string, string][] {
      return listOf('effects').map((effect): [string, string] => [text(effect.id), text(effect.label) || text(effect.id)]);
    },

    /** How a category behaves, for anything that has to sort items by machine. */
    behaviour(item: RuleRecord | null | undefined) {
      return behaviourOf(text(item?.category), listOf('categories'));
    },

    /** The categories themselves, for the picker every item needs. */
    categoryOptions(): [string, string][] {
      return listOf('categories').map((c): [string, string] => [text(c.id), text(c.label) || text(c.id)]);
    },

    /**
     * Currency ids, for every picker that names a price or a payout.
     *
     * Money is an item in a currency category now, so this is a view of the
     * item list rather than a list of its own.
     */
    currencyOptions(): [string, string][] {
      return listOf('items')
        .filter((item) => behaviourOf(text(item.category), listOf('categories')) === 'currency')
        .map((item): [string, string] => [text(item.id), text(item.label) || text(item.id)]);
    },

    /** Loot table ids, for the picker an archetype needs. */
    lootTableOptions(): [string, string][] {
      return listOf('lootTables').map((t): [string, string] => [text(t.id), text(t.label) || text(t.id)]);
    },

    /** Ability ids, for the picker an item needs to say what it grants. */
    abilityOptions(): [string, string][] {
      return listOf('abilities').map((ability): [string, string] => [text(ability.id), text(ability.label) || text(ability.id)]);
    },

    /** Visual effect ids, for anything that can name one. */
    propOptions(): [string, string][] {
      return listOf('props').map((prop): [string, string] => [text(prop.id), text(prop.label) || text(prop.id)]);
    },

    prefabOptions(): [string, string][] {
      return listOf('prefabs').map((one): [string, string] => [
        text(one.id),
        text(one.label) || text(one.id),
      ]);
    },

    /** Edge profile ids, for a terrain's default side profile and an edge override. */
    profileOptions(): [string, string][] {
      return listOf('profiles').map((one): [string, string] => [text(one.id), text(one.label) || text(one.id)]);
    },

    /** Archetype ids, for the picker that makes a prefab an actor. */
    archetypeOptions(): [string, string][] {
      return listOf('archetypes').map((one): [string, string] => [text(one.id), text(one.label) || text(one.id)]);
    },

    vfxOptions(): [string, string][] {
      return listOf('vfx').map((effect): [string, string] => [text(effect.id), text(effect.label) || text(effect.id)]);
    },

    /** Item ids, for the picker a recipe needs to say what it produces. */
    /** The named surfaces, for the blocks and objects that wear one. */
    surfaceOptions(): [string, string][] {
      return listOf('materials').map((one): [string, string] => [text(one.id), text(one.label) || text(one.id)]);
    },

    itemOptions(): [string, string][] {
      return listOf('items').map((item): [string, string] => [text(item.id), text(item.label) || text(item.id)]);
    },

    /**
     * Just the materials, for the pickers that spend or drop one.
     *
     * A price could name a sword and a loot table could drop one, and neither
     * is wrong — but neither is what anyone is reaching for, and a list of
     * everything would bury the ore. Equipment is bought with materials, so
     * this is the list that gets offered.
     */
    materialOptions(): [string, string][] {
      return listOf('items')
        .filter((item) => behaviourOf(text(item.category), listOf('categories')) === 'material')
        .map((item): [string, string] => [text(item.id), text(item.label) || text(item.id)]);
    },

    /** `into` is the folder you are looking at, for a kind that files by hand. */
    add(list: string, into = '') {
      const stem: Record<string, string> = {
        attributes: 'attribute',
        effects: 'effect',
        abilities: 'ability',
        archetypes: 'archetype',
        items: 'item',
        categories: 'category',
        recipes: 'recipe',
        lootTables: 'lootTable',
        baseLevels: 'baseLevel',
        vfx: 'effect',
        materials: 'material',
        terrains: 'terrain',
        props: 'prop',
        prefabs: 'prefab',
        profiles: 'profile',
      };
      const make = makers[list];
      if (!make) return null;
      const id = freshId(listOf(list), stem[list] ?? list);
      history.checkpoint();
      const entry = make(id) as RuleRecord;
      // A library record is a folder, so it gets one now rather than at save:
      // a record with nowhere to live is one a save would have to skip, and a
      // save that quietly skips something is the worst kind.
      // An asset is made in the folder you are looking at.
      if (['materials', 'terrains', 'vfx', 'prefabs', 'profiles'].includes(list)) entry.path = into;
      const entries = rows(list);
      entries.push(entry);
      return { list, index: entries.length - 1 };
    },

    remove(list: string, index: number): boolean {
      if (!entryAt(list, index)) return false;
      history.checkpoint();
      rows(list).splice(index, 1);
      return true;
    },

    /**
     * Patch one entry. `checkpointed` is false while a slider is being dragged,
     * so the whole drag is a single undo step.
     */
    update(
      list: string,
      index: number,
      patch: RuleRecord,
      checkpointed = true,
    ): RuleRecord | null {
      const entry = entryAt(list, index);
      if (!entry) return null;
      history.checkpoint(checkpointed);
      Object.assign(entry, patch);
      // Merged rather than replaced, so the record keeps its identity — the
      // panel and the undo snapshot both hold this object.
      const clean = cleaners[list];
      if (clean) Object.assign(entry, clean(entry));
      return entry;
    },

    /** Rename an entry, carrying every reference to it along. */
    rename(list: string, index: number, nextId: unknown): string | null {
      const entry = entryAt(list, index);
      if (!entry) return 'Nothing selected';
      const id = String(nextId ?? '').trim();
      if (id === entry.id) return null;
      if (!ID_PATTERN.test(id)) return 'Use letters and digits, starting with a letter';
      if (listOf(list).some((other) => other.id === id)) return `"${id}" is already taken`;

      history.checkpoint();
      const from = text(entry.id);
      entry.id = id;

      if (list === 'attributes') rewriteAttributeId(from, id);

      if (list === 'effects') {
        for (const archetype of listOf('archetypes')) {
          archetype.grants = texts(archetype.grants).map((g) => (g === from ? id : g));
        }
        for (const ability of listOf('abilities')) {
          ability.effects = arr(ability.effects).map((slot) =>
            slot?.effect === from ? { ...slot, effect: id } : slot,
          );
        }
      }

      if (list === 'abilities') {
        for (const archetype of listOf('archetypes')) {
          archetype.abilities = texts(archetype.abilities).map((a) => (a === from ? id : a));
        }
        // A weapon names the ability it grants. Without this the weapon keeps
        // working and grants nothing, which is the worst way to find out.
        for (const item of listOf('items')) {
          if (item.grants === from) item.grants = id;
        }
        // A combo names each of its steps. Left behind, the chain keeps its
        // length and one press of it does nothing at all.
        for (const ability of listOf('abilities')) {
          if (ability.steps) {
            ability.steps = texts(ability.steps).map((step) => (step === from ? id : step));
          }
        }
      }

      // A recipe names the item it produces. Without this the rename is silent
      // in the worst way: the recipe stays in the list, looks fine, and makes
      // nothing.
      if (list === 'items') {
        for (const recipe of listOf('recipes')) {
          if (recipe.item === from) recipe.item = id;
        }
      }

      // An item is named by every price and every payout there is — as a
      // currency if that is what its category makes it, as an item otherwise,
      // and both are the same id. So the walk chases the id under either kind
      // rather than deciding which one this item is: an item whose category
      // changed after the price was written would otherwise be missed, and a
      // missed line turns a price into something unpayable and a drop into
      // nothing, silently.
      if (list === 'items') {
        const chase = (refs: unknown): void => {
          for (const ref of arr(refs)) {
            if (ref.id === from) ref.id = id;
          }
        };
        for (const item of listOf('items')) chase(item.costs);
        for (const rung of listOf('baseLevels')) chase(rung.costs);
        for (const table of listOf('lootTables')) chase(table.rolls);
      }

      // Every item names its category. A rename that left them behind would
      // drop each one back to behaving as a material.
      if (list === 'categories') {
        for (const item of listOf('items')) {
          if (item.category === from) item.category = id;
        }
      }

      // An ability names the flash it throws. Left behind, the ability keeps
      // working and goes off silently, which is the worst way to find out.
      if (list === 'vfx') {
        for (const ability of listOf('abilities')) {
          if (ability.vfx === from) ability.vfx = id;
        }
      }

      // A block or a prop names the material it wears. Left behind, the record
      // keeps working and comes up as an untextured box — which is the worst
      // way to find out a material was renamed.
      //
      // Only materials now. The files a record draws itself out of are named
      // by filename inside its own folder, so they have no id to chase and a
      // rename of one is the filesystem's business rather than this walk's.
      const wanted = ({ materials: 'material' } as Record<string, string>)[list];
      if (wanted) {
        for (const [name, fields] of Object.entries(REFERENCE_FIELDS)) {
          for (const entry of listOf(name)) {
            for (const [key, field] of Object.entries(fields)) {
              if (field.kind === wanted && entry[key] === from) entry[key] = id;
            }
          }
        }
      }

      if (list === 'lootTables') {
        for (const archetype of listOf('archetypes')) {
          if (archetype.loot === from) archetype.loot = id;
        }
      }

      return null;
    },

    // ----------------------------------------------------------------- costs

    /**
     * A price line, on whichever list prices things.
     *
     * Items and base levels are both priced, and both in the same shape, so
     * this takes the list rather than existing twice.
     *
     * The new row is given the first currency the price does not already name,
     * because two lines in one currency are added together when the price is
     * read — so a second gold row would vanish into the first, and adding one
     * would look like the button was broken. A currency is pre-selected at all
     * because a blank line is dropped, and a row that did nothing until you
     * touched it would look broken in the other direction.
     */
    addCost(list: string, index: number): void {
      const entry = entryAt(list, index);
      if (!entry) return;
      history.checkpoint();
      const taken = new Set(
        arr(entry.costs).filter((cost) => cost.kind !== 'item').map((cost) => text(cost.id)),
      );
      const currencies = currencyIds();
      const free = currencies.find((currencyId) => !taken.has(currencyId));
      entry.costs = [...arr(entry.costs), defaultCost('currency', free ?? currencies[0] ?? '')];
    },

    removeCost(list: string, index: number, costIndex: number): void {
      const entry = entryAt(list, index);
      const costs = arr(entry?.costs);
      if (!costs[costIndex]) return;
      history.checkpoint();
      costs.splice(costIndex, 1);
    },

    updateCost(
      list: string,
      index: number,
      costIndex: number,
      patch: RuleRecord,
      checkpointed = true,
    ): void {
      const cost = arr(entryAt(list, index)?.costs)[costIndex];
      if (!cost) return;
      history.checkpoint(checkpointed);
      Object.assign(cost, patch);
    },

    // ------------------------------------------------------------ loot rolls

    addLootRoll(index: number): void {
      const table = entryAt('lootTables', index);
      if (!table) return;
      history.checkpoint();
      // Rolls are asked one at a time and never added together, so unlike a
      // price two of them in the same currency are perfectly sensible — a
      // common handful and a rare windfall. The first currency will do.
      const first = currencyIds()[0] ?? '';
      table.rolls = [...arr(table.rolls), defaultLootRoll('currency', first)];
    },

    removeLootRoll(index: number, rollIndex: number): void {
      const table = entryAt('lootTables', index);
      const rolls = arr(table?.rolls);
      if (!rolls[rollIndex]) return;
      history.checkpoint();
      rolls.splice(rollIndex, 1);
    },

    updateLootRoll(
      index: number,
      rollIndex: number,
      patch: RuleRecord,
      checkpointed = true,
    ): void {
      const roll = arr(entryAt('lootTables', index)?.rolls)[rollIndex];
      if (!roll) return;
      history.checkpoint(checkpointed);
      Object.assign(roll, patch);
    },

    // ------------------------------------------------------------- modifiers

    addModifier(index: number): void {
      const effect = entryAt('effects', index);
      if (!effect) return;
      history.checkpoint();
      const first = text(listOf('attributes')[0]?.id) || 'health';
      effect.modifiers = [...arr(effect.modifiers), { ...defaultModifier(), attribute: first }];
    },

    removeModifier(index: number, modIndex: number): void {
      const effect = entryAt('effects', index);
      const modifiers = arr(effect?.modifiers);
      if (!modifiers[modIndex]) return;
      history.checkpoint();
      modifiers.splice(modIndex, 1);
    },

    updateModifier(
      index: number,
      modIndex: number,
      patch: RuleRecord,
      checkpointed = true,
    ): void {
      const mod = arr(entryAt('effects', index)?.modifiers)[modIndex];
      if (!mod) return;
      history.checkpoint(checkpointed);
      Object.assign(mod, patch);
    },

    updateMagnitude(
      index: number,
      modIndex: number,
      patch: RuleRecord,
      checkpointed = true,
    ): void {
      const mod = arr(entryAt('effects', index)?.modifiers)[modIndex];
      if (!mod) return;
      history.checkpoint(checkpointed);
      mod.magnitude = { ...obj(mod.magnitude), ...patch };
    },

    // ------------------------------------------------------------ executions

    setExecution(index: number, execution: unknown): void {
      const effect = entryAt('effects', index);
      if (!effect) return;
      history.checkpoint();
      effect.execution = execution;
    },

    updateExecution(index: number, patch: RuleRecord, checkpointed = true): void {
      const effect = entryAt('effects', index);
      if (!effect?.execution) return;
      history.checkpoint(checkpointed);
      effect.execution = { ...obj(effect.execution), ...patch };
    },

    updateExecutionMagnitude(index: number, patch: RuleRecord, checkpointed = true): void {
      const effect = entryAt('effects', index);
      if (!effect?.execution) return;
      history.checkpoint(checkpointed);
      const execution = obj(effect.execution);
      if (execution) execution.magnitude = { ...obj(execution.magnitude), ...patch };
    },

    // ------------------------------------------------------------- abilities

    /** The effects an ability hands to whatever it hits. */
    addAbilityEffect(index: number, effectId?: string): void {
      const ability = entryAt('abilities', index);
      if (!ability) return;
      history.checkpoint();
      const effect = effectId ?? text(listOf('effects')[0]?.id);
      ability.effects = [...arr(ability.effects), { effect, to: 'target' }];
    },

    setAbilityEffect(index: number, slot: number, effectId: string): void {
      const ability = entryAt('abilities', index);
      const effects = arr(ability?.effects);
      if (!effects[slot]) return;
      history.checkpoint();
      effects[slot] = { ...effects[slot], effect: effectId };
    },

    /** Whether this effect goes to what was hit, or back to the caster. */
    setAbilityEffectTarget(index: number, slot: number, to: string): void {
      const ability = entryAt('abilities', index);
      const effects = arr(ability?.effects);
      if (!effects[slot]) return;
      history.checkpoint();
      effects[slot] = { ...effects[slot], to: to === 'self' ? 'self' : 'target' };
    },

    removeAbilityEffect(index: number, slot: number): void {
      const ability = entryAt('abilities', index);
      const effects = arr(ability?.effects);
      if (!effects[slot]) return;
      history.checkpoint();
      effects.splice(slot, 1);
    },

    // ----------------------------------------------------------------- items

    /**
     * Give an item another rollable stat line. It starts on the first attribute
     * rather than on none: a line with no attribute rolls into nothing, and
     * would be a half-made row the author has to notice and finish.
     */
    addItemStat(index: number): void {
      const item = entryAt('items', index);
      if (!item) return;
      history.checkpoint();
      const first = text(listOf('attributes')[0]?.id) || 'attackPower';
      item.stats = [...arr(item.stats), defaultItemStat(first)];
    },

    removeItemStat(index: number, statIndex: number): void {
      const item = entryAt('items', index);
      const stats = arr(item?.stats);
      if (!stats[statIndex]) return;
      history.checkpoint();
      stats.splice(statIndex, 1);
    },

    /**
     * Patch one stat line. The two ends are stored exactly as typed and only
     * ordered when the item is rolled — swapping them here would fight anyone
     * typing a new range into a row that already has one, because the moment
     * "least" passed the old "most" the fields would trade places under them.
     */
    updateItemStat(
      index: number,
      statIndex: number,
      patch: RuleRecord,
      checkpointed = true,
    ): void {
      const stat = arr(entryAt('items', index)?.stats)[statIndex];
      if (!stat) return;
      history.checkpoint(checkpointed);
      Object.assign(stat, patch);
    },

    // ------------------------------------------------------------ archetypes

    /**
     * The two ordered lists of ability ids — an archetype's slots and a
     * combo's steps — take the same four moves, so `key` is which field is
     * being ordered rather than two copies of this.
     *
     * Adding always appends: order is the input binding on an archetype and
     * the sequence on a combo, so where a new one goes is a decision of its
     * own rather than something to guess at.
     */
    addAbilityRef(list: string, index: number, key: string, abilityId?: string): void {
      const entry = entryAt(list, index);
      if (!entry || !abilityId) return;
      history.checkpoint();
      entry[key] = [...arr(entry[key]), abilityId];
    },

    /** Swap which ability occupies a place, keeping the place's position. */
    setAbilityRef(
      list: string,
      index: number,
      key: string,
      slot: number,
      abilityId: string,
      checkpointed = true,
    ): void {
      const entry = entryAt(list, index);
      if (!entry || !arr(entry[key]).length) return;
      history.checkpoint(checkpointed);
      entry[key] = arr(entry[key]).map((id, i) => (i === slot ? abilityId : id));
    },

    removeAbilityRef(list: string, index: number, key: string, slot: number): void {
      const entry = entryAt(list, index);
      const refs = arr(entry?.[key]);
      if (!refs[slot]) return;
      history.checkpoint();
      refs.splice(slot, 1);
    },

    moveAbilityRef(
      list: string,
      index: number,
      key: string,
      slot: number,
      delta: number,
    ): void {
      const refs = arr(entryAt(list, index)?.[key]);
      const next = slot + delta;
      if (!refs.length || next < 0 || next >= refs.length) return;
      history.checkpoint();
      [refs[slot], refs[next]] = [refs[next]!, refs[slot]!];
    },

    /** Set one archetype's base value for one attribute. */
    setArchetypeValue(
      index: number,
      attributeId: string,
      value: unknown,
      checkpointed = true,
    ): void {
      const archetype = entryAt('archetypes', index);
      if (!archetype) return;
      history.checkpoint(checkpointed);
      archetype.attributes = { ...obj(archetype.attributes), [attributeId]: value };
    },

    /** Stop overriding an attribute — fall back to the attribute's own base. */
    clearArchetypeValue(index: number, attributeId: string): void {
      const archetype = entryAt('archetypes', index);
      const values = obj(archetype?.attributes);
      if (!archetype || !values || !(attributeId in values)) return;
      history.checkpoint();
      const next = { ...values };
      delete next[attributeId];
      archetype.attributes = next;
    },

    toggleGrant(index: number, effectId: string): void {
      const archetype = entryAt('archetypes', index);
      if (!archetype) return;
      history.checkpoint();
      const grants = new Set(texts(archetype.grants));
      if (grants.has(effectId)) grants.delete(effectId);
      else grants.add(effectId);
      archetype.grants = [...grants];
    },

    // ------------------------------------------------------------- folders

    /**
     * What names this record, so that deleting it can say what it would break.
     *
     * The same walk `rename` makes, run as a question instead of a rewrite.
     *
     * It can only answer for the rules it holds. A map names objects, terrains
     * and prefabs too, and maps are files this document has never opened — so
     * an empty answer here means "nothing in the rules", not "nothing at all",
     * and whatever asks has to say so.
     */
    usedBy(list: string, index: number): { list: string; id: string; label: string }[] {
      const entry = entryAt(list, index);
      const id = text(entry?.id);
      if (!id) return [];
      const wanted = NAMED_BY[list];
      const found = new Map<string, { list: string; id: string; label: string }>();
      // Keyed rather than pushed, because one record may name the same thing in
      // several of its fields and it is still one record: a terrain whose top
      // and sub are both this material is one terrain that would break, not
      // two. Every terrain here is that -- `normalizeTerrain` fills `sub` from
      // `top` when it is left empty.
      const note = (name: string, record: RuleRecord) =>
        found.set(`${name}:${text(record.id)}`, {
          list: name,
          id: text(record.id),
          label: text(record.label) || text(record.id),
        });

      if (wanted) {
        for (const [name, fields] of Object.entries(REFERENCE_FIELDS)) {
          for (const record of listOf(name)) {
            for (const [key, field] of Object.entries(fields)) {
              if (field.kind === wanted && record[key] === id) note(name, record);
            }
          }
        }
      }

      // An ability names the flash it throws and the trail behind it. Spelled
      // out because ABILITY_FIELDS is not one of the tables above, the same way
      // `rename` spells it out.
      if (list === 'vfx') {
        for (const ability of listOf('abilities')) {
          if (ability.vfx === id || ability.trail === id) note('abilities', ability);
        }
      }

      return [...found.values()];
    },

    /**
     * Delete a record, and clear what named it.
     *
     * A reference left behind is the worst kind of broken: the record keeps
     * working and comes up as an untextured box, and nothing says why. So the
     * fields that named this one are emptied rather than left pointing at
     * nothing -- which is a visible "none" in the inspector instead.
     *
     * Outside undo, through `rewrite`, for the same reason a move is: the
     * folder is gone from disk by the time this is called, and a record an undo
     * brought back would name a folder that is not there.
     *
     * The caller has already asked. `usedBy` is what it asked with.
     */
    drop(list: string, index: number): boolean {
      const entry = entryAt(list, index);
      if (!entry) return false;
      const id = text(entry.id);
      const wanted = NAMED_BY[list];

      history.rewrite((state) => {
        const held = (state as RulesData)[list];
        const at = held?.findIndex((one) => text(one.id) === id) ?? -1;
        if (held && at >= 0) held.splice(at, 1);
        if (!wanted || !id) return;

        for (const [name, fields] of Object.entries(REFERENCE_FIELDS)) {
          for (const record of (state as RulesData)[name] ?? []) {
            for (const [key, field] of Object.entries(fields)) {
              if (field.kind === wanted && record[key] === id) record[key] = '';
            }
          }
        }
        // Spelled out, the way `rename` and `usedBy` spell it out: an ability's
        // effect and its trail are not in any of the tables above.
        if (list === 'vfx') {
          for (const ability of (state as RulesData).abilities ?? []) {
            if (ability.vfx === id) ability.vfx = '';
            if (ability.trail === id) ability.trail = '';
          }
        }
      });
      return true;
    },

    /**
     * Move a record to another folder, or rename the one it is in.
     *
     * The same operation either way: a folder's name is the last part of where
     * it is, so renaming is moving to a sibling.
     *
     * This is the document's half only — the bytes are moved by whoever calls
     * it, through the dev server, and this is what makes the records agree
     * afterwards. Called after the move succeeds, never before: a failed
     * request must leave the document saying where things really are.
     *
     * Outside undo, through `rewrite`. See the comment there: the folder is on
     * disk and undo cannot fetch it back, so a record whose path an undo
     * restored would point at nothing.
     */
    setPath(list: string, index: number, to: string): string | null {
      const entry = entryAt(list, index);
      if (!entry) return 'Nothing selected';
      const from = text(entry.path);
      const next = String(to ?? '').trim().replace(/^\/+|\/+$/g, '');
      if (next === from) return null;
      if (!next) return 'A record needs a folder to live in';
      const parts = next.split('/');
      if (parts.length > 8) return 'That is too many folders deep';
      if (!parts.every((part) => SEGMENT.test(part))) {
        return 'Use letters, digits, spaces, dots and dashes';
      }
      // Compared case-blind: this is Windows as often as not, where Wood and
      // wood are the same directory and the second record would land on the
      // first's files.
      const taken = listOf(list).some(
        (other) => other !== entry && text(other.path).toLowerCase() === next.toLowerCase(),
      );
      if (taken) return `Something is already at "${next}"`;

      const id = text(entry.id);
      const rooted = `/${from}/`;
      history.rewrite((state) => {
        for (const record of (state as RulesData)[list] ?? []) {
          if (text(record.id) === id) record.path = next;
        }
        // A file named with a leading slash is named from the assets root
        // rather than from its own folder -- the escape hatch for one two
        // records share. Those are the only references a move has to chase;
        // everything else is relative and travels with the folder.
        if (!from) return;
        for (const [name, fields] of Object.entries(REFERENCE_FIELDS)) {
          for (const record of (state as RulesData)[name] ?? []) {
            for (const [key, field] of Object.entries(fields)) {
              const value = record[key];
              if (field.kind !== 'file' || typeof value !== 'string') continue;
              if (value.startsWith(rooted)) record[key] = `/${next}/${value.slice(rooted.length)}`;
            }
          }
        }
      });
      return null;
    },

    /**
     * Put a whole record in, as one undo step: a duplicate, or an asset made
     * with its name and folder already decided.
     */
    insert(list: string, record: RuleRecord): number {
      history.checkpoint();
      const clean = cleaners[list];
      const entry = clean ? ({ ...record, ...(clean(record) as RuleRecord) } as RuleRecord) : record;
      const entries = rows(list);
      entries.push(entry);
      return entries.length - 1;
    },

    /**
     * Replace a list outside undo, in the present and every snapshot — for a
     * list that is not edited here but read off the files (the models), or a
     * record changed on disk behind the document's back.
     */
    replaceList(list: string, next: RuleRecord[]): void {
      history.rewrite((state) => {
        (state as RulesData)[list] = structuredClone(next);
      });
    },

    /**
     * Write one record's fields in the present and every snapshot, outside
     * undo: for contents edited in a document of their own (a prefab on its
     * stage), whose steps that document already undoes.
     */
    rewriteRecord(list: string, id: string, patch: RuleRecord): void {
      history.rewrite((state) => {
        const record = ((state as RulesData)[list] ?? []).find((one) => one.id === id);
        if (record) Object.assign(record, structuredClone(patch));
      });
    },

    /** Hear about each new undo step. See globalHistory.ts. */
    onStep: (listener: () => void) => history.onStep(listener),

    undo: () => history.undo(),
    redo: () => history.redo(),
    markSaved: () => history.markSaved(),

    /**
     * Snapshot before a gesture that will write many times.
     *
     * The same escape hatch document.js exposes, and for the same reason: a
     * drag across a slider is forty writes and one decision, so the caller
     * takes the snapshot once and writes everything after it uncheckpointed.
     */
    checkpoint: (checkpointed = true) => checkpointed && history.checkpoint(),

    /** Hear about every change to the rules. See history.ts. */
    subscribe: (listener: () => void) => history.subscribe(listener),

    /** How many times the rules have changed. See history.ts. */
    get revision() {
      return history.revision;
    },
  };
}

/** Every rules list, open for editing, with one undo stack over all of them. */
export type DataDocument = ReturnType<typeof createDataDocument>;
