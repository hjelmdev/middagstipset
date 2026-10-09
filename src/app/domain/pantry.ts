import { scaleIngredients, supportsNeeds } from './meal-engine.ts';
import { convertQuantity } from './kitchen-units.ts';
import { allocatePantryStock } from './pantry-stock.ts';
import type { Ingredient, PantryStockItem, Person, Recipe } from './models.ts';

export interface PantryRecipeMatch {
  recipe: Recipe;
  required: Ingredient[];
  missing: Ingredient[];
  /** Amount still needed after stock is applied, in each recipe ingredient's unit. */
  missingAmounts: Ingredient[];
  /** Ingredients tracked only by the legacy presence checkbox, with no known amount. */
  unknownAmount: Ingredient[];
  /** Stock exists for this ingredient id but only in an incompatible dimension. */
  incompatibleUnit: Ingredient[];
  missingCount: number;
}

/** Find compatible recipes using ingredient identities, not guessed pantry quantities. */
export function pantryRecipeMatches(
  recipes: Recipe[],
  people: Person[],
  pantryIngredientIds: Iterable<string>,
  maximumMissing = 3,
  pantryStock: PantryStockItem[] = [],
): PantryRecipeMatch[] {
  const pantry = new Set(pantryIngredientIds);
  const matches: PantryRecipeMatch[] = [];

  for (const recipe of recipes) {
    if (!supportsNeeds(recipe, people)) continue;

    // scaleIngredients chooses gluten-free alternatives and scales for the current household.
    const scaled = scaleIngredients(recipe, people);
    const requiredByIdAndUnit = new Map<string, Ingredient>();
    for (const ingredient of scaled) {
      const key = `${ingredient.id}:${ingredient.unit}`;
      const existing = requiredByIdAndUnit.get(key);
      if (existing) existing.quantity += ingredient.quantity;
      else requiredByIdAndUnit.set(key, { ...ingredient });
    }
    const required = [...requiredByIdAndUnit.values()];
    const stockIds = new Set(pantryStock.map(item => item.ingredientId));
    const allocation = allocatePantryStock(pantryStock, required);
    const missingIds = new Set(allocation.remaining.map((ingredient) => ingredient.id)
      .filter(id => stockIds.has(id) || !pantry.has(id)));
    const insufficient = allocation.remaining.filter(ingredient => missingIds.has(ingredient.id));
    const incompatibleUnit = insufficient.filter(ingredient => stockIds.has(ingredient.id) &&
      !pantryStock.some(item => item.ingredientId === ingredient.id && convertQuantity(1, item.unit, ingredient.unit) !== null));
    const unknownAmount = required.filter(ingredient => !stockIds.has(ingredient.id) && pantry.has(ingredient.id));
    const missingAmounts = insufficient.filter(ingredient => !unknownAmount.some(unknown => unknown.id === ingredient.id));
    const missing = required.filter((ingredient) => missingIds.has(ingredient.id));
    const missingCount = missingIds.size;
    if (missingCount <= maximumMissing) matches.push({ recipe, required, missing, missingAmounts, unknownAmount, incompatibleUnit, missingCount });
  }

  return matches.sort((a, b) => a.missingCount - b.missingCount || a.recipe.name.localeCompare(b.recipe.name, 'sv-SE'));
}
