import type { Ingredient, MealPlan, Person, PlannedMeal, Recipe, ShoppingItem } from './models.ts';

export function localDate(date = new Date()): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}
export function weekStart(date = new Date()): string {
  const monday = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  monday.setDate(monday.getDate() - (monday.getDay() + 6) % 7);
  return localDate(monday);
}
export function shiftDate(date: string, days: number): string {
  const result = new Date(`${date}T12:00:00`);
  result.setDate(result.getDate() + days);
  return localDate(result);
}
export function emptyPlan(start: string, people: Person[]): MealPlan {
  return { weekStart: start, meals: Array.from({ length: 7 }, (_, index) => ({
    id: `${start}-${index}-dinner`, date: shiftDate(start, index), mealType: 'dinner',
    recipeId: null, participantIds: people.map(p => p.id), extraPortions: 0,
    maxMinutes: index < 5 ? 35 : 60, locked: false, status: 'planned',
  })) };
}
export function portionCount(people: Person[], extraPortions = 0): number {
  return people.reduce((sum, person) => sum + person.portionFactor, 0) + Math.max(0, extraPortions);
}
export function supportsNeeds(recipe: Recipe, people: Person[]): boolean {
  const needs = new Set(people.flatMap(p => p.dietaryNeeds));
  if (needs.has('vegetarian') && !recipe.dietaryNeeds.includes('vegetarian')) return false;
  if (!needs.has('gluten-free')) return true;
  if (recipe.glutenStrategy === 'unsupported') return false;
  return recipe.ingredients.every(i => !i.allergens.includes('gluten') || !!i.glutenFreeAlternative);
}
export function scaleIngredients(recipe: Recipe, people: Person[], extraPortions = 0): Ingredient[] {
  if (!supportsNeeds(recipe, people)) throw new Error('Receptet saknar en verifierbar anpassning för valda kostbehov.');
  const total = portionCount(people, extraPortions);
  if (total <= 0) return [];
  const glutenFree = people.filter(p => p.dietaryNeeds.includes('gluten-free')).reduce((n, p) => n + p.portionFactor, 0);
  const result: Ingredient[] = [];
  for (const ingredient of recipe.ingredients) {
    const amount = ingredient.quantity / recipe.servings;
    const alternative = ingredient.glutenFreeAlternative;
    if (glutenFree > 0 && ingredient.allergens.includes('gluten') && alternative) {
      // Extra portions follow the safest shared variant until separate recipients are modeled.
      const isSeparate = recipe.glutenStrategy === 'split-component' && recipe.separateGlutenComponents?.includes(ingredient.component);
      const adapted = isSeparate ? glutenFree + Math.max(0, extraPortions) : total;
      if (adapted < total) result.push({ ...ingredient, quantity: amount * (total - adapted) });
      result.push({ ...ingredient, ...alternative, quantity: amount * adapted, allergens: ingredient.allergens.filter(a => a !== 'gluten'), glutenFreeAlternative: undefined });
    } else result.push({ ...ingredient, quantity: amount * total });
  }
  return result;
}
export function generatePlan(plan: MealPlan, recipes: Recipe[], people: Person[], favorites: string[] = [], previousRecipeIds: string[] = [], random = Math.random): MealPlan {
  const used = new Set(plan.meals.filter(m => (m.locked || m.status === 'cooked') && m.recipeId).map(m => m.recipeId!));
  const mains = new Map<string, number>();
  for (const meal of plan.meals.filter(m => m.locked || m.status === 'cooked')) {
    const recipe = recipes.find(r => r.id === meal.recipeId);
    if (recipe) mains.set(recipe.mainIngredient, (mains.get(recipe.mainIngredient) ?? 0) + 1);
  }
  return { ...plan, meals: plan.meals.map(meal => {
    if (meal.locked || meal.status === 'cooked') return meal;
    const eaters = people.filter(p => meal.participantIds.includes(p.id));
    if (portionCount(eaters, meal.extraPortions) === 0) return { ...meal, recipeId: null };
    const candidates = recipes.filter(r => r.totalMinutes <= meal.maxMinutes && supportsNeeds(r, eaters));
    const scored = candidates.map(recipe => ({ recipe, score:
      (used.has(recipe.id) ? -100 : 0) + (previousRecipeIds.includes(recipe.id) ? -10 : 0) +
      (favorites.includes(recipe.id) ? 4 : 0) - (mains.get(recipe.mainIngredient) ?? 0) * 5 + random() * 3 +
      (recipe.id === meal.recipeId ? -2 : 0)
    })).sort((a, b) => b.score - a.score);
    const selected = scored[0]?.recipe;
    if (selected) { used.add(selected.id); mains.set(selected.mainIngredient, (mains.get(selected.mainIngredient) ?? 0) + 1); }
    return { ...meal, recipeId: selected?.id ?? null, status: 'planned' };
  }) };
}
export function replaceMeal(meal: PlannedMeal, recipes: Recipe[], people: Person[], used: string[], favorites: string[] = []): PlannedMeal {
  if (meal.locked || meal.status === 'cooked') return meal;
  const replacement = generatePlan({ weekStart: meal.date, meals: [meal] }, recipes.filter(r => r.id !== meal.recipeId), people, favorites, used).meals[0];
  return replacement.recipeId ? replacement : meal;
}
export function buildShoppingList(plan: MealPlan, recipes: Recipe[], people: Person[], previous: ShoppingItem[] = []): ShoppingItem[] {
  const summed = new Map<string, ShoppingItem>();
  for (const meal of plan.meals) {
    const recipe = recipes.find(r => r.id === meal.recipeId);
    if (!recipe || meal.status === 'cooked') continue;
    for (const ingredient of scaleIngredients(recipe, people.filter(p => meal.participantIds.includes(p.id)), meal.extraPortions)) {
      const key = `recipe:${ingredient.id}:${ingredient.unit}`;
      const existing = summed.get(key);
      if (existing) existing.quantity += ingredient.quantity;
      else summed.set(key, { id: key, ingredientId: ingredient.id, name: ingredient.name, quantity: ingredient.quantity, unit: ingredient.unit, category: ingredient.category, source: 'recipe', checked: false, weekStart: plan.weekStart });
    }
  }
  return [...summed.values()].map(item => ({ ...item, checked: previous.some(p => p.id === item.id && p.checked && Math.abs(p.quantity - item.quantity) < 0.0001) }))
    .concat(previous.filter(item => item.source === 'manual'));
}
