import type { AppState } from './models.ts';
import { validateState } from '../core/state.repository.ts';

export const BACKUP_FORMAT = 'middagstipset-backup' as const;
export const BACKUP_VERSION = 1 as const;
export const MAX_BACKUP_BYTES = 5 * 1024 * 1024;

export interface AppBackup {
  format: typeof BACKUP_FORMAT;
  version: typeof BACKUP_VERSION;
  exportedAt: string;
  state: AppState;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function copyWithoutLinkedAuthIds(state: AppState): AppState {
  const copy = structuredClone(state);
  for (const person of copy.household.people) delete person.linkedUserId;
  for (const plan of copy.plans) {
    for (const meal of plan.meals) {
      for (const person of meal.cookedSnapshot?.people ?? []) delete person.linkedUserId;
    }
  }
  return copy;
}

export function createBackup(state: AppState, exportedAt = new Date().toISOString()): AppBackup {
  return { format: BACKUP_FORMAT, version: BACKUP_VERSION, exportedAt, state: copyWithoutLinkedAuthIds(state) };
}

export function parseBackup(json: string): AppState {
  let value: unknown;
  try {
    value = JSON.parse(json);
  } catch {
    throw new Error('Filen innehåller inte giltig JSON.');
  }
  if (!isRecord(value) || value['format'] !== BACKUP_FORMAT || value['version'] !== BACKUP_VERSION ||
    typeof value['exportedAt'] !== 'string' || !Number.isFinite(new Date(value['exportedAt']).getTime()) || !isRecord(value['state'])) {
    throw new Error('Filen är inte en säkerhetskopia från Middagstipset i ett format som stöds.');
  }
  const allowedStateKeys = new Set([
    'version', 'household', 'plans', 'favoriteRecipeIds', 'shoppingItems', 'planningDays',
    'customRecipes', 'generationSettings', 'pantryIngredientIds', 'participantPresets', 'lunchPlans',
    'pantryStock', 'deductPantryStock', 'cookBatches',
  ]);
  if (Object.keys(value['state']).some(key => !allowedStateKeys.has(key))) {
    throw new Error('Säkerhetskopian innehåller okända data och kan inte återställas.');
  }
  try {
    return structuredClone(validateState(value['state']));
  } catch (error) {
    throw new Error(error instanceof Error ? `Säkerhetskopian innehåller ogiltiga data: ${error.message}` : 'Säkerhetskopian innehåller ogiltiga data.');
  }
}

export function backupOverview(state: AppState): { people: number; meals: number; recipes: number; lunches: number } {
  return {
    people: state.household.people.length,
    meals: state.plans.reduce((total, plan) => total + plan.meals.length, 0),
    recipes: state.customRecipes?.length ?? 0,
    lunches: state.lunchPlans?.length ?? 0,
  };
}
