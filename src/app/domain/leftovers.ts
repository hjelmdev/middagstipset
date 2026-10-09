import type { CookBatch, LunchPlan, Person, PlannedMeal, Recipe } from './models.ts';
import { localDate, supportsNeeds } from './meal-engine.ts';

interface LunchSourceBase {
  id: string;
  date: string;
  recipeId: string;
  recipe: Recipe;
  status: PlannedMeal['status'] | CookBatch['status'];
  capacityPortions: number;
  reservedPortions: number;
  availablePortions: number;
}

export type LunchSource = (LunchSourceBase & {
  kind: 'meal';
  status: PlannedMeal['status'];
  people: Person[];
  meal: PlannedMeal;
}) | (LunchSourceBase & {
  kind: 'batch';
  status: CookBatch['status'];
  needs: CookBatch['needs'];
  batch: CookBatch;
});

export function lunchSourceType(lunch: LunchPlan): 'meal' | 'batch' {
  return lunch.sourceType ?? 'meal';
}

export function lunchSourceId(lunch: LunchPlan): string {
  return lunch.sourceId ?? lunch.sourceMealId ?? '';
}

export function isCalendarDate(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

export function sourceExtraPortions(meal: PlannedMeal): number {
  return meal.status === 'cooked'
    ? meal.cookedSnapshot?.extraPortions ?? meal.extraPortions
    : meal.extraPortions;
}

export function portionNeed(participantIds: string[], people: Person[]): number {
  const selected = new Set(participantIds);
  return people.filter(person => selected.has(person.id)).reduce((sum, person) => sum + person.portionFactor, 0);
}

export function reservedPortions(lunchPlans: LunchPlan[], sourceId: string, sourceType: 'meal' | 'batch' = 'meal'): number {
  return lunchPlans.filter(lunch => lunchSourceId(lunch) === sourceId && lunchSourceType(lunch) === sourceType)
    .reduce((sum, lunch) => sum + lunch.portions, 0);
}

export function lunchSourcePeople(meal: PlannedMeal, people: Person[]): Person[] {
  if (meal.status === 'cooked' && meal.cookedSnapshot?.people) return meal.cookedSnapshot.people;
  return people.filter(person => meal.participantIds.includes(person.id));
}

export function lunchSourceRecipe(meal: PlannedMeal, recipes: Recipe[]): Recipe | undefined {
  return meal.status === 'cooked' && meal.cookedSnapshot?.recipe
    ? meal.cookedSnapshot.recipe
    : recipes.find(recipe => recipe.id === meal.recipeId);
}

/** Return a user-facing explanation when the prepared source cannot serve this lunch. */
export function lunchCompatibilityError(recipe: Recipe, sourcePeople: Person[], lunchPeople: Person[], source?: PlannedMeal): string {
  const needs = new Set(lunchPeople.flatMap(person => person.dietaryNeeds));
  if (needs.has('vegetarian') && !recipe.dietaryNeeds.includes('vegetarian')) {
    return 'Den här lunchkällan är inte vegetarisk för alla valda deltagare.';
  }
  const naturallyGlutenFree = recipe.glutenStrategy === 'naturally-free' &&
    recipe.ingredients.every(ingredient => !ingredient.allergens.includes('gluten'));
  if (needs.has('gluten-free') && !naturallyGlutenFree) {
    const actualSourcePeople = source?.status === 'cooked' ? source.cookedSnapshot?.people ?? [] : sourcePeople;
    const sourceWasPreparedGlutenFree = actualSourcePeople.some(person => person.dietaryNeeds.includes('gluten-free')) &&
      supportsNeeds(recipe, actualSourcePeople);
    if (!sourceWasPreparedGlutenFree) {
      return 'Den här maten är inte bekräftat tillagad glutenfri. Välj en naturligt glutenfri rätt eller en middag som lagats glutenfritt.';
    }
  }
  return '';
}

export function lunchEatenError(
  source: PlannedMeal | undefined,
  recipe: Recipe | undefined,
  sourcePeople: Person[],
  lunchPeople: Person[],
): string {
  if (!source || source.status !== 'cooked') return 'Markera middagen som lagad innan du markerar lunchlådan som uppäten.';
  if (!recipe) return 'Receptet för lunchkällan finns inte längre.';
  if (!supportsNeeds(recipe, sourcePeople)) return 'Den lagade middagen uppfyller inte längre kostbehoven för sin frysta deltagarlista.';
  return lunchCompatibilityError(recipe, sourcePeople, lunchPeople, source);
}

export function sourceReservationMutationError(
  source: PlannedMeal,
  updated: PlannedMeal,
  reservations: LunchPlan[],
  recipe: Recipe | undefined,
  sourcePeople: Person[],
  people: Person[],
): string {
  if (!reservations.length) return '';
  if (source.status === 'cooked' && updated.status === 'planned' && reservations.some(lunch => lunch.status === 'eaten')) {
    return 'Middagen kan inte ångras eftersom en lunchportion redan är markerad som uppäten.';
  }
  const changed = source.recipeId !== updated.recipeId || source.extraPortions !== updated.extraPortions ||
    source.participantIds.join('\u0000') !== updated.participantIds.join('\u0000') || source.status !== updated.status;
  if (!changed) return '';
  if (reservations.reduce((sum, lunch) => sum + lunch.portions, 0) > sourceExtraPortions(updated) + 0.000001) {
    return 'Ändringen skulle ta bort portioner som redan reserverats till lunch. Ta bort lunchplanerna först.';
  }
  if (!recipe) return 'Middagen har lunchreservationer och kan inte ändras till ett recept som saknas.';
  if (!supportsNeeds(recipe, sourcePeople)) return 'Middagens ändring passar inte längre kostbehoven för dem som ska äta middagen.';
  for (const lunch of reservations.filter(item => item.status === 'planned')) {
    const lunchPeople = people.filter(person => lunch.participantIds.includes(person.id));
    const error = lunchCompatibilityError(recipe, sourcePeople, lunchPeople, updated);
    if (error) return `Middagen har lunchreservationer. ${error}`;
  }
  return '';
}

export function buildLunchSources(
  meals: PlannedMeal[],
  recipes: Recipe[],
  people: Person[],
  lunchPlans: LunchPlan[],
  batches: CookBatch[] = [],
): LunchSource[] {
  const dinnerSources: LunchSource[] = meals.flatMap(meal => {
    const capacityPortions = sourceExtraPortions(meal);
    const recipe = lunchSourceRecipe(meal, recipes);
    if (capacityPortions <= 0 || !recipe) return [];
    const reserved = reservedPortions(lunchPlans, meal.id);
    return [{
      kind: 'meal' as const,
      id: meal.id,
      date: meal.date,
      recipeId: recipe.id,
      recipe,
      status: meal.status,
      people: lunchSourcePeople(meal, people),
      capacityPortions,
      reservedPortions: reserved,
      availablePortions: Math.max(0, capacityPortions - reserved),
      meal,
    }];
  });
  const batchSources: LunchSource[] = batches.flatMap(batch => {
    const recipe = batch.recipeSnapshot;
    const reserved = reservedPortions(lunchPlans, batch.id, 'batch');
    const date = batch.status === 'prepared' && batch.preparedAt ? localDate(new Date(batch.preparedAt)) : batch.date;
    return [{ kind: 'batch' as const, id: batch.id, date, recipeId: recipe.id, recipe,
      status: batch.status, needs: batch.needs, capacityPortions: batch.portions, reservedPortions: reserved,
      availablePortions: Math.max(0, batch.portions - reserved), batch }];
  });
  return [...dinnerSources, ...batchSources].sort((a, b) => a.date.localeCompare(b.date) || a.kind.localeCompare(b.kind));
}

export function plannedLunchShoppingMeals(
  lunches: LunchPlan[],
  sourceMeals: PlannedMeal[],
  rangeStart: string,
  rangeDays: number,
  today: string,
): PlannedMeal[] {
  const dates = new Set(Array.from({ length: rangeDays }, (_, index) => {
    const date = new Date(`${rangeStart}T12:00:00`);
    date.setDate(date.getDate() + index);
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
  }));
  const byId = new Map(sourceMeals.map(meal => [meal.id, meal]));
  const neededSources = new Set<string>();
  for (const lunch of lunches) {
    if (lunch.status !== 'planned' || lunch.date < today || !dates.has(lunch.date)) continue;
    if (lunchSourceType(lunch) !== 'meal') continue;
    const source = byId.get(lunchSourceId(lunch));
    if (!source || source.status === 'cooked' || dates.has(source.date)) continue;
    neededSources.add(source.id);
  }
  // Include the whole uncooked dinner once, even when its date is outside the selected dinner interval.
  // This purchases the ingredients needed to make both the dinner and its reserved lunch leftovers,
  // preserving the source participants used to select gluten-free variants.
  return [...neededSources].flatMap(sourceMealId => {
    const source = byId.get(sourceMealId);
    return source?.recipeId ? [source] : [];
  });
}
