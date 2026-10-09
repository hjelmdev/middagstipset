import assert from 'node:assert/strict';
import test from 'node:test';
import { buildShoppingList, emptyPlan, generatePlan, portionCount, scaleIngredients, supportsNeeds } from '../src/app/domain/meal-engine.ts';
import { RECIPES } from '../src/app/data/recipes.ts';
import type { MealPlan, Person, PlannedMeal, Recipe, ShoppingItem } from '../src/app/domain/models.ts';

const recipe = (id: string) => {
  const found = RECIPES.find((item) => item.id === id);
  assert.ok(found, `Missing recipe: ${id}`);
  return found;
};

const pasta = recipe('kramig-tomatpasta-med-linser');
const lasagne = recipe('kottfarslasagne');

function person(id: string, dietaryNeeds: Person['dietaryNeeds'] = [], portionFactor = 1): Person {
  return { id, name: id, portionFactor, dietaryNeeds };
}

function meal(id: string, recipeId: string | null, patch: Partial<PlannedMeal> = {}): PlannedMeal {
  return {
    id, date: '2026-10-12', mealType: 'dinner', recipeId,
    participantIds: ['adult'], extraPortions: 0, maxMinutes: 60,
    locked: false, status: 'planned', ...patch,
  };
}

test('portioner räknar med barns portionsfaktor och extra portioner', () => {
  const people = [person('adult-1'), person('adult-2'), person('child', [], 0.5)];
  assert.equal(portionCount(people), 2.5);
  assert.equal(portionCount(people, 1), 3.5);
});

test('pasta delas mellan två vanliga portioner och en glutenfri portion', () => {
  const people = [person('adult-1'), person('adult-2'), person('glutenfri', ['gluten-free'])];
  assert.equal(supportsNeeds(pasta, people), true);
  const ingredients = scaleIngredients(pasta, people);
  assert.equal(ingredients.find((item) => item.id === 'pasta')?.quantity, 150);
  assert.equal(ingredients.find((item) => item.id === 'glutenfri-pasta')?.quantity, 75);
  assert.equal(ingredients.find((item) => item.id === 'roda-linser')?.quantity, 112.5);
});

test('glutenfri lasagne byter både plattor och mjöl i hela rätten', () => {
  const people = [person('a'), person('b'), person('glutenfri', ['gluten-free'])];
  assert.equal(supportsNeeds(lasagne, people), true);
  const ingredients = scaleIngredients(lasagne, people);
  assert.equal(ingredients.some((item) => item.allergens.includes('gluten')), false);
  assert.equal(ingredients.find((item) => item.id === 'glutenfria-lasagneplattor')?.quantity, 187.5);
  assert.equal(ingredients.find((item) => item.id === 'glutenfri-mjolmix')?.quantity, 22.5);
});

test('generering bevarar låsta och tillagade dagar', () => {
  const people = [person('adult')];
  const plan = emptyPlan('2026-10-12', people);
  const locked = meal(plan.meals[0].id, pasta.id, { locked: true });
  const cooked = meal(plan.meals[1].id, lasagne.id, { status: 'cooked', locked: false });
  plan.meals[0] = locked;
  plan.meals[1] = cooked;
  const generated = generatePlan(plan, RECIPES, people, [], [], () => 0.5);
  assert.deepEqual(generated.meals[0], locked);
  assert.deepEqual(generated.meals[1], cooked);
});

test('vegetarian krav och tidsgränser hålls hårt, även när inga recept passar', () => {
  const vegetarian = person('vegetarian', ['vegetarian']);
  const meatballs = recipe('svenska-kottbullar-med-potatismos');
  assert.equal(supportsNeeds(meatballs, [vegetarian]), false);

  const plan: MealPlan = { weekStart: '2026-10-12', meals: [
    meal('vegetarian-slot', null, { maxMinutes: 30, participantIds: [vegetarian.id] }),
    meal('too-short-slot', null, { maxMinutes: 1, participantIds: [vegetarian.id] }),
  ] };
  const generated = generatePlan(plan, RECIPES, [vegetarian], [], [], () => 0.5);
  const selected = RECIPES.find((item) => item.id === generated.meals[0].recipeId);
  assert.ok(selected);
  assert.equal(selected.mainIngredient === 'meat', false);
  assert.ok(selected.totalMinutes <= 30);
  assert.equal(generated.meals[1].recipeId, null);
});

test('inköpslistan summerar receptvaror och bevarar manuella rader', () => {
  const people = [person('adult-1'), person('adult-2')];
  const plan: MealPlan = { weekStart: '2026-10-12', meals: [
    meal('pasta-1', pasta.id, { participantIds: people.map((item) => item.id) }),
    meal('pasta-2', pasta.id, { participantIds: people.map((item) => item.id), date: '2026-10-13' }),
  ] };
  const manual: ShoppingItem = {
    id: 'manual:coffee', ingredientId: 'coffee', name: 'Kaffe', quantity: 1,
    unit: 'st', category: 'Skafferi', source: 'manual', checked: true,
  };
  const list = buildShoppingList(plan, RECIPES, people, [manual]);
  assert.equal(list.find((item) => item.ingredientId === 'pasta')?.quantity, 300);
  assert.deepEqual(list.find((item) => item.id === 'manual:coffee'), manual);
});

test('ändrad mängd avmarkerar en tidigare avbockad inköpsvara', () => {
  const people = [person('adult-1'), person('adult-2')];
  const base: MealPlan = { weekStart: '2026-10-12', meals: [
    meal('pasta-1', pasta.id, { participantIds: people.map((item) => item.id) }),
  ] };
  const original = buildShoppingList(base, RECIPES, people);
  const checked = original.map((item) => item.ingredientId === 'pasta' ? { ...item, checked: true } : item);
  const increased: MealPlan = { ...base, meals: [{ ...base.meals[0], extraPortions: 1 }] };
  const updated = buildShoppingList(increased, RECIPES, people, checked);
  const pastaItem = updated.find((item) => item.ingredientId === 'pasta');
  assert.equal(pastaItem?.quantity, 225);
  assert.equal(pastaItem?.checked, false);
});

test('gemensam sås anpassas för alla även när pastan delas', () => {
  const withSauce: Recipe = { ...pasta, ingredients: [...pasta.ingredients, {
    id: 'vetemjol', name: 'Vetemjöl', quantity: 40, unit: 'g', category: 'Skafferi',
    component: 'sås', allergens: ['gluten'], glutenFreeAlternative: { id: 'gf-mjol', name: 'Glutenfritt mjöl' },
  }] };
  const people = [person('a'), person('b'), person('c', ['gluten-free'])];
  const ingredients = scaleIngredients(withSauce, people);
  assert.equal(ingredients.find(i => i.id === 'gf-mjol')?.quantity, 30);
  assert.equal(ingredients.some(i => i.id === 'vetemjol'), false);
  assert.equal(ingredients.find(i => i.id === 'pasta')?.quantity, 150);
});

test('extra portioner följer glutenfri variant och inga deltagare ger inga ingredienser', () => {
  const ingredients = scaleIngredients(pasta, [person('a'), person('b', ['gluten-free'])], 2);
  assert.equal(ingredients.find(i => i.id === 'pasta')?.quantity, 75);
  assert.equal(ingredients.find(i => i.id === 'glutenfri-pasta')?.quantity, 225);
  assert.deepEqual(scaleIngredients(pasta, []), []);
});
