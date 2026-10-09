import test from 'node:test';
import assert from 'node:assert/strict';
import { replaceShoppingRange, shoppingForRange } from '../src/app/domain/shopping.ts';
import type { ShoppingItem } from '../src/app/domain/models.ts';

const recipe: ShoppingItem = { id: 'recipe:potato:g', ingredientId: 'potato', name: 'Potatis', quantity: 500,
  unit: 'g', category: 'Grönt', source: 'recipe', checked: true, weekStart: '2026-10-08', rangeKey: '2026-10-08:7' };
const manual: ShoppingItem = { ...recipe, id: 'manual:coffee', source: 'manual', name: 'Kaffe', rangeKey: undefined };

test('rullande avbockning gäller exakt startdatum och längd; egna varor är gemensamma', () => {
  assert.deepEqual(shoppingForRange([recipe, manual], '2026-10-08', 7), [recipe, manual]);
  assert.deepEqual(shoppingForRange([recipe, manual], '2026-10-11', 7), [manual]);
  assert.deepEqual(shoppingForRange([recipe, manual], '2026-10-08', 3), [manual]);
});

test('byte av intervall behåller gamla avbockningar utan att duplicera egna varor', () => {
  const updated = replaceShoppingRange([recipe, manual], [{ ...recipe, checked: false }, manual, manual], '2026-10-11', 7);
  assert.equal(updated.filter(item => item.source === 'manual').length, 1);
  assert.equal(shoppingForRange(updated, '2026-10-08', 7)[0].checked, true);
  assert.equal(shoppingForRange(updated, '2026-10-11', 7)[0].checked, false);
  const again = replaceShoppingRange(updated, [{ ...recipe, checked: true }, manual], '2026-10-11', 7);
  assert.equal(again.filter(item => item.rangeKey === '2026-10-11:7').length, 1);
});

test('gammal veckolista återanvänds endast för samma sju kalenderdatum', () => {
  const legacy = { ...recipe, rangeKey: undefined, weekStart: '2026-10-05' };
  assert.deepEqual(shoppingForRange([legacy], '2026-10-05', 7), [legacy]);
  assert.deepEqual(shoppingForRange([legacy], '2026-10-08', 7), []);
});
