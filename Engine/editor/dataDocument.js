import { ATTRIBUTES, defaultAttribute } from '../src/data/attributes.ts';
import { ARCHETYPES, defaultArchetype } from '../src/data/archetypes.ts';
import { ABILITIES, defaultAbility } from '../src/data/abilities.js';
import { EFFECTS, defaultEffect, defaultModifier } from '../src/data/effects.ts';
import { ITEMS, defaultItem, defaultItemStat } from '../src/data/items.ts';
import { RECIPES, defaultRecipe } from '../src/data/recipes.ts';
import { CATEGORIES, behaviourOf, defaultCategory } from '../src/data/categories.ts';
import { defaultCost } from '../src/data/costs.ts';
import { LOOT_TABLES, defaultLootRoll, defaultLootTable } from '../src/data/lootTables.ts';
import { BASE_LEVELS, defaultBaseLevel } from '../src/data/baseLevels.ts';
import { VFX, defaultVfx } from '../src/data/vfx.js';
import { ASSETS, defaultAsset, normalizeAsset } from '../src/data/assets.js';
import { TERRAINS, TERRAIN_FIELDS, defaultTerrain, normalizeTerrain } from '../src/data/terrains.ts';
import {
  MATERIALS,
  MATERIAL_FIELDS,
  defaultMaterial,
  normalizeMaterial,
} from '../src/data/materials.ts';
import { PROPS, PROP_FIELDS, defaultProp, normalizeProp } from '../src/data/props.ts';
import { createUndoable } from './undoable.js';

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
  'assets',
  'materials',
  'terrains',
  'props',
];

const ID_PATTERN = /^[a-zA-Z][a-zA-Z0-9]*$/;

/**
 * The lists that name assets and materials, and the field descriptions that say
 * which of their fields do.
 *
 * A walk over these is how a rename carries: the fields already declare what
 * they hold, so nothing here has to be kept in step when a block grows another
 * mesh slot. Which is the whole reason it is not a line per field.
 */
const REFERENCE_FIELDS = {
  terrains: TERRAIN_FIELDS,
  props: PROP_FIELDS,
  materials: MATERIAL_FIELDS,
};

/** `Stone Wall` → `stoneWall`: the id a name asks for. Empty if it asks for none. */
export function idFromLabel(label) {
  const words = String(label ?? '')
    .replace(/[^a-zA-Z0-9]+/g, ' ')
    .trim()
    .split(' ')
    .filter(Boolean);
  if (!words.length) return '';
  const id = words
    .map((word, i) =>
      i === 0 ? word[0].toLowerCase() + word.slice(1) : word[0].toUpperCase() + word.slice(1),
    )
    .join('');
  // An id has to start with a letter, so a name that starts with a digit gets
  // one rather than being refused.
  return ID_PATTERN.test(id) ? id : `a${id[0].toUpperCase()}${id.slice(1)}`;
}

/**
 * The lists whose records have a shape that has to hold, and what holds it.
 *
 * The same functions the loader reads a file through. Run on the way in as
 * well, so a value that could not have come out of a file cannot get into one
 * either: a block's grid letter is one character, and "bm" typed into the field
 * went to disk as "bm" and came back as "b" — which read as the letter refusing
 * to change, and made three blocks answer to the same letter.
 */
const cleaners = {
  assets: normalizeAsset,
  materials: normalizeMaterial,
  terrains: normalizeTerrain,
  props: normalizeProp,
};

const makers = {
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
  assets: defaultAsset,
  materials: defaultMaterial,
  terrains: defaultTerrain,
  props: defaultProp,
};

/** `attribute`, `attribute2`, `attribute3`… — the first id not already taken. */
function freshId(entries, stem) {
  const taken = new Set(entries.map((entry) => entry.id));
  if (!taken.has(stem)) return stem;
  for (let n = 2; ; n++) {
    if (!taken.has(`${stem}${n}`)) return `${stem}${n}`;
  }
}

