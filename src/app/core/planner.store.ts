import { computed, DestroyRef, effect, inject, Injectable, signal } from '@angular/core';
import type { AppState, CookBatch, DietaryNeed, GenerationSettings, Ingredient, LunchPlan, MealPlan, PantryStockItem, ParticipantPreset, Person, PlannedMeal, Recipe, ShoppingItem } from '../domain/models';
import { localDate, replaceMeal, buildShoppingList, portionCount, scaleIngredients, supportsNeeds } from '../domain/meal-engine';
import { clampPlanningDays, fillMissingMeals, mealsByDate, mergeMeals, planningWindow } from '../domain/rolling-plan';
import { mealHistory } from '../domain/history';
import { RECIPES } from '../data/recipes';
import { filterRecipes } from '../domain/generation-settings';
import { AuthService } from './auth.service';
import { replaceShoppingRange, shoppingForRange } from '../domain/shopping';
import { buildLunchSources, isCalendarDate, lunchCompatibilityError, lunchEatenError, lunchSourceId, lunchSourcePeople, lunchSourceRecipe, lunchSourceType, portionNeed, plannedLunchShoppingMeals, reservedPortions, sourceExtraPortions, sourceReservationMutationError } from '../domain/leftovers';
import { allocatePantryStock, applyPantryStock, restorePantryStock } from '../domain/pantry-stock';
import { batchLunchCompatibilityError, cookBatchAvailableDate, cookBatchEatenError, cookBatchIngredients, cookBatchPreparationError, cookBatchPrepareReservationError, cookBatchRemovalError, cookBatchShoppingItems, cookBatchUndoError, createCookBatchRecord, plannedCookBatchShopping } from '../domain/cook-batches';
import { clearPlannedMeals, restoreClearedMeals, type ClearedMealsCheckpoint } from '../domain/meal-clearing';
import { LocalStateRepository, SupabaseStateRepository, validateState, type StateRepository } from './state.repository';

