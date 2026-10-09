import assert from 'node:assert/strict';
import test from 'node:test';
import { validateState } from '../src/app/core/state.repository.ts';
import { buildShoppingList } from '../src/app/domain/meal-engine.ts';
import { buildLunchSources, isCalendarDate, lunchCompatibilityError, lunchEatenError, lunchSourcePeople, lunchSourceRecipe, portionNeed, plannedLunchShoppingMeals, reservedPortions, sourceExtraPortions, sourceReservationMutationError } from '../src/app/domain/leftovers.ts';
import { RECIPES } from '../src/app/data/recipes.ts';
import type { AppState, LunchPlan, Person, PlannedMeal, Recipe } from '../src/app/domain/models.ts';

const adult: Person = { id: 'adult', name: 'Vuxen', portionFactor: 0.75, dietaryNeeds: [] };
const child: Person = { id: 'child', name: 'Barn', portionFactor: 0.5, dietaryNeeds: [] };
const glutenFree: Person = { id: 'gf', name: 'Glutenfritt', portionFactor: 1, dietaryNeeds: ['gluten-free'] };

function sourceMeal(patch: Partial<PlannedMeal> = {}): PlannedMeal {
  return {
    id: 'source-dinner', date: '2026-10-08', mealType: 'dinner', recipeId: 'kramig-tomatpasta-med-linser',
    participantIds: ['gf'], extraPortions: 2, maxMinutes: 35, locked: false, status: 'planned', ...patch,
  };
}

function lunch(patch: Partial<LunchPlan> = {}): LunchPlan {
  return { id: 'lunch-one', date: '2026-10-10', sourceMealId: 'source-dinner', participantIds: ['adult'], portions: 0.75, status: 'planned', ...patch };
}

function baseState(): AppState {
  return { version: 1, household: { id: 'home', name: 'Hemma', people: [adult, child, glutenFree] },
    plans: [{ weekStart: '2026-10-05', meals: [sourceMeal()] }], favoriteRecipeIds: [], shoppingItems: [] };
}

test('portionbehov använder frysta portionsfaktorer och kapacitet räknar även uppätna reservationer', () => {
  assert.equal(portionNeed(['adult', 'child'], [adult, child]), 1.25);
  const reservations = [lunch({ portions: 1.25 }), lunch({ id: 'lunch-two', status: 'eaten', portions: 0.5 })];
  assert.equal(reservedPortions(reservations, 'source-dinner'), 1.75);
  assert.equal(sourceExtraPortions(sourceMeal()), 2);
  assert.equal(buildLunchSources([sourceMeal()], RECIPES, [adult, child, glutenFree], reservations)[0].availablePortions, 0.25);
});

test('en lunchreservation behåller sin sparade portionsmängd när personens faktor senare ändras', () => {
  const reservation = lunch({ participantIds: ['adult'], portions: portionNeed(['adult'], [adult]) });
  const updatedPerson = { ...adult, portionFactor: 2 };
  assert.equal(portionNeed(['adult'], [updatedPerson]), 2);
  assert.equal(reservation.portions, 0.75);
});

test('källändringar får varken underskrida reserverad kapacitet eller ångra redan uppäten lunch', () => {
  const source = sourceMeal();
  const active = [lunch({ portions: 1.25 })];
  const lessCapacity = { ...source, extraPortions: 1 };
  assert.match(sourceReservationMutationError(source, lessCapacity, active, RECIPES[0], [glutenFree], [adult, child, glutenFree]), /portioner som redan reserverats/i);
  const cooked = { ...source, status: 'cooked' as const, cookedSnapshot: {
    recipeName: RECIPES[0].name, image: RECIPES[0].image, imageAlt: RECIPES[0].imageAlt, portions: 3,
    recipe: RECIPES[0], people: [glutenFree], extraPortions: 2,
  } };
  const eaten = [lunch({ status: 'eaten' })];
  assert.match(sourceReservationMutationError(cooked, { ...source, status: 'planned' }, eaten, RECIPES[0], [glutenFree], [adult]), /markerad som uppäten/i);
});

