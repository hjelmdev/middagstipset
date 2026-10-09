import assert from 'node:assert/strict';
import test from 'node:test';
import { RECIPES } from '../src/app/data/recipes.ts';
import { cloneRecipeAsVariant } from '../src/app/domain/recipe-variants.ts';
import { scaleIngredients } from '../src/app/domain/meal-engine.ts';
import { preservedVariantGlutenMetadata } from '../src/app/domain/recipe-variants.ts';

test('creates a private variant with a new id and an explicit variant name', () => {
  const original = RECIPES[0];
  const variant = cloneRecipeAsVariant(original, 'custom:test-variant');
  assert.equal(variant.id, 'custom:test-variant');
  assert.equal(variant.name, `${original.name} (min variant)`);
  assert.deepEqual({ ...variant, id: original.id, name: original.name }, original);
});

test('variant recipe data is deeply independent from its source', () => {
  const original = RECIPES[0];
  const originalName = original.ingredients[0].name;
  const originalStep = original.steps[0].text;
  const variant = cloneRecipeAsVariant(original, 'custom:independent');

  variant.ingredients[0].name = 'Ändrad ingrediens';
  variant.steps[0].text = 'Ändrat tillagningssteg';
  variant.tags.push('Egen variant');

  assert.equal(original.ingredients[0].name, originalName);
  assert.equal(original.steps[0].text, originalStep);
  assert.ok(!original.tags.includes('Egen variant'));
});

test('an unchanged split-pasta variant preserves component rules and mixed-family quantities', () => {
  const original = RECIPES.find(recipe => recipe.glutenStrategy === 'split-component' && recipe.separateGlutenComponents?.includes('pasta'))!;
  const variant = cloneRecipeAsVariant(original, 'custom:tomatpasta-variant');
  const rows = variant.ingredients.map((ingredient) => ({
    id: ingredient.id,
    name: ingredient.name,
    originalName: ingredient.name,
    glutenStatus: ingredient.allergens.includes('gluten') ? 'contains' : 'unknown',
    originalGlutenStatus: ingredient.allergens.includes('gluten') ? 'contains' : 'unknown',
  }));
  const metadata = preservedVariantGlutenMetadata(original, rows);
  const family = [
    { id: 'regular', name: 'Vuxen', portionFactor: 1, dietaryNeeds: [] as ('gluten-free' | 'vegetarian')[] },
    { id: 'gf', name: 'Glutenfritt', portionFactor: 1, dietaryNeeds: ['gluten-free'] as ('gluten-free' | 'vegetarian')[] },
  ];

  assert.equal(metadata.preserved, true);
  assert.equal(metadata.glutenStrategy, 'split-component');
  assert.deepEqual(metadata.separateGlutenComponents, ['pasta']);
  assert.deepEqual(variant.ingredients.map(item => item.component), original.ingredients.map(item => item.component));
  assert.deepEqual(scaleIngredients(variant, family), scaleIngredients(original, family));
  assert.deepEqual(scaleIngredients(variant, family).filter(item => item.id === 'pasta' || item.id === 'glutenfri-pasta')
    .map(item => [item.name, item.quantity]), [['Pasta', 75], ['Glutenfri pasta', 75]]);
});

test('changing an ingredient or its reviewed gluten status invalidates inherited strategy', () => {
  const original = RECIPES.find(recipe => recipe.glutenStrategy === 'split-component' && recipe.separateGlutenComponents?.includes('pasta'))!;
  const rows = original.ingredients.map((ingredient) => ({
    id: ingredient.id,
    name: ingredient.name,
    originalName: ingredient.name,
    glutenStatus: ingredient.allergens.includes('gluten') ? 'contains' : 'unknown',
    originalGlutenStatus: ingredient.allergens.includes('gluten') ? 'contains' : 'unknown',
  }));
  rows[0].glutenStatus = 'free';
  const metadata = preservedVariantGlutenMetadata(original, rows);
  assert.equal(metadata.preserved, false);
  assert.equal(metadata.glutenStrategy, 'unsupported');
  assert.equal(metadata.separateGlutenComponents, undefined);
});
