import assert from 'node:assert/strict';
import test from 'node:test';
import { validateState } from '../src/app/core/state.repository.ts';
import { filterRecipes } from '../src/app/domain/generation-settings.ts';
import { fillMissingMeals } from '../src/app/domain/rolling-plan.ts';
import { supportsNeeds } from '../src/app/domain/meal-engine.ts';
import { RECIPES } from '../src/app/data/recipes.ts';
import type { AppState, GenerationSettings, Person, PlannedMeal, Recipe } from '../src/app/domain/models.ts';

const noFilters: GenerationSettings = { vegetarianOnly: false, favoritesOnly: false, maxMinutes: null };

function baseState(): AppState {
  return {
    version: 1,
    household: { id: 'home', name: 'Hemma', people: [{ id: 'adult', name: 'Vuxen', portionFactor: 1, dietaryNeeds: [] }] },
    plans: [], favoriteRecipeIds: [], shoppingItems: [],
  };
}

function customRecipe(overrides: Partial<Recipe> = {}): Recipe {
  return { ...RECIPES[0], id: 'custom:my-first-recipe', image: 'images/custom-recipe.svg', ...overrides };
}

function meal(date: string, recipeId: string | null, patch: Partial<PlannedMeal> = {}): PlannedMeal {
  return {
    id: `${date}-dinner`, date, mealType: 'dinner', recipeId,
    participantIds: ['glutenfree'], extraPortions: 0, maxMinutes: 60,
    locked: false, status: 'planned', ...patch,
  };
}

test('all recipe filters apply together with AND; empty favorites produce no suggestions', () => {
  assert.deepEqual(filterRecipes(RECIPES, [], { ...noFilters, favoritesOnly: true }), []);

  const selected = filterRecipes(RECIPES, ['svarta-bon-tacos', 'kottfarslasagne'], {
    vegetarianOnly: true, favoritesOnly: true, maxMinutes: 25,
  });
  assert.deepEqual(selected.map((recipe) => recipe.id), ['svarta-bon-tacos']);
});

test('generation filters do not replace meal-engine dietary compatibility checks', () => {
  const glutenFreePerson: Person = { id: 'glutenfree', name: 'Glutenfritt', portionFactor: 1, dietaryNeeds: ['gluten-free'] };
  const candidates = filterRecipes(RECIPES, [], noFilters);
  const generated = fillMissingMeals({
    weekStart: '2026-10-12',
    meals: [meal('2026-10-12', null)],
  }, candidates, [glutenFreePerson], [], [], () => 0.5);
  const selected = RECIPES.find((recipe) => recipe.id === generated.meals[0].recipeId);

  assert.ok(selected);
  assert.equal(supportsNeeds(selected, [glutenFreePerson]), true);
});

test('existing recipe remains unchanged even if new suggestion filters exclude it', () => {
  const glutenFreePerson: Person = { id: 'glutenfree', name: 'Glutenfritt', portionFactor: 1, dietaryNeeds: ['gluten-free'] };
  const existing = meal('2026-10-12', 'kottfarslasagne', { locked: false });
  const candidates = filterRecipes(RECIPES, ['svarta-bon-tacos'], {
    vegetarianOnly: true, favoritesOnly: true, maxMinutes: 25,
  });
  const generated = fillMissingMeals({
    weekStart: '2026-10-12',
    meals: [existing, meal('2026-10-13', null)],
  }, candidates, [glutenFreePerson], [], [], () => 0.5);

  assert.equal(generated.meals[0].recipeId, existing.recipeId);
  assert.equal(generated.meals[0].locked, false);
  assert.equal(generated.meals[1].recipeId, 'svarta-bon-tacos');
  assert.equal(supportsNeeds(RECIPES.find((recipe) => recipe.id === generated.meals[1].recipeId)!, [glutenFreePerson]), true);
});

test('v1-tillstånd utan de nya valfria fälten fortsätter vara giltiga', () => {
  assert.deepEqual(validateState(baseState()), baseState());
});

test('validerar generationSettings, pantryIngredientIds och fullständiga custom recipes', () => {
  const state = baseState();
  state.generationSettings = { vegetarianOnly: true, favoritesOnly: false, maxMinutes: 30 };
  state.pantryIngredientIds = ['roda-linser', 'krossade-tomater'];
  state.customRecipes = [customRecipe()];
  assert.deepEqual(validateState(state), state);
});

test('avvisar ogiltiga filter, skafferirader och custom recipe ids eller externa bilder', () => {
  const invalidSettings = { ...baseState(), generationSettings: { vegetarianOnly: 1, favoritesOnly: false, maxMinutes: null } };
  const invalidPantry = { ...baseState(), pantryIngredientIds: ['potatis', 4] };
  const invalidId = { ...baseState(), customRecipes: [customRecipe({ id: 'kottfarslasagne' })] };
  const remoteImage = { ...baseState(), customRecipes: [customRecipe({ image: 'https://example.com/food.png' })] };

  assert.throws(() => validateState(invalidSettings), /filter/i);
  assert.throws(() => validateState(invalidPantry), /skafferi/i);
  assert.throws(() => validateState(invalidId), /egna recept/i);
  assert.throws(() => validateState(remoteImage), /egna recept/i);
});

test('avvisar ogiltiga custom recipe quantities, enums, steps och naturligt glutenfritt med gluten', () => {
  const badQuantity = customRecipe({ ingredients: [{ ...RECIPES[0].ingredients[0], quantity: 0 }] });
  const badUnit = customRecipe({ ingredients: [{ ...RECIPES[0].ingredients[0], unit: 'cup' as Recipe['ingredients'][number]['unit'] }] });
  const badStep = customRecipe({ steps: [{ text: '' }] });
  const falselyNatural = customRecipe({ glutenStrategy: 'naturally-free', ingredients: RECIPES[0].ingredients });

  for (const candidate of [badQuantity, badUnit, badStep, falselyNatural]) {
    assert.throws(() => validateState({ ...baseState(), customRecipes: [candidate] }), /egna recept/i);
  }
});
