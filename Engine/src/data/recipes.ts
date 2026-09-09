/**
 * Recipes: what a crafting bench can be asked to make.
 *
 * A recipe is deliberately thin — a base level and the id of an item
 * *definition*. It does not describe the item and it does not price it, because
 * the item already does both; pointing at a definition rather than restating
 * one is what stops a sword's stats and its price having to be edited in two
 * places, and what means crafting produces exactly the same shape as a drop.
 *
 * So what a recipe adds is the *permission*: this is a thing a bench can make,
 * once the base has been built up far enough.
 *
 * It produces an **instance**, rolled out of that definition by rollItem in
 * ../game/items.js. Rolling rather than fixing the numbers costs nothing while
 * every range is a single value, and is the whole reason random affixes will
 * apply to crafted items without anything here changing.
 *
 * The bench itself is a thing in the world; what it can make is gated by how
 * far the base has been built up, which is a property of the place rather than
 * of whoever walks up to it.
 */

import { normalizeCosts, type Cost } from './costs.ts';
import { itemMap, type ItemInput } from './items.ts';
import { RECIPES as GAME_RECIPES } from '#game/rules/recipes.js';

/** The set itself lives in rules/, which the editor rewrites. */
export type Recipe = { id: string; label: string; item: string; minBase: number };

/** A recipe as a rules file writes it. */
export type RecipeInput = Partial<Recipe>;

/** Left unnormalized: the rules editor reads this straight into what it saves. */
export const RECIPES = GAME_RECIPES as RecipeInput[];

/**
 * `item` is an id in the items list, not a value that can be defaulted to
 * anything sensible — which is why its kind is its own: data/ has no idea what
 * items exist in the document the editor happens to have open, so the editor
 * turns this into a picker of real ids the way it does an ability's attribute.
 */
export const RECIPE_FIELDS = {
  label: { kind: 'text', label: 'Name', default: 'New recipe' },
  item: { kind: 'item', label: 'Produces', default: '' },
  minBase: { kind: 'range', label: 'Needs base level', min: 1, max: 20, step: 1, default: 1 },
} as const;

export function defaultRecipe(id = 'newRecipe'): Recipe {
  return {
    id,
    label: RECIPE_FIELDS.label.default,
    item: RECIPE_FIELDS.item.default,
    minBase: RECIPE_FIELDS.minBase.default,
  };
}

/**
 * Fill in anything a hand-written recipe left out.
 *
 * A missing `item` is left as the empty string rather than guessed at: a recipe
 * that points nowhere is something the editor should say out loud, and a
 * silently substituted first-item-in-the-list would hide it.
 */
export function normalizeRecipe(def: RecipeInput = {}): Recipe {
  const base = defaultRecipe(def.id ?? 'newRecipe');
  const clamp = (
    value: number | undefined,
    field: { min: number; max: number },
    fallback: number,
  ) =>
    Number.isFinite(value) ? Math.min(field.max, Math.max(field.min, value as number)) : fallback;
  return {
    ...base,
    ...def,
    item: typeof def.item === 'string' ? def.item : base.item,
    minBase: Math.round(clamp(def.minBase, RECIPE_FIELDS.minBase, base.minBase)),
  };
}

/**
 * What one recipe charges: its item's price.
 *
 * Here rather than inlined at the bench so that "what does this cost" has one
 * answer wherever it is asked — the panel drawing a row and the bench taking
 * the money read the same function.
 */
export function recipeCosts(recipe: RecipeInput, items?: readonly ItemInput[]): Cost[] {
  const def = itemMap(items).get(normalizeRecipe(recipe).item);
  return def ? normalizeCosts(def.costs) : [];
}

/** Look recipes up by id. Callers hold the array; this is the index. */
export function recipeMap(defs: readonly RecipeInput[] = RECIPES): Map<string, Recipe> {
  return new Map(defs.map((def) => [def.id ?? 'newRecipe', normalizeRecipe(def)]));
}
