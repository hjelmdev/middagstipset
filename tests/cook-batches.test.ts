import assert from 'node:assert/strict';
import test from 'node:test';
import { validateState } from '../src/app/core/state.repository.ts';
import { allocatePantryStock, restorePantryStock } from '../src/app/domain/pantry-stock.ts';
import { buildLunchSources, lunchSourceId, lunchSourceType, reservedPortions } from '../src/app/domain/leftovers.ts';
import { batchLunchCompatibilityError, cookBatchAvailableDate, cookBatchEatenError, cookBatchIngredients, cookBatchPreparationError, cookBatchPrepareReservationError, cookBatchRemovalError, cookBatchShoppingItems, cookBatchUndoError, createCookBatchRecord, plannedCookBatchShopping } from '../src/app/domain/cook-batches.ts';
import { RECIPES } from '../src/app/data/recipes.ts';
import type { AppState, CookBatch, LunchPlan, PantryStockItem, Person } from '../src/app/domain/models.ts';

const pasta = RECIPES.find(recipe => recipe.id === 'kramig-tomatpasta-med-linser')!;
const adult: Person = { id: 'adult', name: 'Vuxen', portionFactor: 1, dietaryNeeds: [] };
const vegetarian: Person = { id: 'veg', name: 'Vegetarian', portionFactor: 1, dietaryNeeds: ['vegetarian'] };
const gfVeg: Person = { id: 'gfveg', name: 'Glutenfri vegetarian', portionFactor: 1, dietaryNeeds: ['vegetarian', 'gluten-free'] };

function batch(patch: Partial<CookBatch> = {}): CookBatch {
  return { ...createCookBatchRecord(pasta, 'batch:00000000-0000-4000-8000-000000000001', '2026-10-10', 5, ['vegetarian', 'gluten-free']), ...patch };
}

function lunch(patch: Partial<LunchPlan> = {}): LunchPlan {
  return { id: 'lunch-1', date: '2026-10-12', sourceType: 'batch', sourceId: 'batch:00000000-0000-4000-8000-000000000001', participantIds: ['gfveg'], portions: 1, status: 'planned', ...patch };
}

function stock(ingredientId: string, quantity: number): PantryStockItem {
  return { ingredientId, name: ingredientId, category: 'Skafferi', quantity, unit: 'g' };
}

test('en femportionsbatch fryser receptet och producerar full GF-variant för luncher', () => {
  const prepared = batch();
  const changedCurrentRecipe = { ...pasta, name: 'Ändrat recept senare' };
  assert.equal(prepared.recipeSnapshot.name, pasta.name);
  assert.equal(changedCurrentRecipe.name, 'Ändrat recept senare');
  assert.equal(cookBatchIngredients(prepared).find(ingredient => ingredient.id === 'glutenfri-pasta')?.quantity, 375);
  assert.ok(!cookBatchIngredients(prepared).some(ingredient => ingredient.id === 'pasta'));
  assert.equal(cookBatchPreparationError(pasta, ['vegetarian', 'gluten-free']), '');

  const lunches = Array.from({ length: 5 }, (_, index) => lunch({ id: `lunch-${index}`, date: '2026-10-12', portions: 1 }));
  assert.equal(reservedPortions(lunches, prepared.id, 'batch'), 5);
  assert.equal(buildLunchSources([], [pasta], [adult, vegetarian, gfVeg], lunches, [prepared])[0].availablePortions, 0);
});

