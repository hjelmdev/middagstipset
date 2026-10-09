import assert from 'node:assert/strict';
import test from 'node:test';
import { fillMissingMeals, clampPlanningDays, mealsByDate, mergeMeals, planningWindow } from '../src/app/domain/rolling-plan.ts';
import { RECIPES } from '../src/app/data/recipes.ts';
import { replaceMeal } from '../src/app/domain/meal-engine.ts';
import type { MealPlan, Person, PlannedMeal } from '../src/app/domain/models.ts';

const adult: Person = { id: 'adult', name: 'Vuxen', portionFactor: 1, dietaryNeeds: [] };

test('nytt förslag utan matchande kandidat tar inte bort vald middag', () => {
  const selected = dinner('2026-10-09', { recipeId: RECIPES[0].id, maxMinutes: 1 });
  assert.deepEqual(replaceMeal(selected, RECIPES, [adult], []), selected);
});

function dinner(date: string, patch: Partial<PlannedMeal> = {}): PlannedMeal {
  return {
    id: `${date}-dinner`, date, mealType: 'dinner', recipeId: null,
    participantIds: [adult.id], extraPortions: 0, maxMinutes: 35,
    locked: false, status: 'planned', ...patch,
  };
}

function plan(weekStart: string, ...meals: PlannedMeal[]): MealPlan {
  return { weekStart, meals };
}

function findMeal(plans: MealPlan[], date: string): PlannedMeal | undefined {
  return plans.flatMap((bucket) => bucket.meals).find((meal) => meal.date === date && meal.mealType === 'dinner');
}

test('torsdag och sju dagar ger exakt tors–ons med startdatum som transient weekStart', () => {
  const plans = [plan('2026-10-05', dinner('2026-10-08', { id: 'saved-thursday', recipeId: 'kottfarslasagne', locked: true }))];
  const window = planningWindow(plans, '2026-10-08', 7, [adult]);

  assert.equal(window.weekStart, '2026-10-08');
  assert.deepEqual(window.meals.map((meal) => meal.date), [
    '2026-10-08', '2026-10-09', '2026-10-10', '2026-10-11', '2026-10-12', '2026-10-13', '2026-10-14',
  ]);
  assert.equal(window.meals[0].id, 'saved-thursday');
  assert.equal(window.meals.length, 7);
});

test('söndagsfönster över veckogränsen återanvänder tre rätter och skapar fyra nya', () => {
  const existing = plan('2026-10-12',
    dinner('2026-10-12', { id: 'monday-saved', recipeId: 'citronlax-med-potatis' }),
    dinner('2026-10-13', { id: 'tuesday-saved', recipeId: 'svarta-bon-tacos' }),
    dinner('2026-10-14', { id: 'wednesday-saved', recipeId: 'kottfarslasagne' }),
  );
  const window = planningWindow([existing], '2026-10-11', 7, [adult]);
  const reused = window.meals.filter((meal) => ['monday-saved', 'tuesday-saved', 'wednesday-saved'].includes(meal.id));
  const created = window.meals.filter((meal) => meal.id.endsWith('-dinner') && meal.recipeId === null);

  assert.equal(window.weekStart, '2026-10-11');
  assert.equal(window.meals.length, 7);
  assert.equal(reused.length, 3);
  assert.equal(created.length, 4);
});

test('dagantal klampas till 1–28 och planningWindow stöder 1, 3 och 14 dagar', () => {
  assert.equal(clampPlanningDays(Number.NaN), 7);
  assert.equal(clampPlanningDays(0), 1);
  assert.equal(clampPlanningDays(100), 28);
  assert.equal(clampPlanningDays(3.9), 3);
  for (const days of [1, 3, 14]) {
    assert.equal(planningWindow([], '2026-10-08', days, [adult]).meals.length, days);
  }
});

test('nya dagar får vardagstid respektive generösare tid på lördag och söndag', () => {
  const window = planningWindow([], '2026-10-09', 3, [adult]);
  assert.deepEqual(window.meals.map((meal) => [meal.date, meal.maxMinutes]), [
    ['2026-10-09', 35], ['2026-10-10', 60], ['2026-10-11', 60],
  ]);
});