export function initialState(): AppState {
  return { version: 1, household: { id: crypto.randomUUID(), name: 'Mitt hushåll', people: [{ id: crypto.randomUUID(), name: 'Jag', portionFactor: 1, dietaryNeeds: [] }] }, plans: [], favoriteRecipeIds: [], shoppingItems: [] };
}
@Injectable({ providedIn: 'root' })
export class PlannerStore {
  readonly auth = inject(AuthService);
  readonly state = signal<AppState | null>(null);
  readonly loading = signal(true);
  readonly error = signal('');
  readonly storageNotice = signal('');
  readonly actionNotice = signal('');
  readonly pendingClearedMeals = signal<ClearedMealsCheckpoint | null>(null);
  readonly pendingClearedMealCount = computed(() => this.pendingClearedMeals()?.original.length ?? 0);
  readonly saving = signal(false);
  readonly todayDate = signal(localDate());
  readonly planningDays = computed(() => clampPlanningDays(this.state()?.planningDays ?? 7));
  get recipes(): Recipe[] { return [...RECIPES, ...(this.state()?.customRecipes ?? [])]; }
  readonly generationSettings = computed<GenerationSettings>(() => this.state()?.generationSettings ?? { vegetarianOnly: false, favoritesOnly: false, maxMinutes: null });
  readonly eligibleRecipes = computed(() => filterRecipes(this.recipes, this.state()?.favoriteRecipeIds ?? [], this.generationSettings()));
  readonly allMeals = computed(() => mealsByDate(this.state()?.plans ?? []));
  readonly lunchPlans = computed(() => this.state()?.lunchPlans ?? []);
  readonly cookBatches = computed(() => this.state()?.cookBatches ?? []);
  readonly lunchSources = computed(() => buildLunchSources(this.allMeals(), this.recipes, this.state()?.household.people ?? [], this.lunchPlans(), this.cookBatches()));
  readonly pantryStock = computed(() => this.state()?.pantryStock ?? []);
  readonly deductPantryStock = computed(() => this.state()?.deductPantryStock ?? false);
  readonly plan = computed(() => {
    const state = this.state();
    return planningWindow(state?.plans ?? [], this.todayDate(), this.planningDays(), state?.household.people ?? []);
  });
  readonly today = computed(() => this.plan().meals[0]);
  readonly history = computed(() => mealHistory(this.allMeals(), this.recipes, this.state()?.household.people ?? [], this.todayDate()));
  readonly incompatibleMeals = computed(() => this.plan().meals.filter(meal => {
    const recipe = this.recipe(meal.recipeId);
    return recipe && meal.status !== 'cooked' && !supportsNeeds(recipe, (this.state()?.household.people ?? []).filter(person => meal.participantIds.includes(person.id)));
  }));
  private shoppingPlan(plan: MealPlan, state: AppState): MealPlan {
    const allMeals = mealsByDate(state.plans);
    const lunchSources = plannedLunchShoppingMeals(state.lunchPlans ?? [], allMeals, this.todayDate(), clampPlanningDays(state.planningDays ?? 7), this.todayDate());
    const sourceIdsInRange = new Set(plan.meals.map(meal => meal.id));
    const withLunchSources = [...plan.meals, ...lunchSources.filter(meal => !sourceIdsInRange.has(meal.id))];
    return { ...plan, meals: withLunchSources.filter(meal => {
      const recipe = this.recipe(meal.recipeId);
      return !recipe || supportsNeeds(recipe, state.household.people.filter(person => meal.participantIds.includes(person.id)));
    }) };
  }
  private shoppingListFor(state: AppState, plan: MealPlan, previous: ShoppingItem[]): ShoppingItem[] {
    const raw = buildShoppingList(this.shoppingPlan(plan, state), this.recipes, state.household.people, previous.filter(item => item.source === 'manual'));
    const batches = plannedCookBatchShopping(state.cookBatches ?? [], state.lunchPlans ?? [], this.todayDate(), clampPlanningDays(state.planningDays ?? 7), this.todayDate());
    const summed = new Map(raw.filter(item => item.source === 'recipe').map(item => [item.id, { ...item }]));
    for (const item of cookBatchShoppingItems(batches, this.todayDate())) {
      const existing = summed.get(item.id);
      if (existing) existing.quantity += item.quantity;
      else summed.set(item.id, item);
    }
    const combined = [...summed.values(), ...raw.filter(item => item.source === 'manual')];
    return applyPantryStock(combined, state.pantryStock ?? [], state.deductPantryStock ?? false, previous);
  }
  private replacePantryStock(state: AppState, pantryStock: PantryStockItem[]): AppState {
    const previousStockIds = new Set((state.pantryStock ?? []).map(item => item.ingredientId));
    const nextStockIds = new Set(pantryStock.map(item => item.ingredientId));
    const legacyIds = (state.pantryIngredientIds ?? []).filter(id => !previousStockIds.has(id) || nextStockIds.has(id));
    return { ...state, pantryStock, pantryIngredientIds: [...new Set([...legacyIds, ...nextStockIds])] };
  }
  readonly shoppingItems = computed(() => {
    const state = this.state();
    return state ? this.shoppingListFor(state, this.plan(), shoppingForRange(state.shoppingItems, this.todayDate(), this.planningDays())) : [];
  });
  private repository: StateRepository | null = null;
  private generation = 0;
  private queue: Promise<void> = Promise.resolve();
  private pendingSaves = 0;
  constructor() {
    const timer = window.setInterval(() => this.refreshToday(), 60_000);
    inject(DestroyRef).onDestroy(() => window.clearInterval(timer));
    effect(() => {
      if (!this.auth.ready()) return;
      const user = this.auth.user();
      const repo = user && this.auth.client ? new SupabaseStateRepository(this.auth.client, user.id) : new LocalStateRepository();
      void this.load(repo);
    });
  }
  async load(repository: StateRepository): Promise<void> {
    const generation = ++this.generation;
    this.pendingClearedMeals.set(null);
    this.loading.set(true); this.state.set(null); this.error.set(''); this.storageNotice.set('');
    this.pendingSaves = 0; this.saving.set(false);
    this.repository = repository;
    try {
      const state = await repository.load();
      if (generation === this.generation) {
        // Assign legacy checklist rows to the last plan used before week-specific lists.
        if (state) state.shoppingItems = state.shoppingItems.map(item => item.source === 'recipe' && !item.weekStart ? { ...item, weekStart: state.plans.at(-1)?.weekStart } : item);
        this.state.set(state ?? initialState());
      }
    } catch { if (generation === this.generation) this.error.set('Dina sparade data kunde inte läsas. Försök igen; befintliga data skrivs inte över.'); }
    finally { if (generation === this.generation) this.loading.set(false); }
  }
  retry(): void { if (this.repository) void this.load(this.repository); }
  restoreBackup(state: AppState): void {
    this.actionNotice.set('');
    this.pendingClearedMeals.set(null);
    const restored = structuredClone(validateState(state));
    this.update(() => restored);
  }
  private update(mutator: (state: AppState) => AppState): void {
    const previous = this.state(); if (!previous || this.loading()) return;
    const next = mutator(previous); this.state.set(next); this.persist(next);
  }
  private persist(state: AppState): void {
    const repo = this.repository; const generation = this.generation;
    if (!repo) return;
    this.saving.set(true);
    this.pendingSaves++;
    this.queue = this.queue.catch(() => {}).then(async () => {
      try { await repo.save(state); if (generation === this.generation) this.storageNotice.set(''); }
      catch { if (generation === this.generation) this.storageNotice.set('Ändringen finns på skärmen men kunde inte sparas. Försök spara igen innan du lämnar sidan.'); }
    }).finally(() => { if (generation === this.generation) this.saving.set(--this.pendingSaves > 0); });
  }
  saveAgain(): void { const state = this.state(); if (state) this.persist(state); }
  async flush(): Promise<void> {
    await this.queue;
    if (this.storageNotice()) throw new Error('Det finns ändringar som ännu inte har sparats.');
  }
  recipe(id: string | null): Recipe | undefined { return this.recipes.find(r => r.id === id); }
  refreshToday(): void { this.todayDate.set(localDate()); }
  setPlanningDays(days: number): void {
    this.update(state => ({ ...state, planningDays: clampPlanningDays(days) }));
  }
  private savePlan(plan: MealPlan, pantryStock?: PantryStockItem[]): void {
    this.update(state => {
      const plans = mergeMeals(state.plans, plan.meals);
      const windowPlan = planningWindow(plans, this.todayDate(), this.planningDays(), state.household.people);
      const next = pantryStock ? this.replacePantryStock({ ...state, plans }, pantryStock) : { ...state, plans };
      const previous = shoppingForRange(state.shoppingItems, this.todayDate(), this.planningDays());
      return { ...next, shoppingItems: replaceShoppingRange(state.shoppingItems,
        this.shoppingListFor(next, windowPlan, previous), this.todayDate(), this.planningDays()) };
    });
  }
  clearMeals(ids: string[]): string {
    this.actionNotice.set('');
    if (!this.state()) return this.setLunchError('Planen är inte laddad ännu.');
    const reservedMealIds = new Set((this.state()?.lunchPlans ?? [])
      .filter(lunch => lunchSourceType(lunch) === 'meal')
      .map(lunch => lunchSourceId(lunch)));
    const result = clearPlannedMeals(this.plan().meals, ids, reservedMealIds);
    if (!result.checkpoint) return this.setLunchError(result.error);
    this.savePlan({ weekStart: this.plan().weekStart, meals: result.checkpoint.cleared });
    this.pendingClearedMeals.set(result.checkpoint);
    return '';
  }
  undoClearMeals(): string {
    this.actionNotice.set('');
    const state = this.state();
    const checkpoint = this.pendingClearedMeals();
    if (!state) return this.setLunchError('Planen är inte laddad ännu.');
    if (!checkpoint) return this.setLunchError('Det finns ingen nyligen tömd middag att återställa.');
    const result = restoreClearedMeals(this.allMeals(), checkpoint);
    if (!result.meals) return this.setLunchError(result.error);
    const restoredIds = new Set(result.meals.map(meal => meal.id));
    if ((state.lunchPlans ?? []).some(lunch => lunchSourceType(lunch) === 'meal' && restoredIds.has(lunchSourceId(lunch)))) {
      return this.setLunchError('Återställningen avbröts eftersom en tömd middag nu används som lunchkälla.');
    }
    for (const meal of result.meals) {
      const recipe = this.recipe(meal.recipeId);
      const eaters = state.household.people.filter(person => meal.participantIds.includes(person.id));
      if (!recipe || eaters.length !== meal.participantIds.length || !supportsNeeds(recipe, eaters)) {
        return this.setLunchError('Återställningen avbröts eftersom en middag inte längre passar recept eller aktuella kostbehov.');
      }
    }
    this.savePlan({ weekStart: this.todayDate(), meals: result.meals });
    this.pendingClearedMeals.set(null);
    return '';
  }
  generate(): { added: number; missing: number } {
    const state = this.state(); if (!state) return { added: 0, missing: 0 };
    this.refreshToday();
    const previous = this.plan();
    const history = this.allMeals().filter(meal => meal.date < this.todayDate()).map(meal => meal.recipeId).filter((id): id is string => !!id);
    const next = fillMissingMeals(previous, this.eligibleRecipes(), state.household.people, state.favoriteRecipeIds, history);
    const added = next.meals.filter(meal => !!meal.recipeId && !previous.meals.find(old => old.date === meal.date)?.recipeId).length;
    this.savePlan(next);
    return { added, missing: next.meals.filter(meal => !meal.recipeId).length };
  }
  private reservationError(source: PlannedMeal, updated: PlannedMeal): string {
    const state = this.state();
    if (!state) return 'Planen är inte laddad ännu.';
    const reservations = (state.lunchPlans ?? []).filter(lunch => lunchSourceType(lunch) === 'meal' && lunchSourceId(lunch) === source.id);
    const recipe = lunchSourceRecipe(updated, this.recipes);
    const sourcePeople = lunchSourcePeople(updated, state.household.people);
    return sourceReservationMutationError(source, updated, reservations, recipe, sourcePeople, state.household.people);
  }