test('batchkost kräver vegetarisk rätt och GF-kost eller ett verifierat naturligt fritt recept', () => {
  const meat = RECIPES.find(recipe => recipe.id === 'kottfarslasagne')!;
  assert.match(cookBatchPreparationError(meat, ['vegetarian']), /vegetariskt recept/i);
  const vegetarianBatch = batch({ needs: ['vegetarian'] });
  assert.match(batchLunchCompatibilityError(vegetarianBatch, [gfVeg]), /inte bekräftat tillagad glutenfri/i);
  const gfBatch = batch();
  assert.equal(batchLunchCompatibilityError(gfBatch, [gfVeg]), '');
  assert.equal(cookBatchEatenError({ ...gfBatch, status: 'prepared', preparedAt: '2026-10-10T18:00:00.000Z' }, [gfVeg]), '');
  assert.match(cookBatchEatenError(gfBatch, [gfVeg]), /innan du markerar/i);
});

test('inköpslistan tar med batchen en gång vid tillagningsdatum eller reserverad lunch och aldrig efter tillagning', () => {
  const source = batch();
  const inRangeLunch = lunch({ date: '2026-10-12' });
  assert.deepEqual(plannedCookBatchShopping([source], [inRangeLunch], '2026-10-12', 7, '2026-10-12'), [source]);
  assert.deepEqual(plannedCookBatchShopping([source], [], '2026-10-10', 7, '2026-10-10'), [source]);
  const prepared = { ...source, status: 'prepared' as const, preparedAt: '2026-10-10T18:00:00.000Z' };
  assert.deepEqual(plannedCookBatchShopping([prepared], [inRangeLunch], '2026-10-12', 7, '2026-10-12'), []);
  const rows = cookBatchShoppingItems([source, source], '2026-10-09');
  assert.equal(rows.find(item => item.ingredientId === 'glutenfri-pasta')?.quantity, 375);
  assert.equal(rows.filter(item => item.ingredientId === 'glutenfri-pasta').length, 1);
});

test('tillagad batch förbrukar stock via ledger och undo återför exakt samma mängd', () => {
  const source = batch();
  const requirements = cookBatchIngredients(source);
  const initial = [stock('glutenfri-pasta', 400)];
  const cooked = allocatePantryStock(initial, requirements);
  assert.equal(cooked.used[0].quantity, 375);
  assert.equal(cooked.stock[0].quantity, 25);
  const undone = restorePantryStock(cooked.stock, cooked.used);
  assert.equal(undone[0].quantity, 400);
  const cookedAgain = allocatePantryStock(undone, requirements);
  assert.equal(cookedAgain.stock[0].quantity, 25);
});

test('batch får inte tas bort med reserverade luncher eller ångras efter uppäten portion', () => {
  const planned = batch();
  const plannedLunch = lunch();
  assert.match(cookBatchRemovalError(planned, [plannedLunch]), /ta bort storkokets lunchplaner/i);
  assert.equal(cookBatchRemovalError(planned, []), '');
  const prepared = { ...planned, status: 'prepared' as const, preparedAt: '2026-10-10T18:00:00.000Z' };
  assert.match(cookBatchUndoError(prepared, [{ ...plannedLunch, status: 'eaten', eatenAt: '2026-10-12T12:00:00.000Z' }]), /redan är markerad som uppäten/i);
  assert.equal(cookBatchUndoError(prepared, [plannedLunch]), '');
  const futurePlanned = batch({ date: '2026-10-14' });
  assert.equal(cookBatchPrepareReservationError(futurePlanned, [lunch({ date: '2026-10-12' })], '2026-10-12'), '');
  assert.match(cookBatchUndoError({ ...futurePlanned, status: 'prepared', preparedAt: '2026-10-12T12:00:00.000Z' }, [lunch({ date: '2026-10-12' })]), /före batchens planerade/i);
  assert.match(cookBatchPrepareReservationError(futurePlanned, [lunch({ date: '2026-10-11' })], '2026-10-12'), /passerat datum/i);
});

