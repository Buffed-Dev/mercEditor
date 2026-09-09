/**
 * Making an item at a bench.
 *
 * A price is a list of `{ currency, amount }` and it lives on the item rather
 * than on the recipe — see ../data/items.js. So a recipe is permission rather
 * than a price tag, and the bench asks the purse whether it can pay the whole
 * list at once, because paying part of a price is worse than paying none of it.
 *
 * The whole of the design is the order of the questions. Everything that can
 * refuse — the recipe does not exist, the base is not built up far enough, the
 * purse is short, the bag is full — is asked *before* a coin is spent or a
 * die is rolled. So a refusal costs nothing, and a success is one indivisible
 * move: coin out, one item in. There is no instant at which the item is in no
 * place at all, which is the census the rest of the game holds to.
 *
 * The bag-full check is the one that earns its keep. Spending first and finding
 * nowhere to put the result afterwards means either an item on the floor the
 * player did not ask for, or coin gone for nothing.
 *
 * The work takes a second, so it is three calls rather than one — begin, tick,
 * finish — and the coin leaves at the start while the item arrives at the end.
 * The bench holds the job on the character, which is the only thing here that
 * outlives both the panel and the level.
 *
 * Rolling goes through rollItem like every other way an item comes into
 * existence. While every range is a single value that is a roll with one
 * outcome — but it is the same roll, so the day items grow random affixes a
 * crafted one gets them without a line changing here.
 */

import { costLabeller, describeCosts, normalizeCosts } from '../data/costs.ts';
import type { AttributeInput } from '../data/attributes.ts';
import type { BaseLevelInput } from '../data/baseLevels.ts';
import type { CategoryInput } from '../data/categories.ts';
import type { CurrencyInput } from '../data/currencies.ts';
import { nextBaseLevel } from '../data/baseLevels.ts';
import { itemMap, stackLimit, type Item, type ItemInput } from '../data/items.ts';
import { normalizeRecipe, recipeCosts, recipeMap, type RecipeInput } from '../data/recipes.ts';
import { itemRange, rollItem, type ItemInstance } from './items.ts';
import type { Character, Job } from './character.ts';

/** The rules a crafting question is asked against. */
export type CraftingRules = {
  recipes: readonly RecipeInput[];
  items: readonly ItemInput[];
  categories?: readonly CategoryInput[];
};

/** Somewhere with a workbench, and how far it has been built up. */
export type Place = { baseLevel: number };

/** How long the bench takes over one item. */
export const CRAFT_SECONDS = 1;

/**
 * Start making one item.
 *
 * Order is the whole point, and it has not changed by the work taking a second:
 * everything that can refuse is asked before a coin is spent. What has changed
 * is that paying and receiving are no longer the same instant, so the coin goes
 * *now* — a bench you could queue five swords at with the price of one would be
 * a bench that prints swords.
 *
 * The bag is checked here as well as at the end. Refusing up front is what
 * stops you paying for something there was never going to be room for; the
 * check at the end is for the room you filled while it was being made.
 *
 * @returns {{ok: boolean, reason: ''|'unknown'|'locked'|'poor'|'full'|'busy', job: object|null}}
 */
export function beginCraft(
  recipeId: string,
  {
    recipes,
    items,
    categories,
    character,
    place,
  }: CraftingRules & { character: Character; place?: Place | null },
): { ok: boolean; reason: string; job: Job | null } {
  if (character.job) return { ok: false, reason: 'busy', job: null };

  // Split from the check below rather than folded into it: a recipe nobody
  // recognises and a recipe naming an item nobody recognises are the same
  // answer, but only one of them leaves `recipe` safe to read afterwards.
  const recipe = recipeMap(recipes).get(recipeId);
  if (!recipe) return { ok: false, reason: 'unknown', job: null };

  const def = itemMap(items, categories).get(recipe.item);
  if (!def) return { ok: false, reason: 'unknown', job: null };
  if ((place?.baseLevel ?? 1) < recipe.minBase) return { ok: false, reason: 'locked', job: null };
  const costs = normalizeCosts(def.costs);
  if (!character.affords(costs)) return { ok: false, reason: 'poor', job: null };
  // Room for the thing itself, not just an empty cell: a bench asked for ore
  // can top up a stack in a bag with no holes left in it.
  if (character.inventory.room({ defId: def.id, stack: stackLimit(def) }) < 1) {
    return { ok: false, reason: 'full', job: null };
  }

  character.spend(costs);
  const job: Job = {
    recipeId: recipe.id,
    label: recipe.label,
    seconds: CRAFT_SECONDS,
    remaining: CRAFT_SECONDS,
  };
  character.setJob(job);
  return { ok: true, reason: '', job };
}

/**
 * Advance the bench. Returns true on the tick it finishes.
 *
 * Takes the character rather than the job so the caller does not have to check
 * whether there is one — an idle bench ticking is a no-op, which is what makes
 * this one unconditional line in the frame.
 *
 * The epsilon is the same one the settling drop uses, for the same reason: this
 * is a sum of frame times, and a second that came up 9e-18 short would hold the
 * item back a whole frame now and then for no reason anyone could find.
 */
export function advanceCraft(character: Character, dt: number): boolean {
  const job = character.job;
  if (!job) return false;
  job.remaining -= dt;
  return job.remaining <= 1e-9;
}

/**
 * Take what the bench made.
 *
 * Rolling happens here, at the end, rather than at the start: an item that was
 * decided a second ago and handed over now is the same thing, but rolling last
 * means nothing has to be held anywhere in the meantime, and there is no state
 * to lose if the job is thrown away.
 *
 * It goes in the bag if there is room. If there is not — the bag filled while
 * this was being made — it comes back unstowed, and whoever called this puts it
 * on the floor. Losing it is the one outcome not on offer: it has been paid for.
 *
 * @returns {{item: object|null, stowed: boolean}}
 */
