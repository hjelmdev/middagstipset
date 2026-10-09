import assert from 'node:assert/strict';
import test from 'node:test';
import { allocatePantryStock, applyPantryStock, restorePantryStock } from '../src/app/domain/pantry-stock.ts';
import { pantryRecipeMatches } from '../src/app/domain/pantry.ts';
import { validateState } from '../src/app/core/state.repository.ts';
import { RECIPES } from '../src/app/data/recipes.ts';
import type { Ingredient, PantryStockItem, Person, ShoppingItem } from '../src/app/domain/models.ts';

const adult: Person = { id: 'adult', name: 'Vuxen', portionFactor: 1, dietaryNeeds: [] };
const stockItem = (ingredientId: string, quantity: number, unit: Ingredient['unit'] = 'g'): PantryStockItem =>
  ({ ingredientId, name: ingredientId, category: 'Skafferi', quantity, unit });
const ingredient = (id: string, quantity: number, unit: Ingredient['unit'] = 'g'): Ingredient =>
  ({ id, name: id, quantity, unit, category: 'Skafferi', component: 'main', allergens: [] });
const shopping = (id: string, quantity: number, source: 'recipe' | 'manual' = 'recipe'): ShoppingItem =>
  ({ id, ingredientId: id, name: id, quantity, unit: 'g', category: 'Skafferi', source, checked: false });

test('inventory is allocated once across recipe requirements and never crosses dimensions', () => {
  const result = allocatePantryStock([stockItem('flour', 100)], [ingredient('flour', 80), ingredient('flour', 60), ingredient('oil', 25, 'ml')]);
  assert.deepEqual(result.remaining.map(item => item.quantity), [40, 25]);
  assert.equal(result.used[0].quantity, 100);
  assert.deepEqual(result.stock, []);
});

test('ml, tablespoons and teaspoons convert exactly while grams and millilitres do not', () => {
  const result = allocatePantryStock([stockItem('oil', 1, 'msk')], [ingredient('oil', 10, 'ml')]);
  assert.equal(result.remaining.length, 0);
  assert.equal(result.used[0].quantity, 2 / 3);
  const incompatible = allocatePantryStock([stockItem('milk', 100, 'g')], [ingredient('milk', 50, 'ml')]);
  assert.equal(incompatible.remaining[0].quantity, 50);
  assert.equal(incompatible.used.length, 0);
});

test('net shopping keeps manual lines and preserves checked only when net amount is unchanged', () => {
  const previous = [{ ...shopping('rice', 200), checked: true }, { ...shopping('manual:tea', 1, 'manual'), checked: true }];
  const unchanged = applyPantryStock([shopping('rice', 200), shopping('manual:tea', 1, 'manual')], [stockItem('rice', 100)], true, previous);
  assert.equal(unchanged.find(item => item.id === 'rice')?.quantity, 100);
  assert.equal(unchanged.find(item => item.id === 'rice')?.checked, false);
  assert.equal(unchanged.find(item => item.id === 'manual:tea')?.checked, true);
  const stable = applyPantryStock([shopping('rice', 200), shopping('manual:tea', 1, 'manual')], [stockItem('rice', 100)], true,
    [{ ...shopping('rice', 100), checked: true }, { ...shopping('manual:tea', 1, 'manual'), checked: true }]);
  assert.equal(stable.find(item => item.id === 'rice')?.checked, true);
});

test('recipe matching distinguishes quantity shortfall, legacy unknown amount and incompatible unit', () => {
  const recipe = RECIPES.find(candidate => candidate.id === 'citronlax-med-potatis')!;
  const lemon = recipe.ingredients.find(item => item.id === 'citron')!;
  const enough = pantryRecipeMatches([recipe], [adult], [], 20, [stockItem('citron', 4, lemon.unit)])[0];
  assert.ok(!enough.missing.some(item => item.id === 'citron'));
  const short = pantryRecipeMatches([recipe], [adult], [], 20, [stockItem('citron', 0.1, lemon.unit)])[0];
  assert.ok(short.missingAmounts.some(item => item.id === 'citron' && item.quantity > 0));
  const unknown = pantryRecipeMatches([recipe], [adult], ['citron'], 20)[0];
  assert.ok(unknown.unknownAmount.some(item => item.id === 'citron'));
  const wrongUnit: Ingredient['unit'] = lemon.unit === 'ml' ? 'g' : 'ml';
  const incompatible = pantryRecipeMatches([recipe], [adult], ['citron'], 20, [stockItem('citron', 10, wrongUnit)])[0];
  assert.ok(incompatible.incompatibleUnit.some(item => item.id === 'citron'));
  assert.ok(!incompatible.unknownAmount.some(item => item.id === 'citron'));
});

test('cooked pantry ledger deducts once, restores once, and legacy cooked snapshots need no ledger', () => {
  const start = [stockItem('flour', 500)];
  const firstCook = allocatePantryStock(start, [ingredient('flour', 200)]);
  assert.equal(firstCook.stock[0].quantity, 300);
  assert.equal(firstCook.used[0].quantity, 200);
  const undo = restorePantryStock(firstCook.stock, firstCook.used);
  assert.equal(undo[0].quantity, 500);
  const cookedAgain = allocatePantryStock(undo, [ingredient('flour', 200)]);
  assert.equal(cookedAgain.stock[0].quantity, 300);

  const legacy = { version: 1 as const, household: { id: 'h', name: 'Hemma', people: [adult] }, plans: [], favoriteRecipeIds: [], shoppingItems: [] };
  const meal = { id: 'd', date: '2026-10-09', mealType: 'dinner' as const, recipeId: null, participantIds: ['adult'], extraPortions: 0, maxMinutes: 35, locked: false, status: 'cooked' as const,
    cookedSnapshot: { recipeName: 'Äldre', image: 'images/x.svg', imageAlt: 'Rätt', portions: 1 } };
  assert.doesNotThrow(() => validateState({ ...legacy, plans: [{ weekStart: '2026-10-05', meals: [meal] }] }));
  assert.throws(() => validateState({ ...legacy, plans: [{ weekStart: '2026-10-05', meals: [{ ...meal,
    cookedSnapshot: { ...meal.cookedSnapshot, pantryUsed: [{ ...stockItem('flour', 0), quantity: 0 }] } }] }] }), /middagshistorik/i);
});

test('state validation accepts complete stock and rejects malformed backup shopping rows and stock quantities', () => {
  const valid = { version: 1 as const, household: { id: 'home', name: 'Hemma', people: [adult] }, plans: [], favoriteRecipeIds: [], shoppingItems: [],
    pantryStock: [stockItem('tomato', 3, 'st')], deductPantryStock: true };
  assert.equal(validateState(valid), valid);
  assert.throws(() => validateState({ ...valid, shoppingItems: [null] }), /format som appen inte kan läsa/i);
  assert.throws(() => validateState({ ...valid, favoriteRecipeIds: [null] }), /format som appen inte kan läsa/i);
  assert.throws(() => validateState({ ...valid, pantryStock: [{ ...stockItem('rice', 2), quantity: 0 }] }), /mängder i skafferiet/i);
  const meal = { id: 'd', date: '2026-10-09', mealType: 'dinner' as const, recipeId: null, participantIds: [null], extraPortions: 0, maxMinutes: 35, locked: false, status: 'planned' as const };
  assert.throws(() => validateState({ ...valid, plans: [{ weekStart: '2026-10-05', meals: [meal] }] }), /måltid/i);
});