test('datum är riktiga kalenderdatum och prepared lunchkälla använder faktisk tillagningsdag', () => {
  assert.throws(() => createCookBatchRecord(pasta, 'batch:00000000-0000-4000-8000-000000000001', '2026-02-30', 5, []), /giltigt tillagningsdatum/i);
  const prepared = { ...batch({ date: '2026-10-14' }), status: 'prepared' as const, preparedAt: '2026-10-12T12:00:00.000Z' };
  assert.equal(cookBatchAvailableDate(prepared), '2026-10-12');
  assert.equal(buildLunchSources([], [pasta], [adult], [], [prepared])[0].date, '2026-10-12');
  assert.equal(lunchSourceType(lunch()), 'batch');
  assert.equal(lunchSourceId(lunch()), prepared.id);
});

test('statevalidering tillåter legacy lunchkälla och giltig batch men avvisar kapacitetsbrott och eaten utan prepared', () => {
  const people = [adult, vegetarian, gfVeg];
  const base: AppState = { version: 1, household: { id: 'home', name: 'Hemma', people }, plans: [], favoriteRecipeIds: [], shoppingItems: [] };
  const prepared = { ...batch(), status: 'prepared' as const, preparedAt: '2026-10-10T18:00:00.000Z', pantryUsed: [stock('glutenfri-pasta', 100)] };
  const valid = { ...base, cookBatches: [prepared], lunchPlans: [lunch({ status: 'eaten', eatenAt: '2026-10-12T12:00:00.000Z' })] };
  assert.doesNotThrow(() => validateState(valid));
  const earlyPrepared = { ...batch({ date: '2026-10-14' }), status: 'prepared' as const, preparedAt: '2026-10-12T11:00:00.000Z' };
  assert.doesNotThrow(() => validateState({ ...base, cookBatches: [earlyPrepared],
    lunchPlans: [lunch({ date: '2026-10-12', status: 'eaten', eatenAt: '2026-10-12T12:00:00.000Z' })] }));
  assert.throws(() => validateState({ ...base, cookBatches: [batch()], lunchPlans: [lunch({ status: 'eaten', eatenAt: '2026-10-12T12:00:00.000Z' })] }), /tillagat storkok/i);
  assert.throws(() => validateState({ ...base, cookBatches: [prepared], lunchPlans: Array.from({ length: 6 }, (_, index) => lunch({ id: `l${index}`, portions: 1 })) }), /överskrider/i);
  assert.throws(() => validateState({ ...base, cookBatches: [prepared], lunchPlans: [lunch({ status: 'eaten', eatenAt: '2026-10-10T17:00:00.000Z' })] }), /före tillagningen/i);
  assert.throws(() => validateState({ ...base, cookBatches: [prepared], lunchPlans: [lunch({ sourceId: 'batch:missing-0000-4000-8000-000000000001' })] }), /lunchkälla/i);
  const duplicateSourceMeal = { id: prepared.id, date: '2026-10-09', mealType: 'dinner' as const, recipeId: null, participantIds: ['adult'], extraPortions: 0, maxMinutes: 35, locked: false, status: 'planned' as const };
  assert.throws(() => validateState({ ...base, plans: [{ weekStart: '2026-10-05', meals: [duplicateSourceMeal] }], cookBatches: [prepared] }), /unika käll-id/i);
  const legacy: LunchPlan = { id: 'legacy', date: '2026-10-12', sourceMealId: 'legacy-dinner', participantIds: ['adult'], portions: 1, status: 'planned' };
  assert.equal(lunchSourceType(legacy), 'meal');
  assert.equal(lunchSourceId(legacy), 'legacy-dinner');
  const dinner = { id: 'meal-dinner', date: '2026-10-10', mealType: 'dinner' as const, recipeId: pasta.id, participantIds: ['gfveg'], extraPortions: 2, maxMinutes: 35, locked: false, status: 'planned' as const };
  assert.doesNotThrow(() => validateState({ ...base, plans: [{ weekStart: '2026-10-05', meals: [dinner] }],
    lunchPlans: [{ id: 'meal-lunch', date: '2026-10-12', sourceType: 'meal', sourceId: dinner.id, participantIds: ['gfveg'], portions: 1, status: 'planned' }] }));
});
