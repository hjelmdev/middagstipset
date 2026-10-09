import type { Ingredient } from './models.ts';

export type KitchenUnit = Ingredient['unit'] | 'kg' | 'l' | 'dl' | 'cl';

const MAX_KITCHEN_AMOUNT = 1_000_000_000;
const volumeInMillilitres: Partial<Record<Ingredient['unit'], number>> = {
  ml: 1,
  msk: 15,
  tsk: 5,
};

export function normalizeKitchenAmount(
  quantity: number,
  unit: KitchenUnit,
): { quantity: number; unit: Ingredient['unit'] } {
  if (!Number.isFinite(quantity) || quantity <= 0 || quantity > MAX_KITCHEN_AMOUNT) {
    throw new RangeError('Mängden måste vara större än 0 och högst 1 000 000 000.');
  }
  let normalized: { quantity: number; unit: Ingredient['unit'] };
  switch (unit) {
    case 'kg': normalized = { quantity: quantity * 1000, unit: 'g' }; break;
    case 'l': normalized = { quantity: quantity * 1000, unit: 'ml' }; break;
    case 'dl': normalized = { quantity: quantity * 100, unit: 'ml' }; break;
    case 'cl': normalized = { quantity: quantity * 10, unit: 'ml' }; break;
    default: normalized = { quantity, unit };
  }
  if (!Number.isFinite(normalized.quantity) || normalized.quantity > MAX_KITCHEN_AMOUNT) {
    throw new RangeError('Den omräknade mängden är för stor.');
  }
  return normalized;
}

export function convertQuantity(
  quantity: number,
  from: Ingredient['unit'],
  to: Ingredient['unit'],
): number | null {
  if (!Number.isFinite(quantity) || quantity < 0 || quantity > MAX_KITCHEN_AMOUNT) return null;
  if (from === to) return quantity;
  const fromMl = volumeInMillilitres[from];
  const toMl = volumeInMillilitres[to];
  if (fromMl === undefined || toMl === undefined) return null;
  const converted = quantity * fromMl / toMl;
  return Number.isFinite(converted) && converted <= MAX_KITCHEN_AMOUNT ? converted : null;
}