  private personChangeError(person: Person): string {
    const state = this.state();
    if (!state) return '';
    const existing = state.household.people.find(candidate => candidate.id === person.id);
    if (!existing || existing.dietaryNeeds.join('|') === person.dietaryNeeds.join('|')) return '';
    const nextPeople = state.household.people.map(candidate => candidate.id === person.id ? person : candidate);
    for (const lunch of state.lunchPlans ?? []) {
      if (lunch.status !== 'planned') continue;
      if (lunchSourceType(lunch) === 'batch') {
        if (!lunch.participantIds.includes(person.id)) continue;
        const batch = (state.cookBatches ?? []).find(candidate => candidate.id === lunchSourceId(lunch));
        if (!batch) continue;
        const lunchPeople = nextPeople.filter(candidate => lunch.participantIds.includes(candidate.id));
        const error = batchLunchCompatibilityError(batch, lunchPeople);
        if (error) return `Personens kostbehov skulle göra en planerad lunch olämplig. ${error}`;
        continue;
      }
      const source = this.allMeals().find(meal => meal.id === lunchSourceId(lunch));
      if (!source) continue;
      if (!lunch.participantIds.includes(person.id) && !(source.status !== 'cooked' && source.participantIds.includes(person.id))) continue;
      const recipe = lunchSourceRecipe(source, this.recipes);
      if (!recipe) continue;
      const sourcePeople = source.status === 'cooked' && source.cookedSnapshot?.people
        ? source.cookedSnapshot.people
        : nextPeople.filter(candidate => source.participantIds.includes(candidate.id));
      if ((!source.cookedSnapshot?.people || source.status !== 'cooked') && source.participantIds.includes(person.id) && !supportsNeeds(recipe, sourcePeople)) {
        return 'Personens kostbehov skulle göra middagen som lunchlådans källa olämplig.';
      }
      const lunchPeople = nextPeople.filter(candidate => lunch.participantIds.includes(candidate.id));
      const error = lunchCompatibilityError(recipe, sourcePeople, lunchPeople, source);
      if (error) return `Personens kostbehov skulle göra en planerad lunch olämplig. ${error}`;
    }
    return '';
  }

