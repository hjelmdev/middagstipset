import type { SupabaseClient } from '@supabase/supabase-js';
import type { AppState, CookBatch, LunchPlan, PantryStockItem, ParticipantPreset, Recipe } from '../domain/models';
import { isCalendarDate, lunchSourceId, lunchSourceType, sourceExtraPortions } from '../domain/leftovers.ts';
import { batchLunchCompatibilityError, cookBatchPreparationError } from '../domain/cook-batches.ts';
import { localDate } from '../domain/meal-engine.ts';
export interface StateRepository {
  load(): Promise<AppState | null>;
  save(state: AppState): Promise<void>;
}
export class LocalStateRepository implements StateRepository {
  private readonly key = 'middagstipset.demo.v1';
  async load(): Promise<AppState | null> {
    const saved = localStorage.getItem(this.key);
    if (!saved) return null;
    return validateState(JSON.parse(saved));
  }
  async save(state: AppState): Promise<void> { localStorage.setItem(this.key, JSON.stringify(state)); }
}
export class SupabaseStateRepository implements StateRepository {
  private readonly client: SupabaseClient;
  private readonly userId: string;
  constructor(client: SupabaseClient, userId: string) {
    this.client = client;
    this.userId = userId;
  }
  async load(): Promise<AppState | null> {
    const { data, error } = await this.client.from('households').select('state').eq('owner_id', this.userId).maybeSingle();
    if (error) throw error;
    return data ? validateState(data['state']) : null;
  }
  async save(state: AppState): Promise<void> {
    const { error } = await this.client.from('households').upsert({ owner_id: this.userId, name: state.household.name, state }, { onConflict: 'owner_id' });
    if (error) throw error;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function isOneOf<T extends string>(value: unknown, choices: readonly T[]): value is T {
  return typeof value === 'string' && choices.includes(value as T);
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every(isNonEmptyString);
}

function isLocalImagePath(value: unknown): value is string {
  return typeof value === 'string' && /^\/?images\/(?:[a-z0-9_-]+\/)*[a-z0-9][a-z0-9._-]*\.(?:svg|png|jpe?g|webp)$/i.test(value);
}

function isRecipe(value: unknown, requireCustomId = false): value is Recipe {
  if (!isRecord(value) || !isNonEmptyString(value['id']) || (requireCustomId && !/^custom:[a-z0-9][a-z0-9_-]*$/i.test(value['id'])) ||
    !isNonEmptyString(value['name']) || !isNonEmptyString(value['description']) ||
    !Number.isFinite(value['servings']) || (value['servings'] as number) <= 0 ||
    !Number.isFinite(value['totalMinutes']) || (value['totalMinutes'] as number) <= 0 ||
    !Number.isFinite(value['activeMinutes']) || (value['activeMinutes'] as number) <= 0 || (value['activeMinutes'] as number) > (value['totalMinutes'] as number) ||
    !isOneOf(value['mainIngredient'], ['vegetables', 'fish', 'chicken', 'meat', 'legumes'] as const) ||
    !isStringArray(value['tags']) || !Array.isArray(value['dietaryNeeds']) ||
    !value['dietaryNeeds'].every((need) => isOneOf(need, ['gluten-free', 'vegetarian'] as const)) ||
    !isOneOf(value['glutenStrategy'], ['naturally-free', 'split-component', 'whole-dish', 'unsupported'] as const) ||
    (value['separateGlutenComponents'] !== undefined && !isStringArray(value['separateGlutenComponents'])) ||
    !Array.isArray(value['ingredients']) || value['ingredients'].length === 0 ||
    !Array.isArray(value['steps']) || value['steps'].length === 0 ||
    !isLocalImagePath(value['image']) || !isNonEmptyString(value['imageAlt']) ||
    !isOneOf(value['imageKind'], ['illustration', 'ai-generated', 'photo'] as const) || !isNonEmptyString(value['color'])) return false;

  const ingredientsValid = value['ingredients'].every((ingredient: unknown) => {
    if (!isRecord(ingredient) || !isNonEmptyString(ingredient['id']) || !isNonEmptyString(ingredient['name']) ||
      !Number.isFinite(ingredient['quantity']) || (ingredient['quantity'] as number) <= 0 ||
      !isOneOf(ingredient['unit'], ['g', 'ml', 'st', 'msk', 'tsk'] as const) ||
      !isOneOf(ingredient['category'], ['Grönt', 'Skafferi', 'Mejeri', 'Kött & fisk'] as const) ||
      !isNonEmptyString(ingredient['component']) || !Array.isArray(ingredient['allergens']) ||
      !ingredient['allergens'].every((allergen) => isOneOf(allergen, ['gluten', 'milk', 'egg', 'fish', 'nuts'] as const))) return false;

    if (ingredient['glutenFreeAlternative'] !== undefined &&
      (!isRecord(ingredient['glutenFreeAlternative']) || !isNonEmptyString(ingredient['glutenFreeAlternative']['id']) ||
        !isNonEmptyString(ingredient['glutenFreeAlternative']['name']))) return false;
    return true;
  });
  if (!ingredientsValid) return false;

  const stepsValid = value['steps'].every((step: unknown) => isRecord(step) && isNonEmptyString(step['text']));
  if (!stepsValid) return false;

  return value['glutenStrategy'] !== 'naturally-free' ||
    value['ingredients'].every((ingredient: Record<string, unknown>) =>
      Array.isArray(ingredient['allergens']) && !ingredient['allergens'].includes('gluten'));
}

function isSnapshotPerson(value: unknown): boolean {
  return isRecord(value) && isNonEmptyString(value['id']) && isNonEmptyString(value['name']) &&
    value['name'].trim().length <= 80 && Number.isFinite(value['portionFactor']) &&
    (value['portionFactor'] as number) > 0 && (value['portionFactor'] as number) <= 3 &&
    Array.isArray(value['dietaryNeeds']) && value['dietaryNeeds'].every(need => isOneOf(need, ['gluten-free', 'vegetarian'] as const)) &&
    (value['linkedUserId'] === undefined || typeof value['linkedUserId'] === 'string');
}

function isParticipantPreset(value: unknown, participantIds: ReadonlySet<string>): value is ParticipantPreset {
  return isRecord(value) && isNonEmptyString(value['id']) && isNonEmptyString(value['name']) &&
    value['name'].trim().length <= 80 && Array.isArray(value['participantIds']) && value['participantIds'].length > 0 &&
    value['participantIds'].every((id: unknown) => isNonEmptyString(id) && participantIds.has(id)) &&
    new Set(value['participantIds']).size === value['participantIds'].length;
}

function isLunchPlan(value: unknown, participantIds: ReadonlySet<string>): value is LunchPlan {
  return isRecord(value) && isNonEmptyString(value['id']) && isCalendarDate(value['date']) &&
    ((value['sourceId'] !== undefined && isNonEmptyString(value['sourceId']) && isOneOf(value['sourceType'], ['meal', 'batch'] as const) && value['sourceMealId'] === undefined) ||
      (value['sourceId'] === undefined && value['sourceType'] === undefined && isNonEmptyString(value['sourceMealId']))) &&
    Array.isArray(value['participantIds']) && value['participantIds'].length > 0 &&
    value['participantIds'].every((id: unknown) => isNonEmptyString(id) && participantIds.has(id)) &&
    new Set(value['participantIds']).size === value['participantIds'].length &&
    Number.isFinite(value['portions']) && (value['portions'] as number) > 0 &&
    isOneOf(value['status'], ['planned', 'eaten'] as const) &&
    (value['eatenAt'] === undefined || (typeof value['eatenAt'] === 'string' && Number.isFinite(new Date(value['eatenAt']).getTime()))) &&
    (value['status'] !== 'eaten' || (typeof value['eatenAt'] === 'string' && Number.isFinite(new Date(value['eatenAt']).getTime())));
}

function isCookBatch(value: unknown): value is CookBatch {
  if (!isRecord(value) || typeof value['id'] !== 'string' || !/^batch:[0-9a-f-]{36}$/i.test(value['id']) || !isNonEmptyString(value['recipeId']) ||
    !isCalendarDate(value['date']) || !Number.isFinite(value['portions']) || (value['portions'] as number) <= 0 || (value['portions'] as number) > 120 ||
    !Array.isArray(value['needs']) || value['needs'].some(need => !isOneOf(need, ['gluten-free', 'vegetarian'] as const)) ||
    new Set(value['needs']).size !== value['needs'].length || !isOneOf(value['status'], ['planned', 'prepared'] as const) ||
    !isRecipe(value['recipeSnapshot']) || (value['recipeSnapshot'] as Recipe).id !== value['recipeId'] ||
    (value['pantryUsed'] !== undefined && (!Array.isArray(value['pantryUsed']) || !value['pantryUsed'].every(isPantryStockItem)))) return false;
  if (cookBatchPreparationError(value['recipeSnapshot'] as Recipe, value['needs'] as CookBatch['needs'])) return false;
  if (value['status'] === 'prepared') return typeof value['preparedAt'] === 'string' && Number.isFinite(new Date(value['preparedAt']).getTime());
  return value['preparedAt'] === undefined && value['pantryUsed'] === undefined;
}

function isPantryStockItem(value: unknown): value is PantryStockItem {
  return isRecord(value) && isNonEmptyString(value['ingredientId']) && isNonEmptyString(value['name']) &&
    isOneOf(value['category'], ['Grönt', 'Skafferi', 'Mejeri', 'Kött & fisk'] as const) &&
    Number.isFinite(value['quantity']) && (value['quantity'] as number) > 0 &&
    isOneOf(value['unit'], ['g', 'ml', 'st', 'msk', 'tsk'] as const);
}

function isShoppingItem(value: unknown): boolean {
  return isRecord(value) && isNonEmptyString(value['id']) && isNonEmptyString(value['ingredientId']) && isNonEmptyString(value['name']) &&
    Number.isFinite(value['quantity']) && (value['quantity'] as number) > 0 &&
    isOneOf(value['unit'], ['g', 'ml', 'st', 'msk', 'tsk'] as const) &&
    isOneOf(value['category'], ['Grönt', 'Skafferi', 'Mejeri', 'Kött & fisk'] as const) &&
    isOneOf(value['source'], ['recipe', 'manual'] as const) && typeof value['checked'] === 'boolean' &&
    (value['weekStart'] === undefined || isCalendarDate(value['weekStart'])) &&
    (value['rangeKey'] === undefined || (typeof value['rangeKey'] === 'string' && (() => {
      const match = /^(\d{4}-\d{2}-\d{2}):(\d{1,2})$/.exec(value['rangeKey'] as string);
      return !!match && isCalendarDate(match[1]) && Number(match[2]) >= 1 && Number(match[2]) <= 28;
    })()));
}

export function validateState(value: unknown): AppState {
  const state = value as AppState;
  if (!state || state.version !== 1 || !state.household || typeof state.household.id !== 'string' ||
    typeof state.household.name !== 'string' || !Array.isArray(state.household.people) ||
    !Array.isArray(state.plans) || !isStringArray(state.favoriteRecipeIds) || !Array.isArray(state.shoppingItems) || !state.shoppingItems.every(isShoppingItem)) {
    throw new Error('Lagrade data har ett format som appen inte kan läsa.');
  }
  if (state.generationSettings !== undefined) {
    const settings = state.generationSettings as unknown;
    if (!isRecord(settings) || typeof settings['vegetarianOnly'] !== 'boolean' || typeof settings['favoritesOnly'] !== 'boolean' ||
      !(settings['maxMinutes'] === null || (Number.isInteger(settings['maxMinutes']) && (settings['maxMinutes'] as number) > 0))) {
      throw new Error('Ogiltiga filter för receptförslag.');
    }
  }
  if (state.pantryIngredientIds !== undefined && !isStringArray(state.pantryIngredientIds)) {
    throw new Error('Ogiltiga ingredienser i skafferiet.');
  }
  if (state.pantryStock !== undefined && (!Array.isArray(state.pantryStock) || !state.pantryStock.every(isPantryStockItem) ||
    new Set(state.pantryStock.map(item => `${item.ingredientId}:${item.unit}`)).size !== state.pantryStock.length)) {
    throw new Error('Ogiltiga mängder i skafferiet.');
  }
  if (state.deductPantryStock !== undefined && typeof state.deductPantryStock !== 'boolean') {
    throw new Error('Ogiltig inställning för avräkning från skafferiet.');
  }
  if (state.cookBatches !== undefined && (!Array.isArray(state.cookBatches) || !state.cookBatches.every(isCookBatch) ||
    new Set(state.cookBatches.map(batch => batch.id)).size !== state.cookBatches.length)) {
    throw new Error('Ogiltiga storkok.');
  }
  if (state.customRecipes !== undefined && (!Array.isArray(state.customRecipes) || !state.customRecipes.every(recipe => isRecipe(recipe, true)) ||
    new Set(state.customRecipes.map((recipe) => recipe.id)).size !== state.customRecipes.length)) {
    throw new Error('Ogiltiga egna recept.');
  }
  for (const person of state.household.people) {
    if (!person || typeof person.id !== 'string' || typeof person.name !== 'string' ||
      !Number.isFinite(person.portionFactor) || person.portionFactor <= 0 || !Array.isArray(person.dietaryNeeds) ||
      person.dietaryNeeds.some(need => !['gluten-free', 'vegetarian'].includes(need))) throw new Error('Ogiltiga hushållsdata.');
  }
  if (state.participantPresets !== undefined) {
    const participantIds = new Set(state.household.people.map(person => person.id));
    if (!Array.isArray(state.participantPresets) || !state.participantPresets.every(preset => isParticipantPreset(preset, participantIds)) ||
      new Set(state.participantPresets.map(preset => preset.id)).size !== state.participantPresets.length) {
      throw new Error('Ogiltiga sparade sällskap.');
    }
  }
  if (state.planningDays !== undefined && (!Number.isInteger(state.planningDays) || state.planningDays < 1 || state.planningDays > 28)) throw new Error('Ogiltig planeringsperiod.');
  const sourceMeals = new Map<string, AppState['plans'][number]['meals'][number]>();
  const sourceBatches = new Map<string, CookBatch>();
  const statePeopleIds = new Set(state.household.people.map(person => person.id));
  for (const plan of state.plans) {
    if (!plan || typeof plan.weekStart !== 'string' || !Array.isArray(plan.meals)) throw new Error('Ogiltig veckoplan.');
    for (const meal of plan.meals) {
      if (!meal || typeof meal.id !== 'string' || !isCalendarDate(meal.date) ||
        !isStringArray(meal.participantIds) || !Number.isFinite(meal.extraPortions) || meal.extraPortions < 0 ||
        !Number.isFinite(meal.maxMinutes) || meal.maxMinutes <= 0 || typeof meal.locked !== 'boolean' ||
        !['planned', 'cooked'].includes(meal.status) || (meal.recipeId !== null && typeof meal.recipeId !== 'string')) throw new Error('Ogiltig måltid.');
      if (meal.cookedSnapshot !== undefined) {
        const snapshot = meal.cookedSnapshot as unknown;
        if (!isRecord(snapshot) || !isNonEmptyString(snapshot['recipeName']) || !isNonEmptyString(snapshot['image']) ||
          !isNonEmptyString(snapshot['imageAlt']) || !Number.isFinite(snapshot['portions']) || (snapshot['portions'] as number) < 0 ||
          (snapshot['recipe'] !== undefined && !isRecipe(snapshot['recipe'])) ||
          (snapshot['people'] !== undefined && (!Array.isArray(snapshot['people']) || !snapshot['people'].every(isSnapshotPerson))) ||
          (snapshot['extraPortions'] !== undefined && (!Number.isInteger(snapshot['extraPortions']) ||
            (snapshot['extraPortions'] as number) < 0 || (snapshot['extraPortions'] as number) > 12)) ||
          (snapshot['pantryUsed'] !== undefined && (!Array.isArray(snapshot['pantryUsed']) || !snapshot['pantryUsed'].every(isPantryStockItem)))) {
          throw new Error('Ogiltig middagshistorik.');
        }
      }
      if (sourceMeals.has(meal.id)) throw new Error('Middagar och storkok måste ha unika käll-id:n.');
      sourceMeals.set(meal.id, meal);
    }
  }
  for (const batch of state.cookBatches ?? []) {
    if (sourceMeals.has(batch.id)) throw new Error('Storkok och middagar måste ha unika käll-id:n.');
    sourceBatches.set(batch.id, batch);
  }
  if (state.cookBatches && new Set([...sourceMeals.keys(), ...sourceBatches.keys()]).size !== sourceMeals.size + sourceBatches.size) {
    throw new Error('Storkok och middagar måste ha unika käll-id:n.');
  }
  if (state.lunchPlans !== undefined) {
    if (!Array.isArray(state.lunchPlans) || !state.lunchPlans.every(lunch => isLunchPlan(lunch, statePeopleIds)) ||
      new Set(state.lunchPlans.map(lunch => lunch.id)).size !== state.lunchPlans.length) {
      throw new Error('Ogiltiga lunchplaner.');
    }
    const reserved = new Map<string, number>();
    for (const lunch of state.lunchPlans) {
      const sourceId = lunchSourceId(lunch);
      const sourceType = lunchSourceType(lunch);
      if (sourceType === 'batch') {
        const batch = sourceBatches.get(sourceId);
        if (!batch || (batch.status === 'prepared' ? localDate(new Date(batch.preparedAt!)) : batch.date) > lunch.date || batch.portions <= 0) throw new Error('Ogiltig lunchkälla.');
        if (lunch.status === 'eaten' && batch.status !== 'prepared') throw new Error('En uppäten lunch kräver ett tillagat storkok.');
        if (lunch.status === 'eaten' && new Date(lunch.eatenAt!).getTime() < new Date(batch.preparedAt!).getTime()) throw new Error('Lunchens ät-tid kan inte ligga före tillagningen.');
        const lunchPeople = state.household.people.filter(person => lunch.participantIds.includes(person.id));
        if (batchLunchCompatibilityError(batch, lunchPeople)) throw new Error('Storkoket uppfyller inte kostbehoven för lunchreservationen.');
        const key = `batch\u0000${batch.id}`;
        reserved.set(key, (reserved.get(key) ?? 0) + lunch.portions);
      } else {
        const source = sourceMeals.get(sourceId);
        if (!source || !source.recipeId || source.date > lunch.date || sourceExtraPortions(source) <= 0) throw new Error('Ogiltig lunchkälla.');
        if (lunch.status === 'eaten' && source.status !== 'cooked') throw new Error('En uppäten lunch kräver en lagad middagskälla.');
        const key = `meal\u0000${source.id}`;
        reserved.set(key, (reserved.get(key) ?? 0) + lunch.portions);
      }
    }
    for (const [sourceKey, portions] of reserved) {
      const [kind, sourceId] = sourceKey.split('\u0000', 2);
      const capacity = kind === 'batch' ? sourceBatches.get(sourceId)!.portions : sourceExtraPortions(sourceMeals.get(sourceId)!);
      if (portions > capacity + 0.000001) throw new Error('Lunchplanerna överskrider middagens extra portioner eller storkokets kapacitet.');
    }
  }
  return state;
}
