import assert from 'node:assert/strict';
import test from 'node:test';
import { pantryRecipeMatches } from '../src/app/domain/pantry.ts';
import { RECIPES } from '../src/app/data/recipes.ts';
import type { Person } from '../src/app/domain/models.ts';

const adult: Person = { id: 'adult', name: 'Vuxen', portionFactor: 1, dietaryNeeds: [] };

test('förslag sorteras efter antal saknade och gränsen kan begränsa resultatet', () => {
  const recipe = RECIPES.find((candidate) => candidate.id === 'citronlax-med-potatis')!;
  const ids = recipe.ingredients.slice(0, 4).map((ingredient) => ingredient.id);
  const matches = pantryRecipeMatches([recipe], [adult], ids, 3);

  assert.equal(matches.length, 1);
  assert.deepEqual(matches[0].missing.map((ingredient) => ingredient.id), ['creme-fraiche', 'smor']);
  assert.deepEqual(pantryRecipeMatches([recipe], [adult], ids, 1), []);
});

test('recept som inte passar kostbehoven utesluts', () => {
  const vegetarian = { ...adult, dietaryNeeds: ['vegetarian'] as const };
  const meatballs = RECIPES.find((candidate) => candidate.id === 'svenska-kottbullar-med-potatismos')!;

  assert.deepEqual(pantryRecipeMatches([meatballs], [vegetarian], [], 20), []);
});

test('glutenfri anpassning använder alternativets canonical-id och skalad mängd', () => {
  const glutenFreePerson: Person = { ...adult, portionFactor: 2, dietaryNeeds: ['gluten-free'] };
  const pasta = RECIPES.find((candidate) => candidate.id === 'kramig-tomatpasta-med-linser')!;
  const matches = pantryRecipeMatches([pasta], [glutenFreePerson], ['pasta'], 20);
  const glutenFreePasta = matches[0].required.find((ingredient) => ingredient.id === 'glutenfri-pasta');

  assert.equal(glutenFreePasta?.quantity, 150);
  assert.ok(matches[0].missing.some((ingredient) => ingredient.id === 'glutenfri-pasta'));

  const withAlternative = pantryRecipeMatches([pasta], [glutenFreePerson], ['glutenfri-pasta'], 20)[0];
  assert.ok(!withAlternative.missing.some((ingredient) => ingredient.id === 'glutenfri-pasta'));
});

test('ingredienser räknas efter id och mängden hemma antas inte', () => {
  const potatoRecipe = RECIPES.find((candidate) => candidate.id === 'citronlax-med-potatis')!;
  const withPotato = pantryRecipeMatches([potatoRecipe], [adult], ['potatis'], 20)[0];

  assert.ok(withPotato.required.some((ingredient) => ingredient.id === 'potatis'));
  assert.ok(!withPotato.missing.some((ingredient) => ingredient.id === 'potatis'));
});

test('samma råvara summeras per enhet men saknas bara som ett canonical-id', () => {
  const base = RECIPES.find((candidate) => candidate.id === 'citronlax-med-potatis')!;
  const lemon = base.ingredients.find((ingredient) => ingredient.id === 'citron')!;
  const recipe = { ...base, ingredients: [...base.ingredients, { ...lemon, quantity: 2 }, { ...lemon, unit: 'ml' as const, quantity: 15 }] };
  const pantryIds = base.ingredients.filter((ingredient) => ingredient.id !== 'citron').map((ingredient) => ingredient.id);
  const result = pantryRecipeMatches([recipe], [adult], pantryIds, 20)[0];

  assert.equal(result.required.find((ingredient) => ingredient.id === 'citron' && ingredient.unit === 'st')?.quantity, 0.75);
  assert.equal(result.required.find((ingredient) => ingredient.id === 'citron' && ingredient.unit === 'ml')?.quantity, 3.75);
  assert.equal(result.missing.filter((ingredient) => ingredient.id === 'citron').length, 2);
  assert.equal(result.missingCount, 1);
});
