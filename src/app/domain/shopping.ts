import type { ShoppingItem } from './models.ts';

/**
 * Replace this week's recipe rows while retaining recipe rows for other weeks.
 * `current` is the list returned by buildShoppingList and already includes the
 * household's manual rows, so old manual rows are replaced by those rows.
 */
export function replaceShoppingWeek(
  previous: ShoppingItem[],
  current: ShoppingItem[],
  weekStart: string,
): ShoppingItem[] {
  const otherWeeks = previous.filter((item) => item.source === 'recipe' && item.weekStart !== weekStart);
  const currentManual = new Map<string, ShoppingItem>();
  const currentRecipes = current
    .filter((item) => item.source === 'recipe')
    .map((item) => ({ ...item, weekStart }));

  for (const item of current) {
    if (item.source === 'manual' && !currentManual.has(item.id)) currentManual.set(item.id, item);
  }

  return [...otherWeeks, ...currentRecipes, ...currentManual.values()];
}

/** Manual rows are shared; recipe rows belong only to the selected week. */
export function shoppingForWeek(items: ShoppingItem[], weekStart: string): ShoppingItem[] {
  return items.filter((item) => item.source === 'manual' || item.weekStart === weekStart);
}

/** Checklist marks belong to the exact set of dates, never a different rolling window. */
export function shoppingForRange(items: ShoppingItem[], start: string, days: number): ShoppingItem[] {
  const rangeKey = `${start}:${days}`;
  const isLegacyWeek = days === 7 && new Date(`${start}T12:00:00`).getDay() === 1;
  return items.filter(item => item.source === 'manual' || item.rangeKey === rangeKey ||
    (!item.rangeKey && isLegacyWeek && item.weekStart === start));
}

export function replaceShoppingRange(previous: ShoppingItem[], current: ShoppingItem[], start: string, days: number): ShoppingItem[] {
  const rangeKey = `${start}:${days}`;
  const retained = previous.filter(item => item.source === 'recipe' && item.rangeKey !== rangeKey);
  const recipes = current.filter(item => item.source === 'recipe').map(item => ({ ...item, rangeKey }));
  const manual = new Map(current.filter(item => item.source === 'manual').map(item => [item.id, item]));
  return [...retained, ...recipes, ...manual.values()];
}
