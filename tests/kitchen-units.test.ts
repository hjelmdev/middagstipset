import assert from 'node:assert/strict';
import test from 'node:test';
import { convertQuantity, normalizeKitchenAmount } from '../src/app/domain/kitchen-units.ts';

test('normaliserar vanliga vikt- och volymmått till ingrediensenheter', () => {
  assert.deepEqual(normalizeKitchenAmount(1.5, 'kg'), { quantity: 1500, unit: 'g' });
  assert.deepEqual(normalizeKitchenAmount(2, 'l'), { quantity: 2000, unit: 'ml' });
  assert.deepEqual(normalizeKitchenAmount(1.25, 'dl'), { quantity: 125, unit: 'ml' });
  assert.deepEqual(normalizeKitchenAmount(3, 'cl'), { quantity: 30, unit: 'ml' });
  assert.deepEqual(normalizeKitchenAmount(2, 'msk'), { quantity: 2, unit: 'msk' });
  assert.deepEqual(normalizeKitchenAmount(4, 'st'), { quantity: 4, unit: 'st' });
});

test('avvisar orimliga eller ogiltiga normaliseringsmängder', () => {
  for (const quantity of [0, -0.1, Number.NaN, Infinity, 1_000_000_001]) {
    assert.throws(() => normalizeKitchenAmount(quantity, 'g'), RangeError);
  }
  assert.throws(() => normalizeKitchenAmount(1_000_001, 'kg'), RangeError);
});

test('konverterar volym mellan ml, msk och tsk', () => {
  assert.equal(convertQuantity(1, 'msk', 'ml'), 15);
  assert.equal(convertQuantity(1, 'tsk', 'ml'), 5);
  assert.equal(convertQuantity(30, 'ml', 'msk'), 2);
  assert.equal(convertQuantity(15, 'ml', 'tsk'), 3);
  assert.equal(convertQuantity(2.5, 'ml', 'ml'), 2.5);
});

test('g och st kan bara konverteras till samma enhet', () => {
  assert.equal(convertQuantity(125, 'g', 'g'), 125);
  assert.equal(convertQuantity(2, 'st', 'st'), 2);
  assert.equal(convertQuantity(1, 'g', 'ml'), null);
  assert.equal(convertQuantity(1, 'st', 'tsk'), null);
  assert.equal(convertQuantity(1, 'g', 'st'), null);
});

test('mängdkonvertering avvisar icke-ändliga och negativa resultat', () => {
  assert.equal(convertQuantity(-1, 'ml', 'ml'), null);
  assert.equal(convertQuantity(Number.NaN, 'ml', 'ml'), null);
  assert.equal(convertQuantity(1_000_000_000, 'tsk', 'ml'), null);
});
