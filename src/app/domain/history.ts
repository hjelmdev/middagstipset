import { localDate, portionCount } from './meal-engine.ts';
import type { Person, PlannedMeal, Recipe } from './models.ts';

export function mealHistory(meals: PlannedMeal[], recipes: Recipe[], people: Person[], today: string) {
  return meals.filter(meal => !!meal.recipeId && (meal.date < today || meal.status === 'cooked')).map(meal => {
    const recipe = meal.cookedSnapshot?.recipe ?? recipes.find(candidate => candidate.id === meal.recipeId);
    const cookedTime = meal.cookedAt ? new Date(meal.cookedAt) : null;
    const date = meal.status === 'cooked' && cookedTime && Number.isFinite(cookedTime.getTime()) ? localDate(cookedTime) : meal.date;
    return { meal, recipe, date, name: meal.cookedSnapshot?.recipeName ?? recipe?.name ?? 'Tidigare recept',
      portions: meal.cookedSnapshot?.portions ?? portionCount(people.filter(p => meal.participantIds.includes(p.id)), meal.extraPortions),
      image: meal.cookedSnapshot?.image ?? recipe?.image, imageAlt: meal.cookedSnapshot?.imageAlt ?? recipe?.imageAlt };
  }).sort((a, b) => b.date.localeCompare(a.date));
}