test('källrecept eller deltagare får inte göra en aktiv lunch kostmässigt olämplig', () => {
  const meat = RECIPES.find(recipe => recipe.id === 'kottfarslasagne')!;
  const source = sourceMeal({ recipeId: meat.id, participantIds: ['adult'] });
  const reservation = [lunch({ participantIds: ['vegetarian'] })];
  const vegetarianPerson: Person = { id: 'vegetarian', name: 'Vegetarian', portionFactor: 1, dietaryNeeds: ['vegetarian'] };
  assert.match(sourceReservationMutationError(source, { ...source, extraPortions: 3 }, reservation, meat, [adult], [adult, vegetarianPerson]), /inte vegetarisk/i);
  const changedPerson = { ...adult, dietaryNeeds: ['vegetarian'] as const };
  assert.match(lunchCompatibilityError(meat, [adult], [changedPerson as Person]), /inte vegetarisk/i);
});

test('lagad källa fryser recept, deltagare och extrakapacitet för lunch', () => {
  const frozenRecipe = { ...RECIPES[0], name: 'Receptnamn när det lagades' };
  const cooked = sourceMeal({ status: 'cooked', extraPortions: 0, cookedSnapshot: {
    recipeName: frozenRecipe.name, image: frozenRecipe.image, imageAlt: frozenRecipe.imageAlt, portions: 3,
    recipe: frozenRecipe, people: [{ ...glutenFree, portionFactor: 1 }], extraPortions: 2,
  } });
  const source = buildLunchSources([cooked], [{ ...RECIPES[0], name: 'Ändrat receptnamn' }], [{ ...glutenFree, portionFactor: 3 }], [lunch()])[0];

  assert.equal(source.recipe.name, 'Receptnamn när det lagades');
  assert.equal(source.people[0].portionFactor, 1);
  assert.equal(sourceExtraPortions(cooked), 2);
  assert.equal(lunchSourceRecipe(cooked, [{ ...RECIPES[0], name: 'Ändrat receptnamn' }])?.name, frozenRecipe.name);
  assert.equal(lunchSourcePeople(cooked, [] )[0].id, 'gf');
});

test('glutenfri split-komponentlunch kräver en källa som faktiskt planerats glutenfri', () => {
  const pasta = RECIPES.find(recipe => recipe.id === 'kramig-tomatpasta-med-linser')!;
  assert.equal(lunchCompatibilityError(pasta, [glutenFree], [glutenFree]), '');
  assert.match(lunchCompatibilityError(pasta, [adult], [glutenFree]), /inte bekräftat tillagad glutenfri/i);
  const falselyNatural: Recipe = { ...pasta, glutenStrategy: 'naturally-free' };
  assert.match(lunchCompatibilityError(falselyNatural, [adult], [glutenFree]), /inte bekräftat tillagad glutenfri/i);
});

test('markering som uppäten kontrollerar aktuell kost mot fryst källa och deltagare', () => {
  const pasta = RECIPES.find(recipe => recipe.id === 'kramig-tomatpasta-med-linser')!;
  const cooked = sourceMeal({ recipeId: pasta.id, status: 'cooked', cookedSnapshot: {
    recipeName: pasta.name, image: pasta.image, imageAlt: pasta.imageAlt, portions: 3,
    recipe: pasta, people: [{ ...glutenFree }], extraPortions: 2,
  } });
  assert.equal(lunchEatenError(cooked, pasta, lunchSourcePeople(cooked, []), [glutenFree]), '');
  assert.equal(lunchEatenError(cooked, pasta, [adult], [glutenFree]), '');
  const legacyCooked = sourceMeal({ status: 'cooked' });
  assert.match(lunchEatenError(legacyCooked, pasta, [glutenFree], [glutenFree]), /inte bekräftat tillagad glutenfri/i);
  assert.match(lunchEatenError(sourceMeal(), pasta, [glutenFree], [glutenFree]), /markera middagen som lagad/i);
});