export function finishCraft(
  character: Character,
  { recipes, items, categories, rng = Math.random }: CraftingRules & { rng?: () => number },
): { item: ItemInstance | null; stowed: boolean } {
  const job = character.job;
  if (!job) return { item: null, stowed: false };
  character.setJob(null);

  const recipe = recipeMap(recipes).get(job.recipeId);
  const def = recipe ? itemMap(items, categories).get(recipe.item) : null;
  // The recipe was edited out from under a running job — play-testing rules
  // does exactly this. There is nothing to hand over and nothing to refund
  // that would not be a guess, so the bench simply comes up empty.
  if (!def) return { item: null, stowed: false };

  const item = rollItem(def, rng);
  // Whatever would not fit comes back; the caller puts that on the floor. It
  // has been paid for, so losing it is the one outcome not on offer.
  const left = character.inventory.add(item);
  return { item: left ?? item, stowed: !left };
}

/**
 * Build the base up one level.
 *
 * @returns {{ok: boolean, reason: ''|'maxed'|'poor', level: number}}
 */
export function upgradeBase({
  character,
  place,
  baseLevels,
}: {
  character: Character;
  place: Place;
  baseLevels?: readonly BaseLevelInput[];
}): { ok: boolean; reason: string; level: number } {
  const rung = nextBaseLevel(place.baseLevel, baseLevels);
  // No row for the next level is what "fully built" means: the table's own top
  // is the cap, so there is no maximum written down somewhere else to drift.
  if (!rung) return { ok: false, reason: 'maxed', level: place.baseLevel };
  if (!character.spend(rung.costs)) return { ok: false, reason: 'poor', level: place.baseLevel };
  place.baseLevel = rung.level;
  return { ok: true, reason: '', level: place.baseLevel };
}

/**
 * What a range reads as, for a recipe the player has not bought yet.
 *
 * The same sentence the character sheet writes for an item it *has* rolled,
 * with a span where that has a number — "+4–6 Attack power". Written here
 * rather than in the panel so the panel stays something that only sets text.
 */
function describeRange(def: Item, labels: Map<string, string>): string[] {
  return itemRange(def).map((stat) => {
    const name = labels.get(stat.attribute) ?? stat.attribute;
    const span = stat.min === stat.max ? `${stat.min}` : `${stat.min}–${stat.max}`;
    if (stat.op === 'multiply') return `+${span} × ${name}`;
    if (stat.op === 'override') return `${name}: ${span}`;
    return `+${span} ${name}`;
  });
}

/**
 * Everything the bench panel draws.
 *
 * Read on demand rather than kept: the purse moves between frames, and a stale
 * copy would grey out a recipe the player can now afford.
 */
/**
 * What the player is carrying, named.
 *
 * Every currency in the order they are defined, zeroes included: a currency you
 * have none of is still one you can see you have none of, and a read-out that
 * appeared and vanished as you spent the last of something would be worse than
 * one that says 0.
 */
export function purseView(
  currencies: readonly CurrencyInput[] | null | undefined,
  character: Character,
) {
  return (currencies ?? []).map((def) => ({
    id: def.id,
    label: def.label ?? def.id,
    amount: character.amount(def.id ?? ''),
  }));
}

export function craftingView({
  recipes,
  items,
  categories,
  attributes,
  currencies,
  baseLevels,
  character,
  place,
}: CraftingRules & {
  attributes?: readonly AttributeInput[];
  currencies?: readonly CurrencyInput[];
  baseLevels?: readonly BaseLevelInput[];
  character: Character;
  place?: Place | null;
}) {
  const defs = itemMap(items, categories);
  const labels = new Map<string, string>(
    (attributes ?? []).map((attr) => [attr.id ?? '', attr.label ?? attr.id ?? '']),
  );
  // One labeller for every price on the panel: a cost can name a currency or an
  // item, and only something holding both lists can put a name to it.
  const nameCost = costLabeller({ currencies, items });
  const baseLevel = place?.baseLevel ?? 1;
  const rung = nextBaseLevel(baseLevel, baseLevels);

  const job = character.job;

  return {
    purse: purseView(currencies, character),
    baseLevel,
    // Progress rather than seconds left: what the panel draws is a bar, and a
    // bench that took two seconds should not need the panel edited.
    job: job
      ? {
          recipeId: job.recipeId,
          label: job.label,
          progress: Math.min(1, Math.max(0, 1 - job.remaining / job.seconds)),
        }
      : null,
    upgradeCost: rung ? describeCosts(rung.costs, nameCost) : null,
    canUpgrade: rung ? character.affords(rung.costs) : false,
    recipes: recipes.map((entry) => {
      // Normalized directly. Building a one-entry map and reading it back by
      // id was the same call with a lookup wrapped round it, and it could
      // miss on a draft recipe that has no id yet.
      const recipe = normalizeRecipe(entry);
      const def = defs.get(recipe.item);
      const costs = recipeCosts(recipe, items);
      return {
        id: recipe.id,
        label: recipe.label,
        cost: describeCosts(costs, nameCost),
        minBase: recipe.minBase,
        locked: baseLevel < recipe.minBase,
        affordable: character.affords(costs),
        making: job?.recipeId === recipe.id,
        missing: !def,
        lines: def ? describeRange(def, labels) : ['No such item'],
      };
    }),
  };
}

/** The bench, its purse and its recipes, as the panel draws them. */
export type CraftingView = ReturnType<typeof craftingView>;
