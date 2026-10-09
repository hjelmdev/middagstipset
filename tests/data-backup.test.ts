import assert from 'node:assert/strict';
import test from 'node:test';
import { backupOverview, createBackup, parseBackup } from '../src/app/domain/data-backup.ts';
import { RECIPES } from '../src/app/data/recipes.ts';
import type { AppState } from '../src/app/domain/models.ts';

const state: AppState = {
  version: 1,
  household: { id: 'home', name: 'Hemma', people: [{ id: 'p1', name: 'Ada', portionFactor: 1, dietaryNeeds: [], linkedUserId: 'auth-123' }] },
  plans: [], favoriteRecipeIds: [], shoppingItems: [], lunchPlans: [], customRecipes: [],
};

test('backup har manifest, rundtrippas och tar bort auth-kopplade användar-id:n', () => {
  const backup = createBackup(state, '2026-10-09T08:00:00.000Z');
  assert.equal(backup.format, 'middagstipset-backup');
  assert.equal(backup.version, 1);
  assert.equal(backup.state.household.people[0].linkedUserId, undefined);
  assert.equal(state.household.people[0].linkedUserId, 'auth-123');
  assert.deepEqual(parseBackup(JSON.stringify(backup)), backup.state);
});

test('backup-översikt räknar personer, måltider, egna recept och luncher', () => {
  const populated: AppState = {
    ...state,
    plans: [{ weekStart: '2026-10-05', meals: [{ id: 'm1', date: '2026-10-09', mealType: 'dinner', recipeId: null, participantIds: ['p1'], extraPortions: 0, maxMinutes: 30, locked: false, status: 'planned' }] }],
    lunchPlans: [{ id: 'l1', date: '2026-10-10', sourceMealId: 'm1', participantIds: ['p1'], portions: 1, status: 'planned' }],
    customRecipes: [{ id: 'custom:test', name: 'Test', description: '', servings: 1, totalMinutes: 1, activeMinutes: 1, mainIngredient: 'vegetables', tags: [], dietaryNeeds: [], glutenStrategy: 'unsupported', ingredients: [], steps: [], image: '', imageAlt: '', imageKind: 'illustration', color: '' }],
  };
  assert.deepEqual(backupOverview(populated), { people: 1, meals: 1, recipes: 1, lunches: 1 });
});

test('ogiltig JSON, version, manifest och AppState avvisas', () => {
  assert.throws(() => parseBackup('{'), /giltig JSON/);
  const valid = createBackup(state);
  assert.throws(() => parseBackup(JSON.stringify({ ...valid, version: 2 })), /format/);
  assert.throws(() => parseBackup(JSON.stringify({ ...valid, format: 'other' })), /format/);
  assert.throws(() => parseBackup(JSON.stringify({ ...valid, state: { ...valid.state, plans: 'fel' } })), /ogiltiga data/);
  assert.throws(() => parseBackup(JSON.stringify({ ...valid, state: { ...valid.state, apiKey: 'secret' } })), /okända data/);
});

test('backup-allowlisten accepterar nya valfria lagerfält', () => {
  const extendedState = {
    ...state,
    pantryStock: [{ ingredientId: 'tomato', name: 'Tomat', category: 'Grönt', quantity: 3, unit: 'st' }],
    deductPantryStock: true,
  };
  const restored = parseBackup(JSON.stringify(createBackup(extendedState)));
  assert.deepEqual((restored as AppState & { pantryStock?: unknown }).pantryStock, extendedState.pantryStock);
  assert.equal((restored as AppState & { deductPantryStock?: unknown }).deductPantryStock, true);
});

test('backup bevarar storkok och lunchreservationer kopplade till storkok', () => {
  const recipe = RECIPES[0];
  const batchId = 'batch:00000000-0000-4000-8000-000000000001';
  const batchState: AppState = {
    ...state,
    cookBatches: [{
      id: batchId,
      recipeId: recipe.id,
      date: '2026-10-09',
      portions: 4,
      needs: [],
      status: 'prepared',
      preparedAt: '2026-10-09T12:00:00.000Z',
      recipeSnapshot: recipe,
      pantryUsed: [{ ingredientId: 'tomato', name: 'Tomat', category: 'Grönt', quantity: 2, unit: 'st' }],
    }],
    lunchPlans: [{
      id: 'lunch-batch-1',
      date: '2026-10-10',
      sourceType: 'batch',
      sourceId: batchId,
      participantIds: ['p1'],
      portions: 1,
      status: 'eaten',
      eatenAt: '2026-10-10T12:00:00.000Z',
    }],
  };
  const restored = parseBackup(JSON.stringify(createBackup(batchState)));
  assert.deepEqual(restored.cookBatches, batchState.cookBatches);
  assert.deepEqual(restored.lunchPlans, batchState.lunchPlans);
});
