import assert from 'node:assert/strict';
import { existsSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { RECIPES } from '../src/app/data/recipes.ts';

test('startreceptens matbilder finns, är märkta och är optimerade för webb', () => {
  for (const recipe of RECIPES) {
    const path = fileURLToPath(new URL(`../public/${recipe.image}`, import.meta.url));
    assert.ok(existsSync(path), `${recipe.name}: bildfilen saknas`);
    assert.equal(recipe.imageKind, 'ai-generated', `${recipe.name}: bildkällan ska framgå`);
    assert.match(recipe.imageAlt, /AI-genererad/);
    assert.ok(statSync(path).size < 500_000, `${recipe.name}: bilden behöver komprimeras för mobil användning`);
  }
});
