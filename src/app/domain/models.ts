export type DietaryNeed = 'gluten-free' | 'vegetarian';
export type Allergen = 'gluten' | 'milk' | 'egg' | 'fish' | 'nuts';
export type MealType = 'breakfast' | 'lunch' | 'dinner';
export interface Person {
  id: string;
  name: string;
  portionFactor: number;
  dietaryNeeds: DietaryNeed[];
  linkedUserId?: string;
}
export interface Household {
  id: string;
  name: string;
  people: Person[];
}
export interface Ingredient {
  id: string;
  name: string;
  quantity: number;
  unit: 'g' | 'ml' | 'st' | 'msk' | 'tsk';
  category: 'Grönt' | 'Skafferi' | 'Mejeri' | 'Kött & fisk';
  component: string;
  allergens: Allergen[];
  glutenFreeAlternative?: { id: string; name: string };
}
export interface RecipeStep {
  text: string;
}
export interface Recipe {
  id: string;
  name: string;
  description: string;
  servings: number;
  totalMinutes: number;
  activeMinutes: number;
  mainIngredient: 'vegetables' | 'fish' | 'chicken' | 'meat' | 'legumes';
  tags: string[];
  dietaryNeeds: DietaryNeed[];
  glutenStrategy: 'naturally-free' | 'split-component' | 'whole-dish' | 'unsupported';
  separateGlutenComponents?: string[];
  ingredients: Ingredient[];
  steps: RecipeStep[];
  image: string;
  imageAlt: string;
  imageKind: 'illustration' | 'ai-generated' | 'photo';
  color: string;
}
export interface PlannedMeal {
  id: string;
  date: string;
  mealType: MealType;
  recipeId: string | null;
  participantIds: string[];
  extraPortions: number;
  maxMinutes: number;
  locked: boolean;
  status: 'planned' | 'cooked';
  cookedAt?: string;
  cookedSnapshot?: { recipeName: string; image: string; imageAlt: string; portions: number; recipe?: Recipe; people?: Person[]; extraPortions?: number; pantryUsed?: PantryStockItem[] };
}
export interface MealPlan { weekStart: string; meals: PlannedMeal[] }
export interface LunchPlan {
  id: string;
  date: string;
  /** New source reference; legacy plans use sourceMealId and imply type 'meal'. */
  sourceType?: 'meal' | 'batch';
  sourceId?: string;
  sourceMealId?: string;
  participantIds: string[];
  portions: number;
  status: 'planned' | 'eaten';
  eatenAt?: string;
}
export interface CookBatch {
  id: string;
  recipeId: string;
  date: string;
  portions: number;
  needs: DietaryNeed[];
  status: 'planned' | 'prepared';
  preparedAt?: string;
  /** Frozen, confirmed preparation recipe and variant, independent of later recipe edits. */
  recipeSnapshot: Recipe;
  pantryUsed?: PantryStockItem[];
}
export interface ShoppingItem {
  id: string;
  ingredientId: string;
  name: string;
  quantity: number;
  unit: Ingredient['unit'];
  category: Ingredient['category'];
  source: 'recipe' | 'manual';
  checked: boolean;
  weekStart?: string;
  rangeKey?: string;
}
export interface PantryStockItem {
  ingredientId: string;
  name: string;
  category: Ingredient['category'];
  quantity: number;
  unit: Ingredient['unit'];
}
export interface AppState {
  version: 1;
  household: Household;
  plans: MealPlan[];
  favoriteRecipeIds: string[];
  shoppingItems: ShoppingItem[];
  planningDays?: number;
  customRecipes?: Recipe[];
  generationSettings?: GenerationSettings;
  pantryIngredientIds?: string[];
  participantPresets?: ParticipantPreset[];
  lunchPlans?: LunchPlan[];
  pantryStock?: PantryStockItem[];
  deductPantryStock?: boolean;
  cookBatches?: CookBatch[];
}
export interface ParticipantPreset { id: string; name: string; participantIds: string[] }
export interface GenerationSettings { vegetarianOnly: boolean; favoritesOnly: boolean; maxMinutes: number | null }
export interface AuthUser { id: string; displayName: string; email?: string }
