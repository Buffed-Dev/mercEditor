/**
 * What kinds of thing an item can be.
 *
 * A category is the author's own word for a group of items — Weapon, Armour,
 * Reagent, Coin — and it is the only classification an item carries. It
 * replaced the fixed `kind` field, which could say two things and could not be
 * added to without editing code.
 *
 * What it cannot replace is *behaviour*. Whether a thing claims an equipment
 * slot, whether it stacks in the bag, whether it lands in the purse rather than
 * in the bag at all — those are three different machines in the game, not three
 * words. So a category names one of them:
 *
 *   equipment  claims a slot, rolls its stat lines, may grant an ability
 *   material   stacks in a bag cell and is spent making equipment
 *   currency   never touches the bag: it is a number in the purse
 *
 * Add as many categories as you like; each one picks the machine it runs on.
 * That is what lets "Potion" exist without the inventory learning the word.
 *
 * The icon is the category's default, worn by every item in it that has not
 * chosen one of its own — see ./icons.js for the two sets.
 */

import { CATEGORIES as GAME_CATEGORIES } from '#game/rules/categories.js';

/** The set itself lives in rules/, which the editor rewrites. */
export type Category = {
  id: string;
  label: string;
  behaviour: CategoryBehaviour;
  icon: string;
};

/** A category as a rules file writes it, before `normalizeCategory` runs. */
export type CategoryInput = Partial<Omit<Category, 'behaviour'>> & { behaviour?: string };

/** Left unnormalized: the rules editor reads this straight into what it saves. */
export const CATEGORIES = GAME_CATEGORIES as CategoryInput[];

export const CATEGORY_BEHAVIOURS = [
  ['equipment', 'Equipment'],
  ['material', 'Material'],
  ['currency', 'Currency'],
] as const;

/** How a category's items behave. Worn, stacked, or spent. */
export type CategoryBehaviour = (typeof CATEGORY_BEHAVIOURS)[number][0];

export const isCategoryBehaviour = (value: unknown): value is CategoryBehaviour =>
  CATEGORY_BEHAVIOURS.some(([id]) => id === value);

export const DEFAULT_BEHAVIOUR: CategoryBehaviour = 'material';

export const CATEGORY_FIELDS = {
  label: { kind: 'text', label: 'Name', default: 'New category' },
  behaviour: {
    kind: 'select',
    label: 'Behaves as',
    options: CATEGORY_BEHAVIOURS,
    default: DEFAULT_BEHAVIOUR,
  },
  icon: { kind: 'icon', label: 'Icon', default: 'box' },
} as const;

export function defaultCategory(id = 'newCategory'): Category {
  return {
    id,
    label: CATEGORY_FIELDS.label.default,
    behaviour: CATEGORY_FIELDS.behaviour.default,
    icon: CATEGORY_FIELDS.icon.default,
  };
}

export function normalizeCategory(def: CategoryInput = {}): Category {
  return {
    ...defaultCategory(def.id ?? 'newCategory'),
    ...def,
    behaviour: isCategoryBehaviour(def.behaviour) ? def.behaviour : DEFAULT_BEHAVIOUR,
    icon: typeof def.icon === 'string' && def.icon ? def.icon : CATEGORY_FIELDS.icon.default,
  };
}

/** Look categories up by id. Callers hold the array; this is the index. */
export function categoryMap(
  defs: readonly CategoryInput[] = CATEGORIES,
): Map<string, Category> {
  return new Map(defs.map((def) => [def.id ?? 'newCategory', normalizeCategory(def)]));
}

/**
 * Which machine a category runs on.
 *
 * An item naming a category that no longer exists behaves as a material: it
 * stacks, and it is inert. That is the harmless end of the three — the other
 * two would have it claim a slot or turn into money.
 */
export function behaviourOf(
  categoryId: string | undefined,
  categories: readonly CategoryInput[] = CATEGORIES,
): CategoryBehaviour {
  const found = (categories ?? []).find((def) => def.id === categoryId);
  return found ? normalizeCategory(found).behaviour : DEFAULT_BEHAVIOUR;
}
