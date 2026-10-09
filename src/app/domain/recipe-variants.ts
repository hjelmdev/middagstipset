import type { Recipe } from './models.ts';

export interface VariantIngredientReview {
  id: string;
  name: string;
  originalName: string;
  glutenStatus: string;
  originalGlutenStatus: string;
}

export interface PreservedGlutenMetadata {
  preserved: boolean;
  glutenStrategy: Recipe['glutenStrategy'];
  separateGlutenComponents?: string[];
}

/** Make an independent private draft while leaving the original seed recipe untouched. */
export function cloneRecipeAsVariant(recipe: Recipe, id = `custom:${crypto.randomUUID()}`): Recipe {
  return {
    ...structuredClone(recipe),
    id,
    name: `${recipe.name} (min variant)`,
  };
}

/** Keep reviewed seed gluten handling only while every ingredient and its status stays unchanged. */
export function preservedVariantGlutenMetadata(recipe: Recipe, rows: VariantIngredientReview[]): PreservedGlutenMetadata {
  const preserved = rows.length === recipe.ingredients.length && rows.every((row, index) => {
    const original = recipe.ingredients[index];
    return row.id === original.id && row.originalName === original.name && row.name.trim() === original.name
      && row.glutenStatus === row.originalGlutenStatus;
  });
  return {
    preserved,
    glutenStrategy: preserved ? recipe.glutenStrategy : 'unsupported',
    ...(preserved && recipe.separateGlutenComponents ? { separateGlutenComponents: [...recipe.separateGlutenComponents] } : {}),
  };
}
