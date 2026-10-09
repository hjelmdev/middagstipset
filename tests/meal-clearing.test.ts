import assert from 'node:assert/strict';
import test from 'node:test';
import { clearPlannedMeals, restoreClearedMeals } from '../src/app/domain/meal-clearing.ts';
import type { PlannedMeal } from '../src/app/domain/models.ts';

function meal(id: string, patch: Partial<PlannedMeal> = {}): PlannedMeal {
  return { id, date: `2026-10-${id === 'm2' ? '10' : '09'}`, mealType: 'dinner', recipeId: 'recipe-1', participantIds: ['p1', 'p2'],
    extraPortions: 1.5, maxMinutes: 45, locked: false, status: 'planned', ...patch };
}

test('clear is atomic and retains all editable day settings while clearing recipe', () => {
  const days = [meal('m1'), meal('m2', { participantIds: ['p2'], maxMinutes: 60 })];
  const result = clearPlannedMeals(days, ['m1', 'm2'], new Set());
  assert.equal(result.error, '');
  assert.equal(result.checkpoint.cleared.length, 2);
  assert.equal(result.checkpoint.cleared[0].recipeId, null);
  assert.equal(result.checkpoint.cleared[0].date, days[0].date);
  assert.deepEqual(result.checkpoint.cleared[1].participantIds, ['p2']);
  assert.equal(result.checkpoint.cleared[1].maxMinutes, 60);
  assert.equal(result.checkpoint.cleared[1].extraPortions, 1.5);
});

test('locked, cooked, empty, lunch-reserved and missing selections reject the full batch', () => {
  const days = [meal('m1'), meal('m2', { locked: true }), meal('m3', { status: 'cooked' }), meal('m4', { recipeId: null })];
  assert.match(clearPlannedMeals(days, ['m1', 'm2'], new Set()).error, /planerade, olåsta/i);
  assert.match(clearPlannedMeals(days, ['m1', 'm3'], new Set()).error, /planerade, olåsta/i);
  assert.match(clearPlannedMeals(days, ['m1', 'm4'], new Set()).error, /planerade, olåsta/i);
  assert.match(clearPlannedMeals(days, ['m1', 'unknown'], new Set()).error, /finns inte längre/i);
  assert.match(clearPlannedMeals(days, ['m1'], new Set(['m1'])).error, /lunchreservationer/i);
  assert.equal(clearPlannedMeals(days, [], new Set()).checkpoint, null);
});

test('undo restores all original meals only while every cleared row is unchanged', () => {
  const original = [meal('m1'), meal('m2')];
  const cleared = clearPlannedMeals(original, ['m1', 'm2'], new Set()).checkpoint;
  const restored = restoreClearedMeals(cleared.cleared, cleared);
  assert.equal(restored.error, '');
  assert.deepEqual(restored.meals, original);

  const reselected = cleared.cleared.map(item => item.id === 'm1' ? { ...item, recipeId: 'new-choice' } : item);
  assert.match(restoreClearedMeals(reselected, cleared).error, /har ändrats efter tömningen/i);
  const editedPeople = cleared.cleared.map(item => item.id === 'm2' ? { ...item, participantIds: ['p1'] } : item);
  assert.match(restoreClearedMeals(editedPeople, cleared).error, /har ändrats efter tömningen/i);
});

test('undo can restore a kept recipe even when its existing max time is lower than its duration', () => {
  const longRecipeMeal = meal('m1', { maxMinutes: 20 });
  const cleared = clearPlannedMeals([longRecipeMeal], ['m1'], new Set()).checkpoint;
  const restored = restoreClearedMeals(cleared.cleared, cleared);
  assert.equal(restored.error, '');
  assert.deepEqual(restored.meals, [longRecipeMeal]);
});

test('selection rejects duplicate ids instead of silently restoring partial intent', () => {
  const result = clearPlannedMeals([meal('m1')], ['m1', 'm1'], new Set());
  assert.match(result.error, /valts flera gånger/i);
});