  private recipeChangeError(recipe: Recipe): string {
    const state = this.state();
    if (!state) return '';
    const recipes = [...RECIPES, ...(state.customRecipes ?? []).filter(saved => saved.id !== recipe.id), recipe];
    for (const lunch of state.lunchPlans ?? []) {
      if (lunch.status !== 'planned') continue;
      const source = this.allMeals().find(meal => meal.id === lunchSourceId(lunch));
      if (!source || source.recipeId !== recipe.id || (source.status === 'cooked' && source.cookedSnapshot?.recipe)) continue;
      const sourcePeople = lunchSourcePeople(source, state.household.people);
      if (!supportsNeeds(recipe, sourcePeople)) return 'Receptändringen passar inte längre kostbehoven för middag och lunchkälla.';
      const lunchPeople = state.household.people.filter(person => lunch.participantIds.includes(person.id));
      const error = lunchCompatibilityError(recipe, sourcePeople, lunchPeople, source);
      if (error) return `Receptet används som lunchkälla. Ändringen skulle göra en planerad lunch olämplig. ${error}`;
    }
    return '';
  }

  createCookBatch(recipeId: string, date: string, portions: number, needs: DietaryNeed[]): string {
    this.actionNotice.set('');
    if (!this.state()) return this.setLunchError('Planen är inte laddad ännu.');
    const recipe = this.recipe(recipeId);
    if (!recipe) return this.setLunchError('Välj ett recept som finns i receptsamlingen.');
    let batch: CookBatch;
    try {
      batch = createCookBatchRecord(recipe, `batch:${crypto.randomUUID()}`, date, portions, needs);
    } catch (error) {
      return this.setLunchError(error instanceof Error ? error.message : 'Storkoket kunde inte skapas.');
    }
    this.update(state => this.withCurrentShopping({ ...state, cookBatches: [...(state.cookBatches ?? []), batch] }));
    return '';
  }