export function createDataDocument(rules = {}) {
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
    // Read through their normalizers, unlike the lists above: an asset's
    // fields depend on what kind it is, so a record that changed kind before
    // the editor learned to clear the old kind's keys still carries them. This
    // is where they stop travelling — the next save writes what is read here.
    assets: (rules.assets ?? ASSETS).map(normalizeAsset),
    materials: (rules.materials ?? MATERIALS).map(normalizeMaterial),
    terrains: (rules.terrains ?? TERRAINS).map(normalizeTerrain),
    props: (rules.props ?? PROPS).map(normalizeProp),
  });

  const data = () => history.state;
  const listOf = (list) => data()[list] ?? [];
  const entryAt = (list, index) => listOf(list)[index] ?? null;

  /** The items that are money, by id — what a price or a payout may name. */
  const currencyIds = () =>
    listOf('items')
      .filter((item) => behaviourOf(item.category, listOf('categories')) === 'currency')
      .map((item) => item.id);

  /**
   * Follow an attribute id through everything that names one. Renaming without
   * this leaves effects pointing at an attribute that no longer exists, and the
   * failure is silent — the magnitude just resolves to zero.
   */
  function rewriteAttributeId(from, to) {
    for (const effect of listOf('effects')) {
      for (const mod of effect.modifiers ?? []) {
        if (mod.attribute === from) mod.attribute = to;
        if (mod.magnitude?.type === 'attribute' && mod.magnitude.attribute === from) {
          mod.magnitude.attribute = to;
        }
      }
      const magnitude = effect.execution?.magnitude;
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
      for (const stat of item.stats ?? []) {
        if (stat.attribute === from) stat.attribute = to;
      }
    }

    for (const archetype of listOf('archetypes')) {
      if (!(from in (archetype.attributes ?? {}))) continue;
      archetype.attributes[to] = archetype.attributes[from];
      delete archetype.attributes[from];
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
    attributeOptions() {
      return listOf('attributes').map((attribute) => [attribute.id, attribute.label || attribute.id]);
    },

    effectOptions() {
      return listOf('effects').map((effect) => [effect.id, effect.label || effect.id]);
    },

    /** How a category behaves, for anything that has to sort items by machine. */
    behaviour(item) {
      return behaviourOf(item?.category, listOf('categories'));
    },

    /** The categories themselves, for the picker every item needs. */
    categoryOptions() {
      return listOf('categories').map((c) => [c.id, c.label || c.id]);
    },

    /**
     * Currency ids, for every picker that names a price or a payout.
     *
     * Money is an item in a currency category now, so this is a view of the
     * item list rather than a list of its own.
     */
    currencyOptions() {
      return listOf('items')
        .filter((item) => behaviourOf(item.category, listOf('categories')) === 'currency')
        .map((item) => [item.id, item.label || item.id]);
    },

    /** Loot table ids, for the picker an archetype needs. */
    lootTableOptions() {
      return listOf('lootTables').map((t) => [t.id, t.label || t.id]);
    },

    /** Ability ids, for the picker an item needs to say what it grants. */
    abilityOptions() {
      return listOf('abilities').map((ability) => [ability.id, ability.label || ability.id]);
    },

    /** Visual effect ids, for anything that can name one. */
    /**
     * The assets a picker may offer, narrowed to one kind: a mesh slot that
     * listed the textures too would be a list you have to read to use.
     */
    assetOptions(kind) {
      return listOf('assets')
        .filter((asset) => !kind || asset.kind === kind)
        .map((asset) => [asset.id, asset.label || asset.id]);
    },

    propOptions() {
      return listOf('props').map((prop) => [prop.id, prop.label || prop.id]);
    },

    vfxOptions() {
      return listOf('vfx').map((effect) => [effect.id, effect.label || effect.id]);
    },

    /** Item ids, for the picker a recipe needs to say what it produces. */
    /** The named surfaces, for the blocks and objects that wear one. */
    surfaceOptions() {
      return listOf('materials').map((one) => [one.id, one.label || one.id]);
    },

    itemOptions() {
      return listOf('items').map((item) => [item.id, item.label || item.id]);
    },

    /**
     * Just the materials, for the pickers that spend or drop one.
     *
     * A price could name a sword and a loot table could drop one, and neither
     * is wrong — but neither is what anyone is reaching for, and a list of
     * everything would bury the ore. Equipment is bought with materials, so
     * this is the list that gets offered.
     */
    materialOptions() {
      return listOf('items')
        .filter((item) => behaviourOf(item.category, listOf('categories')) === 'material')
        .map((item) => [item.id, item.label || item.id]);
    },

    add(list) {
      const stem = {
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
        assets: 'asset',
        materials: 'material',
        terrains: 'terrain',
        props: 'prop',
      }[list];
      const id = freshId(listOf(list), stem);
      history.checkpoint();
      const entry = makers[list](id);
      data()[list].push(entry);
      return { list, index: data()[list].length - 1 };
    },

    remove(list, index) {
      if (!entryAt(list, index)) return false;
      history.checkpoint();
      data()[list].splice(index, 1);
      return true;
    },

    /**
     * Patch one entry. `checkpointed` is false while a slider is being dragged,
     * so the whole drag is a single undo step.
     */
    update(list, index, patch, checkpointed = true) {
      const entry = entryAt(list, index);
      if (!entry) return null;
      history.checkpoint(checkpointed);
      Object.assign(entry, patch);
      // Merged rather than replaced, so the record keeps its identity — the
      // panel and the undo snapshot both hold this object.
      if (cleaners[list]) Object.assign(entry, cleaners[list](entry));
      return entry;
    },

    /** Rename an entry, carrying every reference to it along. */
    rename(list, index, nextId) {
      const entry = entryAt(list, index);
      if (!entry) return 'Nothing selected';
      const id = String(nextId ?? '').trim();
      if (id === entry.id) return null;
      if (!ID_PATTERN.test(id)) return 'Use letters and digits, starting with a letter';
      if (listOf(list).some((other) => other.id === id)) return `"${id}" is already taken`;

      history.checkpoint();
      const from = entry.id;
      entry.id = id;

      if (list === 'attributes') rewriteAttributeId(from, id);

      if (list === 'effects') {
        for (const archetype of listOf('archetypes')) {
          archetype.grants = (archetype.grants ?? []).map((g) => (g === from ? id : g));
        }
        for (const ability of listOf('abilities')) {
          ability.effects = (ability.effects ?? []).map((entry) =>
            entry?.effect === from ? { ...entry, effect: id } : entry,
          );
        }
      }

      if (list === 'abilities') {
        for (const archetype of listOf('archetypes')) {
          archetype.abilities = (archetype.abilities ?? []).map((a) => (a === from ? id : a));
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
            ability.steps = ability.steps.map((step) => (step === from ? id : step));
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
        const chase = (refs) => {
          for (const ref of refs ?? []) {
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

      // A block, a prop or a material names the assets it draws itself out of,
      // and a block or a prop names the material it wears. Left behind, the
      // record keeps working and comes up as an untextured box — which is the
      // worst way to find out an asset was renamed.
      const wanted = { assets: 'asset', materials: 'material' }[list];
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
    addCost(list, index) {
      const entry = entryAt(list, index);
      if (!entry) return;
      history.checkpoint();
      const taken = new Set(
        (entry.costs ?? []).filter((cost) => cost.kind !== 'item').map((cost) => cost.id),
      );
      const currencies = currencyIds();
      const free = currencies.find((currencyId) => !taken.has(currencyId));
      entry.costs = [...(entry.costs ?? []), defaultCost('currency', free ?? currencies[0] ?? '')];
    },

    removeCost(list, index, costIndex) {
      const entry = entryAt(list, index);
      if (!entry?.costs?.[costIndex]) return;
      history.checkpoint();
      entry.costs.splice(costIndex, 1);
    },

    updateCost(list, index, costIndex, patch, checkpointed = true) {
      const cost = entryAt(list, index)?.costs?.[costIndex];
      if (!cost) return;
      history.checkpoint(checkpointed);
      Object.assign(cost, patch);
    },

    // ------------------------------------------------------------ loot rolls

    addLootRoll(index) {
      const table = entryAt('lootTables', index);
      if (!table) return;
      history.checkpoint();
      // Rolls are asked one at a time and never added together, so unlike a
      // price two of them in the same currency are perfectly sensible — a
      // common handful and a rare windfall. The first currency will do.
      const first = currencyIds()[0] ?? '';
      table.rolls = [...(table.rolls ?? []), defaultLootRoll('currency', first)];
    },

    removeLootRoll(index, rollIndex) {
      const table = entryAt('lootTables', index);
      if (!table?.rolls?.[rollIndex]) return;
      history.checkpoint();
      table.rolls.splice(rollIndex, 1);
    },

    updateLootRoll(index, rollIndex, patch, checkpointed = true) {
      const roll = entryAt('lootTables', index)?.rolls?.[rollIndex];
      if (!roll) return;
      history.checkpoint(checkpointed);
      Object.assign(roll, patch);
    },

    // ------------------------------------------------------------- modifiers

    addModifier(index) {
      const effect = entryAt('effects', index);
      if (!effect) return;
      history.checkpoint();
      const first = listOf('attributes')[0]?.id ?? 'health';
      effect.modifiers = [...(effect.modifiers ?? []), { ...defaultModifier(), attribute: first }];
    },

    removeModifier(index, modIndex) {
      const effect = entryAt('effects', index);
      if (!effect?.modifiers?.[modIndex]) return;
      history.checkpoint();
      effect.modifiers.splice(modIndex, 1);
    },

    updateModifier(index, modIndex, patch, checkpointed = true) {
      const mod = entryAt('effects', index)?.modifiers?.[modIndex];
      if (!mod) return;
      history.checkpoint(checkpointed);
      Object.assign(mod, patch);
    },

    updateMagnitude(index, modIndex, patch, checkpointed = true) {
      const mod = entryAt('effects', index)?.modifiers?.[modIndex];
      if (!mod) return;
      history.checkpoint(checkpointed);
      mod.magnitude = { ...mod.magnitude, ...patch };
    },

    // ------------------------------------------------------------ executions

    setExecution(index, execution) {
      const effect = entryAt('effects', index);
      if (!effect) return;
      history.checkpoint();
      effect.execution = execution;
    },

    updateExecution(index, patch, checkpointed = true) {
      const effect = entryAt('effects', index);
      if (!effect?.execution) return;
      history.checkpoint(checkpointed);
      effect.execution = { ...effect.execution, ...patch };
    },

    updateExecutionMagnitude(index, patch, checkpointed = true) {
      const effect = entryAt('effects', index);
      if (!effect?.execution) return;
      history.checkpoint(checkpointed);
      effect.execution.magnitude = { ...effect.execution.magnitude, ...patch };
    },

    // ------------------------------------------------------------- abilities

    /** The effects an ability hands to whatever it hits. */
    addAbilityEffect(index, effectId) {
      const ability = entryAt('abilities', index);
      if (!ability) return;
      history.checkpoint();
      const effect = effectId ?? listOf('effects')[0]?.id ?? '';
      ability.effects = [...(ability.effects ?? []), { effect, to: 'target' }];
    },

    setAbilityEffect(index, slot, effectId) {
      const ability = entryAt('abilities', index);
      if (!ability?.effects?.[slot]) return;
      history.checkpoint();
      ability.effects[slot] = { ...ability.effects[slot], effect: effectId };
    },

    /** Whether this effect goes to what was hit, or back to the caster. */
    setAbilityEffectTarget(index, slot, to) {
      const ability = entryAt('abilities', index);
      if (!ability?.effects?.[slot]) return;
      history.checkpoint();
      ability.effects[slot] = { ...ability.effects[slot], to: to === 'self' ? 'self' : 'target' };
    },

    removeAbilityEffect(index, slot) {
      const ability = entryAt('abilities', index);
      if (!ability?.effects?.[slot]) return;
      history.checkpoint();
      ability.effects.splice(slot, 1);
    },

    // ----------------------------------------------------------------- items

    /**
     * Give an item another rollable stat line. It starts on the first attribute
     * rather than on none: a line with no attribute rolls into nothing, and
     * would be a half-made row the author has to notice and finish.
     */
    addItemStat(index) {
      const item = entryAt('items', index);
      if (!item) return;
      history.checkpoint();
      const first = listOf('attributes')[0]?.id ?? 'attackPower';
      item.stats = [...(item.stats ?? []), defaultItemStat(first)];
    },

    removeItemStat(index, statIndex) {
      const item = entryAt('items', index);
      if (!item?.stats?.[statIndex]) return;
      history.checkpoint();
      item.stats.splice(statIndex, 1);
    },

    /**
     * Patch one stat line. The two ends are stored exactly as typed and only
     * ordered when the item is rolled — swapping them here would fight anyone
     * typing a new range into a row that already has one, because the moment
     * "least" passed the old "most" the fields would trade places under them.
     */
    updateItemStat(index, statIndex, patch, checkpointed = true) {
      const stat = entryAt('items', index)?.stats?.[statIndex];
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
    addAbilityRef(list, index, key, abilityId) {
      const entry = entryAt(list, index);
      if (!entry || !abilityId) return;
      history.checkpoint();
      entry[key] = [...(entry[key] ?? []), abilityId];
    },

    /** Swap which ability occupies a place, keeping the place's position. */
    setAbilityRef(list, index, key, slot, abilityId, checkpointed = true) {
      const entry = entryAt(list, index);
      if (!entry?.[key]?.length) return;
      history.checkpoint(checkpointed);
      entry[key] = entry[key].map((id, i) => (i === slot ? abilityId : id));
    },

    removeAbilityRef(list, index, key, slot) {
      const entry = entryAt(list, index);
      if (!entry?.[key]?.[slot]) return;
      history.checkpoint();
      entry[key].splice(slot, 1);
    },

    moveAbilityRef(list, index, key, slot, delta) {
      const refs = entryAt(list, index)?.[key];
      const next = slot + delta;
      if (!refs || next < 0 || next >= refs.length) return;
      history.checkpoint();
      [refs[slot], refs[next]] = [refs[next], refs[slot]];
    },

    /** Set one archetype's base value for one attribute. */
    setArchetypeValue(index, attributeId, value, checkpointed = true) {
      const archetype = entryAt('archetypes', index);
      if (!archetype) return;
      history.checkpoint(checkpointed);
      archetype.attributes = { ...archetype.attributes, [attributeId]: value };
    },

    /** Stop overriding an attribute — fall back to the attribute's own base. */
    clearArchetypeValue(index, attributeId) {
      const archetype = entryAt('archetypes', index);
      if (!archetype?.attributes || !(attributeId in archetype.attributes)) return;
      history.checkpoint();
      const next = { ...archetype.attributes };
      delete next[attributeId];
      archetype.attributes = next;
    },

    toggleGrant(index, effectId) {
      const archetype = entryAt('archetypes', index);
      if (!archetype) return;
      history.checkpoint();
      const grants = new Set(archetype.grants ?? []);
      if (grants.has(effectId)) grants.delete(effectId);
      else grants.add(effectId);
      archetype.grants = [...grants];
    },

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
    subscribe: (listener) => history.subscribe(listener),

    /** How many times the rules have changed. See history.ts. */
    get revision() {
      return history.revision;
    },
  };
}