test('deduplicering prioriterar tillagad rätt, därefter låst före senare olåst bucket', () => {
  const plans = [
    plan('2026-10-05',
      dinner('2026-10-08', { id: 'planned-old', recipeId: 'citronlax-med-potatis' }),
      dinner('2026-10-09', { id: 'cooked-old', recipeId: 'kottfarslasagne', status: 'cooked' }),
      dinner('2026-10-10', { id: 'locked-old', recipeId: 'svarta-bon-tacos', locked: true }),
    ),
    plan('2026-10-12',
      dinner('2026-10-08', { id: 'planned-new', recipeId: 'svarta-bon-tacos' }),
      dinner('2026-10-09', { id: 'planned-new-cooked-date', recipeId: 'svarta-bon-tacos' }),
      dinner('2026-10-10', { id: 'planned-new-locked-date', recipeId: 'citronlax-med-potatis' }),
    ),
  ];
  const byDate = mealsByDate(plans);

  assert.equal(byDate.length, 3);
  assert.equal(findMeal([plan('x', ...byDate)], '2026-10-08')?.id, 'planned-new');
  assert.equal(findMeal([plan('x', ...byDate)], '2026-10-09')?.id, 'cooked-old');
  assert.equal(findMeal([plan('x', ...byDate)], '2026-10-10')?.id, 'locked-old');
});

test('merge bevarar historik och status, uppdaterar id och lägger allt i kanoniska buckets utan dubletter', () => {
  const old = dinner('2026-10-08', { id: 'keep-locked-id', recipeId: 'citronlax-med-potatis', locked: true });
  const cooked = dinner('2026-10-09', { id: 'cooked-id', recipeId: 'kottfarslasagne', status: 'cooked', cookedAt: '2026-10-09T18:15:00Z' });
  const history = dinner('2026-10-02', { id: 'history-id', recipeId: 'svarta-bon-tacos' });
  const plans = [plan('2026-10-05', old, cooked), plan('2026-09-28', history)];
  const changed = dinner('2026-10-08', { id: 'keep-locked-id', recipeId: 'svenska-kottbullar-med-potatismos', locked: true });
  const added = dinner('2026-10-15', { id: 'new-thursday', recipeId: 'kottfarslasagne' });
  const merged = mergeMeals(plans, [changed, added]);
  const allMeals = merged.flatMap((bucket) => bucket.meals);

  assert.equal(findMeal(merged, '2026-10-08')?.recipeId, changed.recipeId);
  assert.equal(findMeal(merged, '2026-10-08')?.id, old.id);
  assert.equal(findMeal(merged, '2026-10-08')?.locked, true);
  assert.equal(findMeal(merged, '2026-10-09')?.status, 'cooked');
  assert.equal(findMeal(merged, '2026-10-09')?.cookedAt, cooked.cookedAt);
  assert.equal(findMeal(merged, '2026-10-02')?.recipeId, history.recipeId);
  assert.equal(findMeal(merged, '2026-10-15')?.id, added.id);
  assert.equal(merged.find((bucket) => bucket.weekStart === '2026-10-05')?.meals.some((meal) => meal.date === '2026-10-08'), true);
  assert.equal(merged.find((bucket) => bucket.weekStart === '2026-10-12')?.meals.some((meal) => meal.date === '2026-10-15'), true);
  assert.equal(allMeals.filter((meal) => meal.date === '2026-10-08' && meal.mealType === 'dinner').length, 1);
});

test('fillMissingMeals behåller befintliga recept, cooked och lås utan att ändra lock state', () => {
  const existing = dinner('2026-10-12', { id: 'chosen-open', recipeId: 'kottfarslasagne', locked: false });
  const locked = dinner('2026-10-13', { id: 'chosen-locked', recipeId: 'citronlax-med-potatis', locked: true });
  const cooked = dinner('2026-10-14', { id: 'chosen-cooked', recipeId: 'svarta-bon-tacos', status: 'cooked', cookedAt: '2026-10-14T17:00:00Z' });
  const empty = dinner('2026-10-15', { id: 'empty-slot' });
  const filled = fillMissingMeals(plan('2026-10-12', existing, locked, cooked, empty), RECIPES, [adult], [], [], () => 0.5);

  assert.equal(filled.meals[0].recipeId, existing.recipeId);
  assert.equal(filled.meals[0].locked, false);
  assert.equal(filled.meals[1].recipeId, locked.recipeId);
  assert.equal(filled.meals[1].locked, true);
  assert.equal(filled.meals[2].recipeId, cooked.recipeId);
  assert.equal(filled.meals[2].status, 'cooked');
  assert.equal(filled.meals[2].locked, false);
  assert.equal(filled.meals[2].cookedAt, cooked.cookedAt);
  assert.ok(filled.meals[3].recipeId);
});

test('fillMissingMeals lämnar tomt när ingen kandidat klarar tidsgränsen', () => {
  const empty = dinner('2026-10-12', { id: 'too-short', maxMinutes: 1 });
  const filled = fillMissingMeals(plan('2026-10-12', empty), RECIPES, [adult], [], [], () => 0.5);
  assert.equal(filled.meals[0].recipeId, null);
});
