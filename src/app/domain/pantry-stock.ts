import { convertQuantity } from './kitchen-units.ts';
import type { Ingredient, PantryStockItem, ShoppingItem } from './models.ts';

const EPSILON = 0.000001;

function canonicalUnit(unit: Ingredient['unit']): Ingredient['unit'] {
  if (unit === 'ml' || unit === 'msk' || unit === 'tsk') return 'ml';
  return unit;
}

function toCanonical(quantity: number, unit: Ingredient['unit']): number | null {
  return convertQuantity(quantity, unit, canonicalUnit(unit));
}

function fromCanonical(quantity: number, unit: Ingredient['unit']): number | null {
  return convertQuantity(quantity, canonicalUnit(unit), unit);
}

export interface PantryAllocation {
  /** Requirements after available stock has been allocated, in the original requirement units. */
  remaining: Ingredient[];
  /** Exact stock quantities removed, grouped by ingredient id and stock unit. */
  used: PantryStockItem[];
  /** Stock after the allocation. */
  stock: PantryStockItem[];
}

/** Restore an exact deduction ledger after undoing a cooked status. */
export function restorePantryStock(stock: PantryStockItem[], ledger: PantryStockItem[]): PantryStockItem[] {
  const restored = stock.map(item => ({ ...item }));
  for (const used of ledger) {
    const existing = restored.find(item => item.ingredientId === used.ingredientId && item.unit === used.unit);
    if (existing) existing.quantity += used.quantity;
    else restored.push({ ...used });
  }
  return restored;
}

/** Allocate inventory once across all requirements; dimensions never cross g/ml/st. */
export function allocatePantryStock(stock: PantryStockItem[], requirements: Ingredient[]): PantryAllocation {
  const stockLeft = stock.map(item => ({ ...item }));
  const usedByKey = new Map<string, PantryStockItem>();
  const remaining: Ingredient[] = [];

  for (const requirement of requirements) {
    let needed = toCanonical(requirement.quantity, requirement.unit);
    if (needed === null || needed <= 0) {
      remaining.push({ ...requirement });
      continue;
    }
    const dimension = canonicalUnit(requirement.unit);
    for (let index = 0; index < stockLeft.length && needed > EPSILON; index++) {
      const item = stockLeft[index];
      if (item.ingredientId !== requirement.id || canonicalUnit(item.unit) !== dimension) continue;
      let available = toCanonical(item.quantity, item.unit);
      if (available === null || available <= EPSILON) continue;
      const take = Math.min(available, needed);
      const stockUnitTake = fromCanonical(take, item.unit);
      const requirementUnitTake = fromCanonical(take, requirement.unit);
      if (stockUnitTake === null || requirementUnitTake === null) continue;
      item.quantity = Math.max(0, item.quantity - stockUnitTake);
      needed = Math.max(0, needed - take);
      const key = `${item.ingredientId}:${item.unit}`;
      const prior = usedByKey.get(key);
      if (prior) prior.quantity += stockUnitTake;
      else usedByKey.set(key, { ingredientId: item.ingredientId, name: item.name, category: item.category, quantity: stockUnitTake, unit: item.unit });
    }
    const neededInRequirementUnit = fromCanonical(needed, requirement.unit);
    if (neededInRequirementUnit !== null && neededInRequirementUnit > EPSILON) {
      remaining.push({ ...requirement, quantity: neededInRequirementUnit });
    }
  }

  return {
    remaining,
    used: [...usedByKey.values()].filter(item => item.quantity > EPSILON),
    stock: stockLeft.filter(item => item.quantity > EPSILON),
  };
}

/** Subtract stock from recipe rows only. Manual shopping rows are carried through untouched. */
export function applyPantryStock(
  items: ShoppingItem[],
  stock: PantryStockItem[],
  enabled: boolean,
  previous: ShoppingItem[] = [],
): ShoppingItem[] {
  const recipeItems = items.filter(item => item.source === 'recipe');
  const manualItems = items.filter(item => item.source === 'manual');
  const allocation = enabled
    ? allocatePantryStock(stock, recipeItems.map(item => ({ ...item, id: item.ingredientId, component: '', allergens: [] })))
    : { remaining: recipeItems.map(item => ({ ...item, id: item.ingredientId, component: '', allergens: [] })), used: [], stock };
  const recipeNet = allocation.remaining.map(item => {
    const original = recipeItems.find(row => row.ingredientId === item.id && row.unit === item.unit)!;
    const old = previous.find(row => row.source === 'recipe' && row.id === original.id);
    const checked = !!old?.checked && Math.abs(old.quantity - item.quantity) < EPSILON && old.unit === item.unit;
    return { ...original, quantity: item.quantity, checked };
  });
  const manual = manualItems.map(item => {
    const old = previous.find(row => row.source === 'manual' && row.id === item.id);
    return old ? { ...item, checked: old.checked } : item;
  });
  return [...recipeNet, ...manual];
}
