import test from 'node:test';
import assert from 'node:assert/strict';
import { mealHistory } from '../src/app/domain/history.ts';
import { planningWindow } from '../src/app/domain/rolling-plan.ts';
import { RECIPES } from '../src/app/data/recipes.ts';
import { validateState } from '../src/app/core/state.repository.ts';
import type { AppState, Person, Recipe } from '../src/app/domain/models.ts';

const people: Person[] = [{ id: 'person', name: 'Jag', portionFactor: 1, dietaryNeeds: [] }];
const base = planningWindow([], '2026-10-08', 1, people).meals[0];

test('passerad plan behåller planerad status; dagens och framtida olagade planer blir inte historik', () => {
  const meals = ['2026-10-07', '2026-10-08', '2026-10-09'].map(date => ({ ...base, date, id: date, recipeId: RECIPES[0].id }));
  const history = mealHistory(meals, RECIPES, people, '2026-10-08');
  assert.equal(history.length, 1);
  assert.equal(history[0].meal.status, 'planned');
  assert.equal(history[0].date, '2026-10-07');
});

test('tillagning visar verkligt tillagningsdatum samt sparat receptnamn och portionsantal', () => {
  const meal = { ...base, date: '2026-10-10', recipeId: RECIPES[0].id, status: 'cooked' as const,
    cookedAt: new Date(2026, 9, 8, 18, 0).toISOString(),
    cookedSnapshot: { recipeName: 'Namnet när rätten lagades', image: 'old.jpg', imageAlt: 'Mat', portions: 2.5 } };
  const history = mealHistory([meal], RECIPES, [{ ...people[0], portionFactor: 4 }], '2026-10-08');
  assert.equal(history[0].date, '2026-10-08');
  assert.equal(history[0].name, 'Namnet när rätten lagades');
  assert.equal(history[0].portions, 2.5);
  assert.equal(history[0].image, 'old.jpg');
});

test('äldre lagad middag utan snapshot eller tillgängligt recept finns kvar i historiken', () => {
  const meal = { ...base, date: '2026-10-02', recipeId: 'removed', status: 'cooked' as const };
  const history = mealHistory([meal], [], people, '2026-10-08');
  assert.equal(history[0].date, meal.date);
  assert.equal(history[0].name, 'Tidigare recept');
  assert.equal(history[0].recipe, undefined);
});

test('historiken visar fryst recept och originalportioner efter att recept och deltagare ändrats', () => {
  const savedRecipe: Recipe = { ...RECIPES[0], name: 'Receptnamnet när middagen lagades' };
  const meal = { ...base, date: '2026-10-02', recipeId: savedRecipe.id, status: 'cooked' as const,
    cookedSnapshot: { recipeName: savedRecipe.name, image: savedRecipe.image, imageAlt: savedRecipe.imageAlt,
      portions: 2.5, recipe: savedRecipe, people: [{ ...people[0], portionFactor: 1 }], extraPortions: 0 } };
  const editedRecipe = { ...savedRecipe, name: 'Nytt receptnamn', servings: 8 };
  const history = mealHistory([meal], [editedRecipe], [{ ...people[0], portionFactor: 3 }], '2026-10-08');

  assert.equal(history[0].recipe?.name, 'Receptnamnet när middagen lagades');
  assert.equal(history[0].portions, 2.5);
  assert.equal(history[0].recipe?.servings, savedRecipe.servings);
});

function stateWithSnapshot(recipe: Recipe): AppState {
  const cooked = { ...base, date: '2026-10-02', recipeId: recipe.id, status: 'cooked' as const,
    cookedSnapshot: { recipeName: recipe.name, image: recipe.image, imageAlt: recipe.imageAlt, portions: 1,
      recipe, people: [{ ...people[0] }], extraPortions: 0 } };
  return {
    version: 1,
    household: { id: 'home', name: 'Hemma', people: [...people] },
    plans: [{ weekStart: '2026-09-28', meals: [cooked] }], favoriteRecipeIds: [], shoppingItems: [],
  };
}

test('snapshotrecept i historiken accepterar både startrecept och egna recept', () => {
  const builtIn = RECIPES[0];
  const custom = { ...builtIn, id: 'custom:saved-recipe', image: 'images/custom-recipe.svg' };
  assert.doesNotThrow(() => validateState(stateWithSnapshot(builtIn)));
  assert.doesNotThrow(() => validateState(stateWithSnapshot(custom)));
});

test('avvisar ogiltigt fryst recept, deltagare eller portionsdata i historiken', () => {
  const recipe = RECIPES[0];
  const invalidSnapshots = [
    { ...stateWithSnapshot(recipe), plans: [{ weekStart: '2026-09-28', meals: [{ ...stateWithSnapshot(recipe).plans[0].meals[0], cookedSnapshot: { ...stateWithSnapshot(recipe).plans[0].meals[0].cookedSnapshot!, recipe: { ...recipe, image: 'https://example.com/meal.png' } } }] }] },
    { ...stateWithSnapshot(recipe), plans: [{ weekStart: '2026-09-28', meals: [{ ...stateWithSnapshot(recipe).plans[0].meals[0], cookedSnapshot: { ...stateWithSnapshot(recipe).plans[0].meals[0].cookedSnapshot!, people: [{ ...people[0], portionFactor: 0 }] } }] }] },
    { ...stateWithSnapshot(recipe), plans: [{ weekStart: '2026-09-28', meals: [{ ...stateWithSnapshot(recipe).plans[0].meals[0], cookedSnapshot: { ...stateWithSnapshot(recipe).plans[0].meals[0].cookedSnapshot!, extraPortions: 13 } }] }] },
  ];
  for (const state of invalidSnapshots) assert.throws(() => validateState(state), /middagshistorik/i);
});