  markCookBatchPrepared(id: string): string {
    this.actionNotice.set('');
    const batch = this.cookBatches().find(item => item.id === id);
    if (!batch) return this.setLunchError('Storkoket hittades inte.');
    if (batch.status !== 'planned') return this.setLunchError('Storkoket är redan markerat som tillagat.');
    const reservationError = cookBatchPrepareReservationError(batch, this.lunchPlans(), this.todayDate());
    if (reservationError) return this.setLunchError(reservationError);
    const error = cookBatchPreparationError(batch.recipeSnapshot, batch.needs);
    if (error) return this.setLunchError(error);
    const allocation = allocatePantryStock(this.pantryStock(), cookBatchIngredients(batch));
    this.update(state => {
      const updatedBatch: CookBatch = { ...batch, status: 'prepared', preparedAt: new Date().toISOString(), pantryUsed: allocation.used };
      const pantryState = this.replacePantryStock(state, allocation.stock);
      return this.withCurrentShopping({ ...pantryState,
        cookBatches: (state.cookBatches ?? []).map(item => item.id === id ? updatedBatch : item) });
    });
    return '';
  }

  undoCookBatchPrepared(id: string): string {
    this.actionNotice.set('');
    const batch = this.cookBatches().find(item => item.id === id);
    if (!batch) return this.setLunchError('Storkoket hittades inte.');
    const error = cookBatchUndoError(batch, this.lunchPlans());
    if (error) return this.setLunchError(error);
    const pantryStock = restorePantryStock(this.pantryStock(), batch.pantryUsed ?? []);
    this.update(state => {
      const { preparedAt: _preparedAt, pantryUsed: _pantryUsed, ...planned } = batch;
      const pantryState = this.replacePantryStock(state, pantryStock);
      return this.withCurrentShopping({ ...pantryState,
        cookBatches: (state.cookBatches ?? []).map(item => item.id === id ? { ...planned, status: 'planned' as const } : item) });
    });
    return '';
  }

  removeCookBatch(id: string): string {
    this.actionNotice.set('');
    const batch = this.cookBatches().find(item => item.id === id);
    if (!batch) return this.setLunchError('Storkoket hittades inte.');
    const error = cookBatchRemovalError(batch, this.lunchPlans());
    if (error) return this.setLunchError(error);
    this.update(state => this.withCurrentShopping({ ...state, cookBatches: (state.cookBatches ?? []).filter(item => item.id !== id) }));
    return '';
  }

