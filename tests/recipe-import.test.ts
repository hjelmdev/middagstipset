import assert from 'node:assert/strict';
import test from 'node:test';
import { parseRecipeImport } from '../src/app/domain/recipe-import.ts';

test('parses sectioned Swedish text and converts supported measurements', () => {
  const draft = parseRecipeImport(`
Namn: Tomatsoppa
Beskrivning
En enkel soppa.
Portioner: 4
Total tid: 35 min
Aktiv tid: 15 min
Ingredienser:
1/2 kg tomater
2,5 dl grädde
3 cl vatten
½ tsk salt
salt efter smak
Tillagning:
1. Skär tomaterna.
2. Koka soppan.`);
  assert.equal(draft.name, 'Tomatsoppa');
  assert.equal(draft.description, 'En enkel soppa.');
  assert.equal(draft.ingredients[0].quantity, 500);
  assert.equal(draft.ingredients[0].unit, 'g');
  assert.equal(draft.ingredients[1].quantity, 250);
  assert.equal(draft.ingredients[1].unit, 'ml');
  assert.equal(draft.ingredients[2].quantity, 30);
  assert.equal(draft.ingredients[2].unit, 'ml');
  assert.equal(draft.ingredients[3].quantity, 0.5);
  assert.equal(draft.ingredients[4].quantity, null);
  assert.equal(draft.ingredients[4].quantityHint, 'Mängd saknas');
  assert.deepEqual(draft.steps.map(step => step.text), ['Skär tomaterna.', 'Koka soppan.']);
  assert.ok(draft.steps.every(step => step.needsReview));
});

test('parses inline description fields without retaining their label', () => {
  const draft = parseRecipeImport(`Namn: Svampsoppa\nBeskrivning: Krämig vardagssoppa med svamp.\nIngredienser:\n2 st champinjoner\nTillagning:\nFräs svampen.`);
  assert.equal(draft.name, 'Svampsoppa');
  assert.equal(draft.description, 'Krämig vardagssoppa med svamp.');
});

test('keeps unknown units and “efter smak” visible for manual correction', () => {
  const draft = parseRecipeImport(`Pannkakor\nIngredienser:\n2 burkar mjölk\n2 ägg\nsalt efter smak\nTillagning:\nBlanda allt.`);
  assert.equal(draft.ingredients[0].quantity, null);
  assert.equal(draft.ingredients[0].unit, null);
  assert.equal(draft.ingredients[0].quantityHint, '2 burkar');
  assert.equal(draft.ingredients[0].name, 'mjölk');
  assert.equal(draft.ingredients[1].quantity, 2);
  assert.equal(draft.ingredients[1].unit, 'st');
  assert.equal(draft.ingredients[1].name, 'ägg');
  assert.equal(draft.ingredients[2].quantity, null);
  assert.equal(draft.ingredients[2].name, 'salt');
});

test('does not strip real leading amounts and accepts decimals, fractions, and attached units', () => {
  const draft = parseRecipeImport(`Sallad\nIngredienser:\n500g tomater\n0,5kg potatis\n½dl grädde\n1 1/2msk olja\n2 ägg\nTillagning:\nBlanda.`);
  assert.deepEqual(draft.ingredients.map(row => [row.quantity, row.unit, row.name]), [
    [500, 'g', 'tomater'], [500, 'g', 'potatis'], [50, 'ml', 'grädde'], [1.5, 'msk', 'olja'], [2, 'st', 'ägg'],
  ]);
});

test('reads application recipe JSON without inferring diet claims', () => {
  const draft = parseRecipeImport(JSON.stringify({
    id: 'custom:existing', name: 'Bönpasta', description: 'Snabb rätt', servings: 2,
    totalMinutes: 25, activeMinutes: 10,
    ingredients: [{ id: 'pasta', name: 'pasta', quantity: 200, unit: 'g', category: 'Skafferi' }],
    steps: [{ text: 'Koka pastan.' }], dietaryNeeds: ['vegetarian', 'gluten-free'],
  }));
  assert.equal(draft.name, 'Bönpasta');
  assert.equal(draft.ingredients[0].quantity, 200);
  assert.equal(draft.steps[0].text, 'Koka pastan.');
  assert.equal('dietaryNeeds' in draft, false);
  assert.ok(draft.steps[0].needsReview);
});

test('reads JSON-LD Recipe from graph and nested HowTo sections, ignoring external images', () => {
  const html = `<html><head><script type="application/ld+json">${JSON.stringify({
    '@graph': [
      { '@type': 'WebPage', name: 'Sida' },
      { '@type': 'Recipe', name: 'Grön gryta', recipeYield: '4 portioner', prepTime: 'PT15M', cookTime: 'PT20M',
        image: 'https://example.test/photo.jpg', recipeIngredient: ['1 l vatten'],
        recipeInstructions: [{ '@type': 'HowToSection', name: 'Koka', itemListElement: [
          { '@type': 'HowToStep', text: 'Koka upp vattnet.' }, { '@type': 'HowToStep', text: 'Servera varmt.' },
        ] }],
      },
    ],
  })}</script><script>throw new Error('must not run')</script></head><body><h1>Annat innehåll</h1></body></html>`;
  const draft = parseRecipeImport(html);
  assert.equal(draft.name, 'Grön gryta');
  assert.equal(draft.totalMinutes, 35);
  assert.equal(draft.activeMinutes, 15);
  assert.equal(draft.ingredients[0].quantity, 1000);
  assert.deepEqual(draft.steps.map(step => step.text), ['Koka upp vattnet.', 'Servera varmt.']);
  assert.equal('image' in draft, false);
});

