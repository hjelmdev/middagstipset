import { afterNextRender, ChangeDetectionStrategy, Component, computed, inject, Injector, signal } from '@angular/core';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { toSignal } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { PlannerStore } from '../core/planner.store';
import type { PlannedMeal, Recipe } from '../domain/models';
import { cloneRecipeAsVariant } from '../domain/recipe-variants';
import { portionCount, shiftDate, supportsNeeds } from '../domain/meal-engine';
import { lunchSourceId, lunchSourceType } from '../domain/leftovers';
import { RecipeDetailComponent } from './recipe-detail';
import { ShoppingListComponent } from './shopping-list';
import { IconComponent } from '../shared/icon';
import { RecipePickerComponent } from './recipe-picker';
import { RecipeEditorComponent } from './recipe-editor';
import { MealSettingsComponent } from './meal-settings';
import { PlanOverviewComponent } from './plan-overview';
import { HouseholdPeopleComponent } from './household-people';
import { HouseholdPresetsComponent } from './household-presets';

@Component({ selector: 'app-planner-page', imports: [FormsModule, RouterLink, RecipeDetailComponent, ShoppingListComponent, IconComponent, RecipePickerComponent, RecipeEditorComponent, MealSettingsComponent, PlanOverviewComponent, HouseholdPeopleComponent, HouseholdPresetsComponent], templateUrl: './planner-page.html', styleUrl: './planner-page.scss', changeDetection: ChangeDetectionStrategy.OnPush })
export class PlannerPage {
  readonly store = inject(PlannerStore);
  readonly router = inject(Router);
  private readonly injector = inject(Injector);
  private returnScroll = 0;
  private readonly routeData = toSignal(inject(ActivatedRoute).data);
  readonly screen = computed(() => this.routeData()?.['screen'] as string);
  readonly selectedRecipe = signal<Recipe | null>(null);
  readonly selectedMeal = signal<PlannedMeal | null>(null);
  readonly query = signal('');
  readonly onlyFavorites = signal(false);
  readonly message = signal('');
  readonly selectedClearIds = signal<string[]>([]);
  clearingMode = false;
  readonly newName = signal('');
  readonly changeMenu = signal<string | null>(null);
  readonly pickerMeal = signal<PlannedMeal | null>(null);
  readonly editingRecipe = signal(false);
  readonly recipeDraft = signal<Recipe | null>(null);
  readonly settingsMeal = signal<PlannedMeal | null>(null);
  readonly editingGeneration = signal(false);
  createRecipe(recipe: Recipe | null = null): void { this.rememberPosition(); this.recipeDraft.set(recipe); this.editingRecipe.set(true); window.scrollTo({ top: 0, behavior: 'instant' }); }
  createVariant(recipe: Recipe): void { this.createRecipe(cloneRecipeAsVariant(recipe)); }
  cancelRecipe(): void { this.editingRecipe.set(false); this.restorePosition(); }
  saveRecipe(recipe: Recipe): void { this.store.addRecipe(recipe); if (this.store.actionNotice()) return; this.cancelRecipe(); this.message.set(`${recipe.name} är sparad i dina privata recept.`); }
  exportRecipe(recipe: Recipe): void {
    const url = URL.createObjectURL(new Blob([JSON.stringify(recipe, null, 2)], { type: 'application/json' }));
    const link = document.createElement('a'); link.href = url;
    link.download = `${recipe.name.replace(/[^a-zåäö0-9]+/gi, '-').replace(/^-|-$/g, '') || 'recept'}.json`;
    link.click(); window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  editMeal(meal: PlannedMeal): void { this.rememberPosition(); this.settingsMeal.set(meal); window.scrollTo({ top: 0, behavior: 'instant' }); }
  closeSettings(): void { this.settingsMeal.set(null); this.restorePosition(); }
  saveMealSettings(patch: Partial<PlannedMeal>): void {
    const meal = this.settingsMeal(); if (!meal || meal.locked || meal.status === 'cooked') return;
    this.store.changeMeal(meal.id, patch); if (this.store.actionNotice()) return; this.closeSettings(); this.message.set('Deltagare och portionsantal är sparade.');
  }
  mealCompatible(meal: PlannedMeal): boolean { return !this.store.incompatibleMeals().some(item => item.id === meal.id); }
  timeOptions(meal: PlannedMeal): number[] { return [...new Set([20, 25, 30, 35, 45, 60, 90, meal.maxMinutes])].sort((a, b) => a - b); }
  readonly pickerRecipes = computed(() => {
    const meal = this.pickerMeal();
    const eaters = this.people().filter(person => meal?.participantIds.includes(person.id));
    return this.store.recipes.filter(recipe => supportsNeeds(recipe, eaters));
  });
  readonly people = computed(() => this.store.state()?.household.people ?? []);
  readonly detailPeople = computed(() => {
    const meal = this.selectedMeal();
    return meal?.cookedSnapshot?.people ?? (meal ? this.people().filter(p => meal.participantIds.includes(p.id)) : this.people());
  });
  readonly filteredRecipes = computed(() => {
    const query = this.query().toLocaleLowerCase('sv-SE').trim();
    return this.store.recipes.filter(r => `${r.name} ${r.tags.join(' ')}`.toLocaleLowerCase('sv-SE').includes(query) && (!this.onlyFavorites() || this.store.state()?.favoriteRecipeIds.includes(r.id)));
  });
  readonly todayDate = this.store.todayDate;
  readonly todayMeal = this.store.today;
  readonly todayRecipe = computed(() => this.mealRecipe(this.todayMeal()));
  readonly upcomingTotalCount = computed(() => Math.max(0, this.store.planningDays() - 1));
  readonly upcomingPreviewCount = computed(() => Math.min(7, this.upcomingTotalCount()));
  readonly planPreviewRecipe = computed(() => {
    const meals = this.store.plan().meals;
    const planned = meals.find(meal => !!meal.recipeId && meal.status === 'planned') ?? meals.find(meal => !!meal.recipeId);
    return (planned && this.mealRecipe(planned)) || this.store.recipes[0] || null;
  });
  readonly upcomingMeals = computed(() => Array.from({ length: this.upcomingPreviewCount() }, (_, index) => {
    const date = shiftDate(this.todayDate(), index + 1);
    const meal = this.store.allMeals().find(candidate => candidate.date === date);
    const recipe = meal ? this.mealRecipe(meal) : undefined;
    return { date, ...(meal ? { meal } : {}), ...(recipe ? { recipe } : {}) };
  }));
  readonly plannedCount = computed(() => this.store.plan().meals.filter(m => !!m.recipeId).length);
  readonly missingDinnerCount = computed(() => this.store.plan().meals.filter(meal => !meal.recipeId).length);
  readonly generatableDinnerCount = computed(() => this.store.plan().meals.filter(meal => {
    if (meal.recipeId || meal.locked || meal.status !== 'planned') return false;
    const eaters = this.people().filter(person => meal.participantIds.includes(person.id));
    if (portionCount(eaters, meal.extraPortions) <= 0) return false;
    return this.store.eligibleRecipes().some(recipe => recipe.totalMinutes <= meal.maxMinutes && supportsNeeds(recipe, eaters));
  }).length);
  readonly generationLabel = computed(() => {
    const count = this.generatableDinnerCount();
    if (count === 0) return this.missingDinnerCount() ? 'Inga tomma middagar kan föreslås' : 'Alla middagar planerade';
    return count === 1 ? 'Föreslå 1 middag' : `Föreslå ${count} middagar`;
  });
  readonly generationDisabled = computed(() => this.generatableDinnerCount() === 0);
  readonly selectedClearCount = computed(() => this.selectedClearIds().length);
  readonly rangeLabel = computed(() => {
    const first = this.formatDate(this.todayDate(), { day: 'numeric', month: 'short' });
    return this.store.planningDays() === 1 ? first : `${first} – ${this.formatDate(this.store.plan().meals.at(-1)!.date, { day: 'numeric', month: 'short' })}`;
  });
  formatDate(date: string, options: Intl.DateTimeFormatOptions): string { return new Intl.DateTimeFormat('sv-SE', options).format(new Date(`${date}T12:00:00`)); }
  dayName(date: string): string { return this.formatDate(date, { weekday: 'long' }); }
  isToday(date: string): boolean { return date === this.todayDate(); }
  portions(meal?: PlannedMeal): number { return meal?.cookedSnapshot?.portions ?? portionCount(meal ? this.people().filter(p => meal.participantIds.includes(p.id)) : this.people(), meal?.extraPortions ?? 0); }
  mealRecipe(meal: PlannedMeal): Recipe | undefined { return meal.cookedSnapshot?.recipe ?? this.store.recipe(meal.recipeId); }
  private rememberPosition(): void { this.returnScroll = window.scrollY; }
  private restorePosition(): void {
    const top = this.returnScroll;
    afterNextRender(() => window.scrollTo({ top, behavior: 'instant' }), { injector: this.injector });
  }
  open(recipe: Recipe, meal?: PlannedMeal): void { this.rememberPosition(); this.selectedRecipe.set(recipe); this.selectedMeal.set(meal ?? null); window.scrollTo({ top: 0, behavior: 'instant' }); }
  close(): void { this.selectedRecipe.set(null); this.selectedMeal.set(null); this.restorePosition(); }
  closePicker(): void { this.pickerMeal.set(null); this.restorePosition(); }
  generate(): void {
    if (this.generationDisabled()) {
      this.message.set(this.missingDinnerCount()
        ? 'Inga tomma middagar kan föreslås med aktuella filter, kostbehov och tidsgränser.'
        : 'Alla middagar är redan planerade.');
      return;
    }
    const result = this.store.generate();
    this.message.set(result.missing ? `${result.added} middagar föreslagna. ${result.missing} tomma dagar saknar ett recept som passar.` :
      result.added ? `${result.added} middagar föreslagna.` : 'Det finns inga tomma, genererbara middagar.');
  }
  canClearMeal(meal: PlannedMeal): boolean {
    return !!meal.recipeId && !meal.locked && meal.status === 'planned' &&
      !this.store.lunchPlans().some(lunch => lunchSourceType(lunch) === 'meal' && lunchSourceId(lunch) === meal.id);
  }
  toggleClearSelection(meal: PlannedMeal): void {
    if (!this.canClearMeal(meal)) return;
    this.selectedClearIds.update(ids => ids.includes(meal.id) ? ids.filter(id => id !== meal.id) : [...ids, meal.id]);
  }
  clearDinner(meal: PlannedMeal): void {
    if (!this.canClearMeal(meal)) return;
    const error = this.store.clearMeals([meal.id]);
    if (!error) {
      this.selectedClearIds.update(ids => ids.filter(id => id !== meal.id));
      this.changeMenu.set(null);
    }
    this.message.set(error || `Middagen ${this.dayName(meal.date)} är tömd.`);
  }
  clearSelectedMeals(): void {
    const ids = this.selectedClearIds();
    if (!ids.length) return;
    const error = this.store.clearMeals(ids);
    if (error) { this.message.set(error); return; }
    this.selectedClearIds.set([]);
    this.changeMenu.set(null);
    this.message.set(`${ids.length} ${ids.length === 1 ? 'middag är' : 'middagar är'} tömda.`);
  }
  undoClearMeals(): void {
    const error = this.store.undoClearMeals();
    this.message.set(error || 'Den senaste tömningen är återställd.');
  }
  swap(meal: PlannedMeal): void {
    this.changeMenu.set(null);
    if (!this.store.eligibleRecipes().length) { this.message.set('Inga recept matchar filtren. Ändra Filter eller välj ett recept själv. Din middag är kvar.'); return; }
    const changed = this.store.swap(meal.id);
    if (this.store.actionNotice()) { this.message.set(this.store.actionNotice()); return; }
    this.message.set(changed ? (meal.recipeId ? 'Middagen är bytt.' : 'En middag är tillagd.') :
      meal.recipeId ? 'Inget annat recept passar. Din valda middag är kvar. Prova att öka max tid eller välj själv.' : 'Inget recept passar tidsramen och kostbehoven. Prova att öka max tid eller välj själv.');
  }
  changeDinner(meal: PlannedMeal): void {
    if (!meal.recipeId) this.swap(meal);
    else this.changeMenu.update(id => id === meal.id ? null : meal.id);
  }
  chooseDinner(meal: PlannedMeal): void {
    this.rememberPosition();
    this.changeMenu.set(null); this.pickerMeal.set(meal);
    window.scrollTo({ top: 0, behavior: 'instant' });
  }
  selectDinner(recipe: Recipe): void {
    const target = this.pickerMeal(); if (!target) return;
    const meal = this.store.plan().meals.find(candidate => candidate.id === target.id);
    if (!meal || meal.locked || meal.status === 'cooked') { this.closePicker(); return; }
    const eaters = this.people().filter(person => meal.participantIds.includes(person.id));
    if (!supportsNeeds(recipe, eaters)) { this.message.set('Receptet passar inte dagens kostbehov.'); return; }
    const maxMinutes = recipe.totalMinutes > meal.maxMinutes ? ([20, 30, 35, 45, 60, 90].find(time => time >= recipe.totalMinutes) ?? recipe.totalMinutes) : meal.maxMinutes;
    this.store.changeMeal(meal.id, { recipeId: recipe.id, maxMinutes, status: 'planned' });
    if (this.store.actionNotice()) return;
    this.closePicker(); this.message.set(`${recipe.name} vald för ${this.dayName(meal.date)}.`);
  }
  async cooked(): Promise<void> {
    const meal = this.selectedMeal(); if (!meal) return;
    this.store.changeMeal(meal.id, { status: 'cooked', cookedAt: new Date().toISOString() }); if (this.store.actionNotice()) return; this.close(); this.message.set('Middagen är markerad som lagad.');
  }
  favorite(recipe: Recipe): void { this.store.favorite(recipe.id); }
  toggleFavorites(): void { this.onlyFavorites.update(value => !value); }
  goToToday(): void { this.store.refreshToday(); }
  showDate(date: string): void {
    this.store.refreshToday();
    for (let offset = 0; offset < 28; offset++) {
      if (shiftDate(this.todayDate(), offset) === date && offset >= this.store.planningDays()) this.store.setPlanningDays(offset + 1);
    }
  }
  imageLabel(recipe: Recipe): string { return recipe.imageKind === 'ai-generated' ? 'AI-genererad bild' : recipe.imageKind === 'illustration' ? 'Illustration' : 'Foto'; }
  mealTags(recipe: Recipe): string[] {
    const tags: string[] = [];
    if (recipe.dietaryNeeds.includes('vegetarian')) tags.push('Vegetariskt');
    if (recipe.glutenStrategy === 'naturally-free' && recipe.ingredients.every(ingredient => !ingredient.allergens.includes('gluten'))) tags.push('Glutenfritt');
    else if (supportsNeeds(recipe, [{ id: 'tag', name: '', portionFactor: 1, dietaryNeeds: ['gluten-free'] }])) tags.push('Kan göras glutenfritt');
    return [...tags, ...recipe.tags.filter(tag => !['Vegetariskt', 'Glutenfritt'].includes(tag))].slice(0, 2);
  }
  async addToPlan(recipe: Recipe, mealId: string): Promise<void> {
    const meal = this.store.plan().meals.find(m => m.id === mealId);
    if (!meal || meal.locked || meal.status === 'cooked') return;
    const people = this.people().filter(p => meal.participantIds.includes(p.id));
    if (!supportsNeeds(recipe, people)) { this.message.set('Receptet passar inte valda kostbehov. Välj ett annat.'); return; }
    if (recipe.totalMinutes > meal.maxMinutes) { this.message.set(`Rätten tar ${recipe.totalMinutes} minuter. Öka dagens max tid i Planera innan du lägger till den.`); return; }
    this.store.chooseRecipe(meal.id, recipe.id); if (this.store.actionNotice()) return; this.message.set(`${recipe.name} tillagd på ${this.dayName(meal.date)}.`);
  }
  rename(): void { this.store.renameHousehold(this.newName()); this.newName.set(''); this.message.set('Hushållets namn är sparat.'); }
  async signIn(): Promise<void> {
    try { await this.store.flush(); await this.store.auth.signInWithGoogle(); }
    catch { this.message.set('Inloggningen kunde inte starta. Spara eventuella osparade ändringar och försök igen.'); }
  }
  async signOut(): Promise<void> {
    try { await this.store.flush(); await this.store.auth.signOut(); }
    catch { this.message.set('Utloggningen avbröts. Spara eventuella osparade ändringar och försök igen.'); }
  }
}