  planLunch(date: string, sourceId: string, participantIds: string[]): string {
    this.actionNotice.set('');
    const state = this.state();
    if (!state) return this.setLunchError('Planen är inte laddad ännu.');
    if (!isCalendarDate(date)) return this.setLunchError('Välj ett giltigt lunchdatum.');
    const mealSource = this.allMeals().find(meal => meal.id === sourceId);
    const batchSource = (state.cookBatches ?? []).find(batch => batch.id === sourceId);
    if (mealSource && batchSource) return this.setLunchError('Källans id är tvetydigt. Välj en annan lunchkälla.');
    const source = mealSource;
    const batch = batchSource;
    if ((!source || !source.recipeId) && !batch) return this.setLunchError('Välj en middag eller ett storkok som lunchkälla.');
    const sourceDate = source?.date ?? cookBatchAvailableDate(batch!);
    if (sourceDate > date) return this.setLunchError('Lunchdatumet måste vara samma dag som eller efter tillagningen.');
    const capacity = source ? sourceExtraPortions(source) : batch!.portions;
    const alreadyReserved = reservedPortions(state.lunchPlans ?? [], sourceId, batch ? 'batch' : 'meal');
    if (capacity <= 0) return this.setLunchError('Middagen har inga extra portioner att reservera.');
    const ids = [...new Set(participantIds)];
    if (!ids.length || ids.some(id => !state.household.people.some(person => person.id === id))) {
      return this.setLunchError('Välj minst en person som finns i hushållet.');
    }
    const people = state.household.people.filter(person => ids.includes(person.id));
    const portions = portionNeed(ids, state.household.people);
    if (!Number.isFinite(portions) || portions <= 0) return this.setLunchError('Valda personer behöver en giltig portionsstorlek.');
    if (alreadyReserved + portions > capacity + 0.000001) {
      return this.setLunchError(`Det finns bara ${Math.max(0, capacity - alreadyReserved)} portioner kvar från den middagen.`);
    }
    const recipe = batch?.recipeSnapshot ?? lunchSourceRecipe(source!, this.recipes);
    if (!recipe) return this.setLunchError('Receptet för lunchkällan finns inte längre.');
    const compatibilityError = batch
      ? batchLunchCompatibilityError(batch, people)
      : lunchCompatibilityError(recipe, lunchSourcePeople(source!, state.household.people), people, source);
    if (compatibilityError) return this.setLunchError(compatibilityError);
    const lunch: LunchPlan = { id: crypto.randomUUID(), date, sourceType: batch ? 'batch' : 'meal', sourceId,
      participantIds: ids, portions, status: 'planned' };
    this.update(current => this.withCurrentShopping({ ...current, lunchPlans: [...(current.lunchPlans ?? []), lunch] }));
    return '';
  }

  private setLunchError(message: string): string {
    this.actionNotice.set(message);
    return message;
  }

  removeLunch(id: string): string {
    this.actionNotice.set('');
    const lunch = this.lunchPlans().find(item => item.id === id);
    if (!lunch) return this.setLunchError('Lunchplanen hittades inte.');
    if (lunch.status !== 'planned') return this.setLunchError('En lunch som redan markerats som uppäten kan inte tas bort.');
    this.update(state => this.withCurrentShopping({ ...state, lunchPlans: (state.lunchPlans ?? []).filter(item => item.id !== id) }));
    return '';
  }

  markLunchEaten(id: string): string {
    this.actionNotice.set('');
    const lunch = this.lunchPlans().find(item => item.id === id);
    if (!lunch) return this.setLunchError('Lunchplanen hittades inte.');
    if (lunch.status !== 'planned') return this.setLunchError('Lunchen är redan markerad som uppäten.');
    if (lunch.date > this.todayDate()) return this.setLunchError('En lunch kan markeras som uppäten först på lunchdagen.');
    const statePeople = this.state()?.household.people ?? [];
    const lunchPeople = statePeople.filter(person => lunch.participantIds.includes(person.id));
    if (lunchPeople.length !== lunch.participantIds.length) return this.setLunchError('En person i lunchplanen finns inte längre i hushållet.');
    if (lunchSourceType(lunch) === 'batch') {
      const batch = this.cookBatches().find(candidate => candidate.id === lunchSourceId(lunch));
      const compatibilityError = cookBatchEatenError(batch, lunchPeople);
      if (compatibilityError) return this.setLunchError(compatibilityError);
    } else {
      const source = this.allMeals().find(meal => meal.id === lunchSourceId(lunch));
      const recipe = source ? lunchSourceRecipe(source, this.recipes) : undefined;
      const sourcePeople = source ? lunchSourcePeople(source, statePeople) : [];
      const compatibilityError = lunchEatenError(source, recipe, sourcePeople, lunchPeople);
      if (compatibilityError) return this.setLunchError(compatibilityError);
    }
    this.update(state => this.withCurrentShopping({ ...state, lunchPlans: (state.lunchPlans ?? []).map(item => item.id === id
      ? { ...item, status: 'eaten', eatenAt: new Date().toISOString() } : item) }));
    return '';
  }

  undoLunchEaten(id: string): void {
    this.actionNotice.set('');
    if (!this.lunchPlans().some(item => item.id === id && item.status === 'eaten')) return;
    this.update(state => this.withCurrentShopping({ ...state, lunchPlans: (state.lunchPlans ?? []).map(item => {
      if (item.id !== id) return item;
      const { eatenAt: _eatenAt, ...planned } = item;
      return { ...planned, status: 'planned' as const };
    }) }));
  }