test('datumvalidering avvisar formatriktiga men omöjliga kalenderdatum', () => {
  assert.equal(isCalendarDate('2028-02-29'), true);
  assert.equal(isCalendarDate('2026-02-29'), false);
  assert.equal(isCalendarDate('2026-10-99'), false);
  assert.equal(isCalendarDate('2026-2-09'), false);
});

test('inköpslistan tar med en hel okokt källa utanför intervallet en gång och behåller GF-varianten', () => {
  const source = sourceMeal({ participantIds: ['gf'], extraPortions: 2 });
  const lunches = [lunch(), lunch({ id: 'lunch-two', date: '2026-10-11', portions: 0.5 }),
    lunch({ id: 'lunch-eaten', status: 'eaten', portions: 0.5 })];
  const shoppingSources = plannedLunchShoppingMeals(lunches, [source], '2026-10-09', 7, '2026-10-09');

  assert.deepEqual(shoppingSources, [source]);
  const items = buildShoppingList({ weekStart: '2026-10-09', meals: shoppingSources }, RECIPES, [glutenFree]);
  assert.equal(items.filter(item => item.ingredientId === 'glutenfri-pasta').length, 1);
  assert.equal(items.find(item => item.ingredientId === 'glutenfri-pasta')?.quantity, 225);
});

test('källor inne i middagsintervallet och redan lagade källor dubbelräknas inte', () => {
  const inRange = sourceMeal({ date: '2026-10-10' });
  const cooked = sourceMeal({ id: 'cooked-source', status: 'cooked', date: '2026-10-08' });
  const planned = plannedLunchShoppingMeals([
    lunch({ sourceMealId: inRange.id }),
    lunch({ id: 'cooked-lunch', sourceMealId: cooked.id }),
  ], [inRange, cooked], '2026-10-09', 7, '2026-10-09');
  assert.deepEqual(planned, []);
  const lastDay = sourceMeal({ date: '2026-10-15' });
  assert.deepEqual(plannedLunchShoppingMeals([lunch({ date: '2026-10-15', sourceMealId: lastDay.id })], [lastDay], '2026-10-09', 7, '2026-10-09'), []);
});

test('v1-state utan lunchPlans är giltigt och nya lunchreservationer valideras mot källa och kapacitet', () => {
  const legacy = baseState();
  assert.deepEqual(validateState(legacy), legacy);
  const withLunch = { ...legacy, lunchPlans: [lunch()] };
  assert.deepEqual(validateState(withLunch), withLunch);
  assert.throws(() => validateState({ ...legacy, lunchPlans: [lunch({ portions: 2.5 })] }), /extra portioner/i);
  assert.throws(() => validateState({ ...legacy, lunchPlans: [lunch({ sourceMealId: 'missing' })] }), /lunchkälla/i);
  assert.throws(() => validateState({ ...legacy, lunchPlans: [lunch({ participantIds: ['unknown'] })] }), /lunchplaner/i);
  assert.throws(() => validateState({ ...legacy, lunchPlans: [lunch({ date: '2026-10-07' })] }), /lunchkälla/i);
  assert.throws(() => validateState({ ...legacy, lunchPlans: [lunch({ date: '2026-02-30' })] }), /lunchplaner/i);
  const eaten = lunch({ status: 'eaten', eatenAt: '2026-10-10T12:00:00.000Z' });
  const cookedSource = { ...sourceMeal(), status: 'cooked' as const };
  const cookedState = { ...legacy, plans: [{ weekStart: '2026-10-05', meals: [cookedSource] }], lunchPlans: [eaten] };
  assert.doesNotThrow(() => validateState(cookedState));
  assert.throws(() => validateState({ ...legacy, lunchPlans: [eaten] }), /lagad middagskälla/i);
  assert.throws(() => validateState({ ...cookedState, lunchPlans: [lunch({ status: 'eaten' })] }), /lunchplaner/i);
});
