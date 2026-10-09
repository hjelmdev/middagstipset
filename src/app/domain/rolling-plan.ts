import { generatePlan, shiftDate, weekStart } from './meal-engine.ts';
import type { MealPlan, Person, PlannedMeal, Recipe } from './models.ts';

const DEFAULT_PLANNING_DAYS = 7;
const MAX_PLANNING_DAYS = 28;

export function clampPlanningDays(days: number): number {
  if (Number.isNaN(days)) return DEFAULT_PLANNING_DAYS;
  return Math.min(MAX_PLANNING_DAYS, Math.max(1, Math.trunc(days)));
}

/** Return one winning dinner per date, resolving duplicated week-bucket rows. */
export function mealsByDate(plans: MealPlan[]): PlannedMeal[] {
  const selected = new Map<string, { meal: PlannedMeal; bucket: number; row: number }>();

  plans.forEach((plan, bucket) => {
    plan.meals.forEach((meal, row) => {
      const key = `${meal.date}:${meal.mealType}`;
      const previous = selected.get(key);
      const mealPriority = meal.status === 'cooked' ? 2 : meal.locked ? 1 : 0;
      const previousPriority = previous
        ? previous.meal.status === 'cooked' ? 2 : previous.meal.locked ? 1 : 0
        : -1;

      if (!previous || mealPriority > previousPriority ||
        (mealPriority === previousPriority && (bucket > previous.bucket || (bucket === previous.bucket && row >= previous.row)))) {
        selected.set(key, { meal, bucket, row });
      }
    });
  });

  return [...selected.values()].map((entry) => entry.meal)
    .sort((a, b) => a.date.localeCompare(b.date) || a.mealType.localeCompare(b.mealType));
}

function defaultDinner(date: string, people: Person[]): PlannedMeal {
  const day = new Date(`${date}T12:00:00`).getDay();
  const isWeekend = day === 0 || day === 6;
  return {
    id: `${date}-dinner`, date, mealType: 'dinner', recipeId: null,
    participantIds: people.map((person) => person.id), extraPortions: 0,
    maxMinutes: isWeekend ? 60 : 35, locked: false, status: 'planned',
  };
}

/** Create a transient date range while reusing any existing dinner rows. */
export function planningWindow(
  plans: MealPlan[],
  start: string,
  days: number,
  people: Person[],
): MealPlan {
  const existing = new Map(mealsByDate(plans)
    .filter((meal) => meal.mealType === 'dinner')
    .map((meal) => [meal.date, meal]));
  const length = clampPlanningDays(days);
  const meals = Array.from({ length }, (_, index) => {
    const date = shiftDate(start, index);
    return existing.get(date) ?? defaultDinner(date, people);
  });

  return { weekStart: start, meals };
}

/** Merge a rolling window back into Monday-based storage buckets. */
export function mergeMeals(plans: MealPlan[], meals: PlannedMeal[]): MealPlan[] {
  const byDateAndType = new Map<string, PlannedMeal>();
  for (const meal of mealsByDate(plans)) byDateAndType.set(`${meal.date}:${meal.mealType}`, meal);
  // Incoming rows represent the latest edit and therefore win on duplicate keys.
  for (const meal of meals) byDateAndType.set(`${meal.date}:${meal.mealType}`, meal);

  const buckets = new Map<string, PlannedMeal[]>();
  for (const meal of byDateAndType.values()) {
    const key = weekStart(new Date(`${meal.date}T12:00:00`));
    const bucket = buckets.get(key) ?? [];
    bucket.push(meal);
    buckets.set(key, bucket);
  }

  return [...buckets.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([start, entries]) => ({
      weekStart: start,
      meals: entries.sort((a, b) => a.date.localeCompare(b.date) || a.mealType.localeCompare(b.mealType)),
    }));
}

/** Fill only empty dinners; current recipe choices and their lock state remain intact. */
export function fillMissingMeals(
  plan: MealPlan,
  recipes: Recipe[],
  people: Person[],
  favorites: string[] = [],
  history: string[] = [],
  random: () => number = Math.random,
): MealPlan {
  const priorLocks = new Map(plan.meals.map((meal) => [meal.id, meal.locked]));
  const protectedPlan: MealPlan = {
    ...plan,
    meals: plan.meals.map((meal) => meal.recipeId || meal.locked || meal.status === 'cooked'
      ? { ...meal, locked: true }
      : meal),
  };
  const filled = generatePlan(protectedPlan, recipes, people, favorites, history, random);

  return {
    ...filled,
    meals: filled.meals.map((meal) => ({ ...meal, locked: priorLocks.get(meal.id) ?? meal.locked })),
  };
}
