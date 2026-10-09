import assert from 'node:assert/strict';
import test from 'node:test';
import { RECIPES } from '../src/app/data/recipes.ts';
import { buildIngredientCatalog, findIngredient, normalizeIngredientName, searchIngredients } from '../src/app/domain/ingredient-catalog.ts';

const catalog = buildIngredientCatalog(RECIPES);

test('katalogen härleds från recepten och deduplicerar samma ingrediens', () => {
  const potatoes = catalog.filter((ingredient) => ingredient.id === 'potatis');
  assert.equal(potatoes.length, 1);
  assert.equal(potatoes[0].category, 'Grönt');
  assert.ok(findIngredient(catalog, 'Potatis'));
});

test('färska tomater kan hittas med svenska singular- och pluralalias', () => {
  const singular = findIngredient(catalog, 'tomat');
  const plural = findIngredient(catalog, 'TOMATER');

  assert.ok(singular);
  assert.equal(plural?.id, singular.id);
  assert.equal(singular.category, 'Grönt');
  assert.equal(searchIngredients(catalog, 'färsk tomat')[0]?.id, singular.id);
});

test('sökning prioriterar exakta träffar och respekterar resultatgränsen', () => {
  const results = searchIngredients(catalog, 'tomat', 2);

  assert.equal(results.length, 2);
  assert.equal(results[0].name, 'Tomater');
  assert.equal(findIngredient(catalog, 'mjölk')?.name, 'Mjölk');
  assert.equal(findIngredient(catalog, 'mjölk hemma'), undefined);
  assert.deepEqual(searchIngredients(catalog, '   '), []);
});

test('normalisering ignorerar diakritik och extra blanksteg', () => {
  assert.equal(normalizeIngredientName('  Crème   fraiche '), 'creme fraiche');
  assert.equal(findIngredient(catalog, 'creme fraiche')?.category, 'Mejeri');
});

test('samma canonical-id med alternativa namn blir ett förslag med alias', () => {
  const source = RECIPES.find((recipe) => recipe.ingredients.some((ingredient) => ingredient.id === 'citron'))!;
  const lemon = source.ingredients.find((ingredient) => ingredient.id === 'citron')!;
  const recipe = { ...source, ingredients: [lemon, { ...lemon, name: 'Gul citron' }] };
  const result = buildIngredientCatalog([recipe]);

  assert.equal(result.filter((ingredient) => ingredient.id === 'citron').length, 1);
  assert.equal(findIngredient(result, 'Gul citron')?.id, 'citron');
});
