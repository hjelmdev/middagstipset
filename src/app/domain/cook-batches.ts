import { localDate, scaleIngredients, supportsNeeds } from './meal-engine.ts';
import type { CookBatch, DietaryNeed, Ingredient, LunchPlan, Person, Recipe, ShoppingItem } from './models.ts';
import { isCalendarDate, lunchSourceId, lunchSourceType } from './leftovers.ts';

export function batchPrepPerson(portions: number, needs: DietaryNeed[]): Person {
  return { id: 'cook-batch-preparation', name: 'Tillagning', portionFactor: portions, dietaryNeeds: [...needs] };
}

export function cookBatchPreparationError(recipe: Recipe, needs: DietaryNeed[]): string {
  if (needs.includes('vegetarian') && !recipe.dietaryNeeds.includes('vegetarian')) {
    return 'Välj ett vegetariskt recept för en vegetarisk batch.';
  }
  if (!supportsNeeds(recipe, [batchPrepPerson(1, needs)])) {
    return 'Receptet saknar verifierade alternativ för den valda tillagningskosten.';
  }
  return '';
}

export function cookBatchIngredients(batch: CookBatch): Ingredient[] {
  return scaleIngredients(batch.recipeSnapshot, [batchPrepPerson(batch.portions, batch.needs)]);
}

export function cookBatchAvailableDate(batch: CookBatch): string {
  return batch.status === 'prepared' && batch.preparedAt
    ? localDate(new Date(batch.preparedAt))
    : batch.date;
}

export function batchLunchCompatibilityError(batch: CookBatch, lunchPeople: Person[]): string {
  const recipe = batch.recipeSnapshot;
  const lunchNeeds = new Set(lunchPeople.flatMap(person => person.dietaryNeeds));
  if (lunchNeeds.has('vegetarian') && !recipe.dietaryNeeds.includes('vegetarian')) {
    return 'Den här batchen är inte vegetarisk för alla valda deltagare.';
  }
  const naturallyGlutenFree = recipe.glutenStrategy === 'naturally-free' &&
    recipe.ingredients.every(ingredient => !ingredient.allergens.includes('gluten'));
  const preparedGlutenFree = batch.needs.includes('gluten-free') && !cookBatchPreparationError(recipe, batch.needs);
  if (lunchNeeds.has('gluten-free') && !naturallyGlutenFree && !preparedGlutenFree) {
    return 'Batchen är inte bekräftat tillagad glutenfri. Välj en naturligt glutenfri eller glutenfritt tillagad batch.';
  }
  return '';
}

export function cookBatchEatenError(batch: CookBatch | undefined, lunchPeople: Person[]): string {
  if (!batch || batch.status !== 'prepared') return 'Markera batchen som tillagad innan du markerar lunchportionen som uppäten.';
  const preparationError = cookBatchPreparationError(batch.recipeSnapshot, batch.needs);
  if (preparationError) return 'Batchens frysta tillagningskost kan inte längre verifieras.';
  return batchLunchCompatibilityError(batch, lunchPeople);
}

export function cookBatchUndoError(batch: CookBatch, lunches: LunchPlan[]): string {
  if (batch.status !== 'prepared') return 'Storkoket är inte markerat som tillagat.';
  if (lunches.some(lunch => lunchSourceType(lunch) === 'batch' && lunchSourceId(lunch) === batch.id && lunch.status === 'eaten')) {
    return 'Storkoket kan inte ångras eftersom en lunchportion redan är markerad som uppäten.';
  }
  if (lunches.some(lunch => lunchSourceType(lunch) === 'batch' && lunchSourceId(lunch) === batch.id && lunch.status === 'planned' && lunch.date < batch.date)) {
    return 'Flytta eller ta bort luncher före batchens planerade tillagningsdatum innan du ångrar tillagningen.';
  }
  return '';
}

export function cookBatchPrepareReservationError(batch: CookBatch, lunches: LunchPlan[], preparedDate: string): string {
  if (lunches.some(lunch => lunchSourceType(lunch) === 'batch' && lunchSourceId(lunch) === batch.id && lunch.status === 'planned' && lunch.date < preparedDate)) {
    return 'Flytta eller ta bort luncher med passerat datum innan du markerar storkoket som tillagat.';
  }
  return '';
}

export function cookBatchRemovalError(batch: CookBatch, lunches: LunchPlan[]): string {
  if (batch.status !== 'planned') return 'Ångra tillagningen innan storkoket tas bort.';
  if (lunches.some(lunch => lunchSourceType(lunch) === 'batch' && lunchSourceId(lunch) === batch.id)) {
    return 'Ta bort storkokets lunchplaner innan du tar bort batchen.';
  }
  return '';
}

/** Batches are included whole if planned cooking or a planned lunch falls in the requested window. */
export function plannedCookBatchShopping(
  batches: CookBatch[],
  lunches: LunchPlan[],
  rangeStart: string,
  rangeDays: number,
  today: string,
): CookBatch[] {
  const dates = new Set(Array.from({ length: rangeDays }, (_, index) => {
    const date = new Date(`${rangeStart}T12:00:00`);
    date.setDate(date.getDate() + index);
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
  }));
  const byId = new Map(batches.map(batch => [batch.id, batch]));
  const selectedIds = new Set(batches.filter(batch => batch.status === 'planned' && dates.has(batch.date)).map(batch => batch.id));
  for (const lunch of lunches) {
    if (lunch.status !== 'planned' || lunch.date < today || !dates.has(lunch.date) || lunchSourceType(lunch) !== 'batch') continue;
    const batch = byId.get(lunchSourceId(lunch));
    if (batch?.status === 'planned') selectedIds.add(batch.id);
  }
  return batches.filter(batch => selectedIds.has(batch.id));
}

export function cookBatchShoppingItems(batches: CookBatch[], weekStart: string): ShoppingItem[] {
  const summed = new Map<string, ShoppingItem>();
  for (const batch of [...new Map(batches.map(batch => [batch.id, batch])).values()]) {
    for (const ingredient of cookBatchIngredients(batch)) {
      const id = `recipe:${ingredient.id}:${ingredient.unit}`;
      const current = summed.get(id);
      if (current) current.quantity += ingredient.quantity;
      else summed.set(id, { id, ingredientId: ingredient.id, name: ingredient.name, quantity: ingredient.quantity,
        unit: ingredient.unit, category: ingredient.category, source: 'recipe', checked: false, weekStart });
    }
  }
  return [...summed.values()];
}

export function createCookBatchRecord(
  recipe: Recipe,
  id: string,
  date: string,
  portions: number,
  needs: DietaryNeed[],
): CookBatch {
  if (!isCalendarDate(date)) throw new Error('Välj ett giltigt tillagningsdatum.');
  if (!Number.isFinite(portions) || portions <= 0 || portions > 120) throw new Error('Batchen måste innehålla mellan 0 och 120 portioner.');
  const normalizedNeeds = [...new Set(needs)];
  if (normalizedNeeds.some(need => need !== 'gluten-free' && need !== 'vegetarian')) throw new Error('Välj giltiga kostbehov för tillagningen.');
  const error = cookBatchPreparationError(recipe, normalizedNeeds);
  if (error) throw new Error(error);
  return { id, recipeId: recipe.id, date, portions, needs: normalizedNeeds, status: 'planned', recipeSnapshot: structuredClone(recipe) };
}

/** Validate a stored lunch source discriminator and ID, including the v1 legacy form. */
export function isCookBatchSourceReference(lunch: LunchPlan, id: string): boolean {
  return lunchSourceType(lunch) === 'batch' && lunchSourceId(lunch) === id;
}

