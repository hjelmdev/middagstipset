import type { PlannedMeal } from './models.ts';

export interface ClearedMealsCheckpoint {
  original: PlannedMeal[];
  cleared: PlannedMeal[];
}

export type ClearMealsResult = { checkpoint: ClearedMealsCheckpoint; error: '' } | { checkpoint: null; error: string };
export type RestoreMealsResult = { meals: PlannedMeal[]; error: '' } | { meals: null; error: string };

/** Validate all selected rows before producing any changes, so bulk clearing is atomic. */
export function clearPlannedMeals(
  currentMeals: PlannedMeal[],
  ids: string[],
  reservedSourceMealIds: ReadonlySet<string>,
): ClearMealsResult {
  const uniqueIds = [...new Set(ids)];
  if (!ids.length) return { checkpoint: null, error: 'Välj minst en planerad middag att tömma.' };
  if (uniqueIds.length !== ids.length) return { checkpoint: null, error: 'Samma middag har valts flera gånger. Uppdatera urvalet och försök igen.' };
  const byId = new Map(currentMeals.map(meal => [meal.id, meal]));
  const original: PlannedMeal[] = [];
  for (const id of uniqueIds) {
    const meal = byId.get(id);
    if (!meal) return { checkpoint: null, error: 'En vald middag finns inte längre i den aktuella planeringen.' };
    if (!meal.recipeId || meal.status !== 'planned' || meal.locked) {
      return { checkpoint: null, error: 'Bara planerade, olåsta middagar med recept kan tömmas.' };
    }
    if (reservedSourceMealIds.has(meal.id)) {
      return { checkpoint: null, error: 'En middag med lunchreservationer kan inte tömmas. Ta bort lunchplanerna först.' };
    }
    original.push(structuredClone(meal));
  }
  const cleared = original.map(meal => {
    const { cookedAt: _cookedAt, cookedSnapshot: _cookedSnapshot, ...planned } = meal;
    return { ...planned, recipeId: null, status: 'planned' as const };
  });
  return { checkpoint: { original, cleared }, error: '' };
}

function isUnchangedClearedMeal(current: PlannedMeal | undefined, expected: PlannedMeal): boolean {
  return !!current && current.id === expected.id && current.date === expected.date && current.mealType === expected.mealType &&
    current.recipeId === null && current.status === 'planned' && !current.locked &&
    current.extraPortions === expected.extraPortions && current.maxMinutes === expected.maxMinutes &&
    current.participantIds.length === expected.participantIds.length &&
    current.participantIds.every((id, index) => id === expected.participantIds[index]) &&
    current.cookedAt === undefined && current.cookedSnapshot === undefined;
}

/** Restore only if every cleared row still matches its expected empty state. */
export function restoreClearedMeals(currentMeals: PlannedMeal[], checkpoint: ClearedMealsCheckpoint): RestoreMealsResult {
  const byId = new Map(currentMeals.map(meal => [meal.id, meal]));
  if (checkpoint.original.length !== checkpoint.cleared.length ||
    checkpoint.cleared.some(expected => !isUnchangedClearedMeal(byId.get(expected.id), expected))) {
    return { meals: null, error: 'Återställningen avbröts eftersom en eller flera middagar har ändrats efter tömningen.' };
  }
  return { meals: checkpoint.original.map(meal => structuredClone(meal)), error: '' };
}
