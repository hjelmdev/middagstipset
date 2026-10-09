import assert from 'node:assert/strict';
import test from 'node:test';
import { replaceShoppingWeek, shoppingForWeek } from '../src/app/domain/shopping.ts';
import type { ShoppingItem } from '../src/app/domain/models.ts';

const weekA = '2026-10-12';
const weekB = '2026-10-19';

function item(overrides: Partial<ShoppingItem> = {}): ShoppingItem {
  return {
    id: 'recipe:potatis:g', ingredientId: 'potatis', name: 'Potatis', quantity: 500,
    unit: 'g', category: 'Grönt', source: 'recipe', checked: false, weekStart: weekA,
    ...overrides,
  };
}

test('avbockning från vecka A följer inte med till B för samma ingrediens och mängd', () => {
  const checkedInA = item({ checked: true, weekStart: weekA });
  const currentB = item({ checked: false, weekStart: weekB });
  const stored = replaceShoppingWeek([checkedInA], [currentB], weekB);

  assert.equal(shoppingForWeek(stored, weekA)[0].checked, true);
  assert.equal(shoppingForWeek(stored, weekB)[0].checked, false);
});

test('uppdatering av vecka B bevarar receptvarorna från vecka A', () => {
  const weekAItem = item({ id: 'recipe:potatis:g', checked: true, weekStart: weekA });
  const oldBItem = item({ id: 'recipe:morot:g', ingredientId: 'morot', name: 'Morötter', weekStart: weekB });
  const nextBItem = item({ id: 'recipe:ris:g', ingredientId: 'ris', name: 'Ris', weekStart: weekB });

  const stored = replaceShoppingWeek([weekAItem, oldBItem], [nextBItem], weekB);

  assert.deepEqual(shoppingForWeek(stored, weekA), [weekAItem]);
  assert.deepEqual(shoppingForWeek(stored, weekB), [nextBItem]);
});

test('manuella rader följer med genereringen och dedupliceras på id', () => {
  const manual: ShoppingItem = {
    id: 'manual:coffee', ingredientId: 'manual', name: 'Kaffe', quantity: 1,
    unit: 'st', category: 'Skafferi', source: 'manual', checked: true,
  };
  const current = [item({ weekStart: weekB }), manual, { ...manual, checked: false }];

  const stored = replaceShoppingWeek([], current, weekB);
  const visible = shoppingForWeek(stored, weekB);

  assert.equal(visible.filter((entry) => entry.id === manual.id).length, 1);
  assert.deepEqual(visible.find((entry) => entry.id === manual.id), manual);
});

test('avbockning i aktuell vecka överlever replace och serialisering', () => {
  const checkedCurrent = item({ checked: true, weekStart: weekB });
  const stored = replaceShoppingWeek([item({ weekStart: weekA })], [checkedCurrent], weekB);
  const roundTrip = JSON.parse(JSON.stringify(stored)) as ShoppingItem[];

  assert.deepEqual(shoppingForWeek(roundTrip, weekB), [checkedCurrent]);
  assert.equal(shoppingForWeek(roundTrip, weekB)[0].checked, true);
});