  changeMeal(id: string, patch: Partial<PlannedMeal>): void {
    this.actionNotice.set('');
    const meal = this.plan().meals.find(m => m.id === id) ?? this.allMeals().find(m => m.id === id);
    if (!meal) return;
    const updated = { ...meal, ...patch };
    let pantryStock = this.pantryStock();
    if (patch.status === 'cooked' && meal.status !== 'cooked') {
      const recipe = this.recipe(meal.recipeId);
      if (!recipe || !supportsNeeds(recipe, (this.state()?.household.people ?? []).filter(person => meal.participantIds.includes(person.id)))) return;
      const selectedPeople = (this.state()?.household.people ?? []).filter(p => meal.participantIds.includes(p.id));
      const allocation = allocatePantryStock(pantryStock, scaleIngredients(recipe, selectedPeople, meal.extraPortions));
      pantryStock = allocation.stock;
      updated.cookedSnapshot = { recipeName: recipe.name, image: recipe.image, imageAlt: recipe.imageAlt,
        portions: portionCount(selectedPeople, meal.extraPortions), recipe: structuredClone(recipe),
        people: structuredClone(selectedPeople), extraPortions: meal.extraPortions, pantryUsed: structuredClone(allocation.used) };
    } else if (patch.status === 'planned' && meal.status === 'cooked') {
      if (meal.cookedSnapshot?.pantryUsed?.length) pantryStock = restorePantryStock(pantryStock, meal.cookedSnapshot.pantryUsed);
      updated.cookedSnapshot = undefined;
    }
    const reservationError = this.reservationError(meal, updated);
    if (reservationError) { this.actionNotice.set(reservationError); return; }
    this.savePlan({ weekStart: updated.date, meals: [updated] }, pantryStock);
  }
  swap(id: string): boolean {
    const state = this.state(); if (!state) return false;
    const plan = this.plan();
    const meal = plan.meals.find(candidate => candidate.id === id); if (!meal) return false;
    const replacement = replaceMeal(meal, this.eligibleRecipes(), state.household.people, plan.meals.map(m => m.recipeId).filter((v): v is string => !!v), state.favoriteRecipeIds);
    if (replacement.recipeId === meal.recipeId) return false;
    this.actionNotice.set('');
    const reservationError = this.reservationError(meal, replacement);
    if (reservationError) { this.actionNotice.set(reservationError); return false; }
    this.savePlan({ ...plan, meals: plan.meals.map(m => m.id === id ? replacement : m) });
    return true;
  }
  chooseRecipe(id: string, recipeId: string): void { this.changeMeal(id, { recipeId, status: 'planned' }); }
  setTime(id: string, maxMinutes: number): void {
    const meal = this.plan().meals.find(m => m.id === id);
    if (!meal || meal.locked || meal.status === 'cooked') return;
    this.changeMeal(id, { maxMinutes });
  }
  favorite(id: string): void { this.update(state => ({ ...state, favoriteRecipeIds: state.favoriteRecipeIds.includes(id) ? state.favoriteRecipeIds.filter(r => r !== id) : [...state.favoriteRecipeIds, id] })); }
  renameHousehold(name: string): void { if (name.trim()) this.update(state => ({ ...state, household: { ...state.household, name: name.trim().slice(0, 80) } })); }
  savePerson(person: Person): void {
    if (!person.name.trim() || !Number.isFinite(person.portionFactor) || person.portionFactor <= 0 || person.portionFactor > 3) return;
    this.actionNotice.set('');
    const error = this.personChangeError(person);
    if (error) { this.actionNotice.set(error); return; }
    this.update(state => ({ ...state, household: { ...state.household, people: state.household.people.some(p => p.id === person.id)
      ? state.household.people.map(p => p.id === person.id ? { ...person, name: person.name.trim().slice(0, 80) } : p)
      : [...state.household.people, { ...person, name: person.name.trim().slice(0, 80) }] } }));
  }
  setGenerationSettings(settings: GenerationSettings): void { this.update(state => ({ ...state, generationSettings: settings })); }
  addRecipe(recipe: Recipe): void {
    this.actionNotice.set('');
    const error = this.recipeChangeError(recipe);
    if (error) { this.actionNotice.set(error); return; }
    this.update(state => ({ ...state, customRecipes: state.customRecipes?.some(saved => saved.id === recipe.id)
      ? state.customRecipes.map(saved => saved.id === recipe.id ? recipe : saved) : [...(state.customRecipes ?? []), recipe] }));
  }
  setPantry(ids: string[]): void {
    this.update(state => this.withCurrentShopping({ ...state,
      pantryIngredientIds: [...new Set([...ids, ...(state.pantryStock ?? []).map(item => item.ingredientId)])] }));
  }
  setPantryStock(item: PantryStockItem): void {
    this.actionNotice.set('');
    if (!Number.isFinite(item.quantity) || item.quantity < 0) { this.actionNotice.set('Ange en giltig mängd i skafferiet.'); return; }
    this.update(state => {
      const existing = state.pantryStock ?? [];
      const withoutUnit = existing.filter(saved => !(saved.ingredientId === item.ingredientId && saved.unit === item.unit));
      const pantryStock = item.quantity === 0 ? withoutUnit : [...withoutUnit, { ...item }];
      const hasAnyQuantity = pantryStock.some(saved => saved.ingredientId === item.ingredientId);
      const pantryIngredientIds = hasAnyQuantity
        ? [...new Set([...(state.pantryIngredientIds ?? []), item.ingredientId])]
        : (state.pantryIngredientIds ?? []).filter(id => id !== item.ingredientId);
      return this.withCurrentShopping({ ...state, pantryStock, pantryIngredientIds });
    });
  }
  removePantryStock(ingredientId: string, unit: Ingredient['unit']): void {
    this.update(state => {
      const pantryStock = (state.pantryStock ?? []).filter(item => !(item.ingredientId === ingredientId && item.unit === unit));
      const pantryIngredientIds = pantryStock.some(item => item.ingredientId === ingredientId)
        ? [...new Set([...(state.pantryIngredientIds ?? []), ingredientId])]
        : (state.pantryIngredientIds ?? []).filter(id => id !== ingredientId);
      return this.withCurrentShopping({ ...state, pantryStock, pantryIngredientIds });
    });
  }
  setDeductPantryStock(enabled: boolean): void {
    this.update(state => this.withCurrentShopping({ ...state, deductPantryStock: enabled }));
  }
  private withCurrentShopping(state: AppState): AppState {
    const plan = planningWindow(state.plans, this.todayDate(), clampPlanningDays(state.planningDays ?? 7), state.household.people);
    const previous = shoppingForRange(state.shoppingItems, this.todayDate(), clampPlanningDays(state.planningDays ?? 7));
    return { ...state, shoppingItems: replaceShoppingRange(state.shoppingItems,
      this.shoppingListFor(state, plan, previous), this.todayDate(), clampPlanningDays(state.planningDays ?? 7)) };
  }
  savePreset(preset: ParticipantPreset): void {
    const state = this.state(); if (!state || !preset.name.trim()) return;
    const participantIds = [...new Set(preset.participantIds)].filter(id => state.household.people.some(person => person.id === id));
    if (!participantIds.length) return;
    this.update(current => ({ ...current, participantPresets: [...(current.participantPresets ?? []).filter(saved => saved.id !== preset.id),
      { ...preset, name: preset.name.trim().slice(0, 80), participantIds }] }));
  }
  removePreset(id: string): void { this.update(state => ({ ...state, participantPresets: (state.participantPresets ?? []).filter(preset => preset.id !== id) })); }
  toggleShopping(id: string): void {
    const currentItems = this.shoppingItems();
    this.update(state => {
      const toggled = currentItems.map(item => item.id === id ? { ...item, checked: !item.checked } : item);
      return { ...state, shoppingItems: replaceShoppingRange(state.shoppingItems, toggled, this.todayDate(), this.planningDays()) };
    });
  }
  addShopping(name: string, details?: { ingredientId?: string; category?: Ingredient['category']; quantity?: number; unit?: Ingredient['unit'] }): void {
    const trimmed = name.trim().slice(0, 100); if (!trimmed) return;
    this.update(state => ({ ...state, shoppingItems: [...state.shoppingItems, {
      id: `manual:${crypto.randomUUID()}`, ingredientId: details?.ingredientId ?? 'manual', name: trimmed, quantity: details?.quantity ?? 1, unit: details?.unit ?? 'st', category: details?.category ?? 'Skafferi', source: 'manual', checked: false,
    }] }));
  }
  removeManualShopping(id: string): void {
    this.update(state => ({ ...state, shoppingItems: state.shoppingItems.filter(item => item.id !== id || item.source !== 'manual') }));
  }
}
