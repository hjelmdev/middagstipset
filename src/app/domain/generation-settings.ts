import type { GenerationSettings, Recipe } from './models.ts';

/** Apply all active suggestion filters together; an empty favorites list stays empty. */
export function filterRecipes(
  recipes: Recipe[],
  favorites: string[],
  settings: GenerationSettings,
): Recipe[] {
  return recipes.filter((recipe) =>
    (!settings.vegetarianOnly || recipe.dietaryNeeds.includes('vegetarian')) &&
    (!settings.favoritesOnly || favorites.includes(recipe.id)) &&
    (settings.maxMinutes === null || recipe.totalMinutes <= settings.maxMinutes));
}