test('reads direct Recipe JSON-LD and string or array instructions without importing diet claims', () => {
  const direct = parseRecipeImport(JSON.stringify({
    '@type': 'Recipe', name: 'Tomatpasta', description: 'Snabb middag', recipeYield: '3 portioner',
    prepTime: 'PT10M', totalTime: 'PT25M', recipeIngredient: ['salt', '1 dl grädde'],
    recipeInstructions: ['Skär tomaterna.', 'Koka upp grädden.'], vegetarian: true, suitableForDiet: 'GlutenFreeDiet',
  }));
  assert.equal(direct.name, 'Tomatpasta');
  assert.deepEqual(direct.steps.map(step => step.text), ['Skär tomaterna.', 'Koka upp grädden.']);
  assert.equal(direct.ingredients[0].quantity, null);
  assert.equal(direct.ingredients[0].unit, null);
  assert.ok(direct.warnings.some(warning => warning.includes('mängd eller enhet')));
  assert.equal('vegetarian' in direct, false);
  assert.equal('suitableForDiet' in direct, false);
});

test('imports the Recipe JSON-LD shape returned by Arla URL import', () => {
  const response = {
    recipe: {
      '@context': 'https://schema.org/',
      '@type': 'Recipe',
      type: 'Recipe',
      name: 'Stuvade makaroner',
      description: 'En klassisk rätt.',
      totalTime: 'PT15M',
      prepTime: 'PT15M',
      cookTime: 'PT00M',
      recipeYield: '4 port',
      recipeIngredient: [
        '2 msk Svenskt Smör från Arla®', '2 msk vetemjöl', '5 dl Arla® Lantmjölk, ekologisk',
        '1 tärning grönsaksbuljong', '5 dl makaroner', '2 dl Kvibille® Riven ost cheddar', 'salt och peppar',
      ],
      recipeInstructions: [{
        '@type': 'HowToSection',
        itemListElement: [
          { '@type': 'HowToStep', text: 'Smält smör och vispa ner mjöl och mjölk.' },
          { '@type': 'HowToStep', text: 'Koka makaronerna enligt anvisning.' },
          { '@type': 'HowToStep', text: 'Rör ner stuvning och ost.' },
        ],
      }],
    },
    sourceUrl: 'https://www.arla.se/recept/stuvade-makaroner/',
    finalUrl: 'https://www.arla.se/recept/stuvade-makaroner/',
  };

  const draft = parseRecipeImport(JSON.stringify(response.recipe));
  assert.equal(draft.name, 'Stuvade makaroner');
  assert.equal(draft.servings, 4);
  assert.equal(draft.totalMinutes, 15);
  assert.equal(draft.ingredients.length, 7);
  assert.equal(draft.steps.length, 3);
});

test('incomplete structured recipes produce review warnings instead of guessed values', () => {
  const draft = parseRecipeImport(JSON.stringify({ '@type': 'Recipe', name: 'Ofullständig', recipeIngredient: ['salt'], recipeInstructions: { '@type': 'HowToStep', text: 'Smaka av.' } }));
  assert.equal(draft.servings, null);
  assert.equal(draft.totalMinutes, null);
  assert.equal(draft.activeMinutes, null);
  assert.ok(draft.warnings.some(warning => warning.includes('Portionsantal')));
  assert.ok(draft.warnings.some(warning => warning.includes('Total tillagningstid')));
  assert.ok(draft.ingredients[0].needsUnitReview);
  assert.throws(() => parseRecipeImport(JSON.stringify({ '@type': 'Recipe', recipeIngredient: ['salt'] })), /saknar namn/);
});

test('HTML without JSON-LD is stripped to readable text without executing scripts', () => {
  const draft = parseRecipeImport(`<article><h1>Omelett</h1><h2>Ingredienser</h2><ul><li>2 st ägg</li></ul><h2>Tillagning</h2><p>Vispa äggen.</p><script>alert(1)</script></article>`);
  assert.equal(draft.name, 'Omelett');
  assert.equal(draft.ingredients[0].quantity, 2);
  assert.equal(draft.ingredients[0].unit, 'st');
  assert.ok(draft.steps.some(step => step.text.includes('Vispa äggen.')));
  assert.ok(!draft.steps.some(step => step.text.includes('alert')));
});

test('returns clear errors for links, empty paste, malformed JSON, and non-recipes', () => {
  assert.throws(() => parseRecipeImport('https://example.test/recipe'), /Länkar kan inte hämtas ännu/);
  assert.throws(() => parseRecipeImport('  '), /Klistra in recepttext/);
  assert.throws(() => parseRecipeImport('{ bad json'), /JSON gick inte att läsa/);
  assert.throws(() => parseRecipeImport('{"name":"inte ett recept"}'), /innehåller inget recept/);
});
