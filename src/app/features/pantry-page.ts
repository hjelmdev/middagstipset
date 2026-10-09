import { afterNextRender, ChangeDetectionStrategy, Component, computed, inject, Injector, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import type { Ingredient, PantryStockItem, Recipe } from '../domain/models';
import { buildIngredientCatalog, searchIngredients, type IngredientSuggestion } from '../domain/ingredient-catalog';
import { pantryRecipeMatches } from '../domain/pantry';
import type { PantryRecipeMatch } from '../domain/pantry';
import { normalizeKitchenAmount, type KitchenUnit } from '../domain/kitchen-units';
import { PlannerStore } from '../core/planner.store';
import { RecipeDetailComponent } from './recipe-detail';

interface PantryRow {
  key: string;
  id: string;
  name: string;
  category: Ingredient['category'];
  stock?: PantryStockItem;
}

@Component({
  selector: 'app-pantry-page',
  imports: [FormsModule, RecipeDetailComponent],
  templateUrl: './pantry-page.html',
  styleUrl: './pantry-page.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PantryPage {
  readonly store = inject(PlannerStore);
  private readonly injector = inject(Injector);
  readonly search = signal('');
  readonly onlyAllHome = signal(false);
  readonly selectedRecipe = signal<Recipe | null>(null);
  private readonly restoreScrollTop = signal(0);
  readonly householdPeople = computed(() => this.store.state()?.household.people ?? []);
  readonly pantryIds = computed(() => new Set(this.store.state()?.pantryIngredientIds ?? []));
  readonly pantryStock = computed(() => this.store.state()?.pantryStock ?? []);
  readonly unitOptions: KitchenUnit[] = ['g', 'kg', 'ml', 'l', 'dl', 'cl', 'msk', 'tsk', 'st'];
  readonly quantityDrafts = signal<Record<string, number | null>>({});
  readonly unitDrafts = signal<Record<string, KitchenUnit | ''>>({});
  readonly amountError = signal('');
  readonly catalog = computed(() => {
    const entries = new Map(buildIngredientCatalog(this.store.recipes).map((entry) => [entry.id, entry]));
    for (const recipe of this.store.recipes) {
      for (const ingredient of recipe.ingredients) {
        const alternative = ingredient.glutenFreeAlternative;
        if (alternative && !entries.has(alternative.id)) {
          entries.set(alternative.id, { id: alternative.id, name: alternative.name, category: ingredient.category, aliases: [] });
        }
      }
    }
    return [...entries.values()].sort((a, b) => a.name.localeCompare(b.name, 'sv-SE'));
  });
  readonly suggestions = computed(() => searchIngredients(this.catalog(), this.search())
    .filter((ingredient) => !this.pantryIds().has(ingredient.id)));
  readonly pantryItems = computed<PantryRow[]>(() => {
    const rows: PantryRow[] = [];
    for (const id of this.pantryIds()) {
      const catalogItem = this.catalog().find((ingredient) => ingredient.id === id);
      const stockItems = this.pantryStock().filter((item) => item.ingredientId === id);
      if (stockItems.length) {
        for (const stock of stockItems) rows.push({ key: `${id}:${stock.unit}`, id, name: catalogItem?.name ?? stock.name, category: catalogItem?.category ?? stock.category, stock });
      } else if (catalogItem) rows.push({ key: `${id}:unknown`, id, name: catalogItem.name, category: catalogItem.category });
    }
    return rows.sort((a, b) => a.name.localeCompare(b.name, 'sv-SE') || (a.stock?.unit ?? '').localeCompare(b.stock?.unit ?? ''));
  });
  readonly results = computed(() => pantryRecipeMatches(
    this.store.recipes,
    this.householdPeople(),
    this.pantryIds(),
    this.onlyAllHome() ? 0 : 3,
    this.pantryStock(),
  ));
  readonly manualShoppingIngredientIds = computed(() => new Set(
    this.store.shoppingItems().filter((item) => item.source === 'manual').map((item) => this.shoppingKey(item.ingredientId, item.unit))));

  setSearch(value: string): void {
    this.search.set(value);
  }

  addPantryItem(ingredient: IngredientSuggestion): void {
    this.store.setPantry([...this.pantryIds(), ingredient.id]);
    this.quantityDrafts.update(drafts => ({ ...drafts, [`${ingredient.id}:unknown`]: null }));
    this.unitDrafts.update(drafts => ({ ...drafts, [`${ingredient.id}:unknown`]: '' }));
    this.search.set('');
  }

  removePantryItem(ingredientId: string, unit?: Ingredient['unit']): void {
    if (unit) this.store.removePantryStock(ingredientId, unit);
    else this.store.setPantry([...this.pantryIds()].filter((id) => id !== ingredientId));
    const key = `${ingredientId}:${unit ?? 'unknown'}`;
    this.quantityDrafts.update(drafts => { const next = { ...drafts }; delete next[key]; return next; });
    this.unitDrafts.update(drafts => { const next = { ...drafts }; delete next[key]; return next; });
  }

  quantityDraft(key: string, stock?: PantryStockItem): number | null {
    if (Object.hasOwn(this.quantityDrafts(), key)) return this.quantityDrafts()[key];
    return stock?.quantity ?? null;
  }

  unitDraft(key: string, stock?: PantryStockItem): KitchenUnit | '' {
    if (Object.hasOwn(this.unitDrafts(), key)) return this.unitDrafts()[key];
    return stock?.unit ?? '';
  }

  setQuantityDraft(key: string, quantity: number | null): void {
    this.quantityDrafts.update(drafts => ({ ...drafts, [key]: quantity }));
  }

  setUnitDraft(key: string, unit: string): void {
    if (unit === '' || this.unitOptions.includes(unit as KitchenUnit)) this.unitDrafts.update(drafts => ({ ...drafts, [key]: unit as KitchenUnit | '' }));
  }

  savePantryAmount(row: PantryRow): void {
    const quantity = this.quantityDraft(row.key, row.stock);
    if (quantity === null || !Number.isFinite(quantity) || quantity <= 0) {
      this.amountError.set('Ange en mängd större än 0, eller låt mängden vara okänd.');
      return;
    }
    const unit = this.unitDraft(row.key, row.stock);
    if (!unit) {
      this.amountError.set(`Välj en enhet för ${row.name}.`);
      return;
    }
    try {
      const normalized = normalizeKitchenAmount(quantity, unit);
      if (row.stock && row.stock.unit !== normalized.unit) this.store.removePantryStock(row.id, row.stock.unit);
      this.store.setPantryStock({ ingredientId: row.id, name: row.name, category: row.category, ...normalized });
      const nextKey = `${row.id}:${normalized.unit}`;
      this.quantityDrafts.update(drafts => { const next = { ...drafts, [nextKey]: normalized.quantity }; if (nextKey !== row.key) delete next[row.key]; return next; });
      this.unitDrafts.update(drafts => { const next = { ...drafts, [nextKey]: normalized.unit }; if (nextKey !== row.key) delete next[row.key]; return next; });
      this.amountError.set('');
    } catch (error) {
      this.amountError.set(error instanceof Error ? error.message : 'Mängden kunde inte sparas.');
    }
  }

  openRecipe(recipe: Recipe): void {
    this.restoreScrollTop.set(window.scrollY);
    this.selectedRecipe.set(recipe);
    window.scrollTo({ top: 0, behavior: 'instant' });
  }

  addMissingToShopping(missing: Ingredient[]): void {
    const alreadyListed = this.manualShoppingIngredientIds();
    for (const ingredient of missing) {
      const key = this.shoppingKey(ingredient.id, ingredient.unit);
      if (alreadyListed.has(key)) continue;
      this.addIngredientToShopping(ingredient);
      alreadyListed.add(key);
    }
  }

  isMissingAlreadyListed(missing: Ingredient[]): boolean {
    const listed = this.manualShoppingIngredientIds();
    return missing.length === 0 || missing.every((ingredient) => listed.has(this.shoppingKey(ingredient.id, ingredient.unit)));
  }

  formatQuantity(quantity: number): string {
    return new Intl.NumberFormat('sv-SE', { maximumFractionDigits: 2 }).format(quantity);
  }

  measurableShortages(match: PantryRecipeMatch): Ingredient[] {
    const incompatibleKeys = new Set(match.incompatibleUnit.map(item => `${item.id}:${item.unit}`));
    return match.missingAmounts.filter(item => !incompatibleKeys.has(`${item.id}:${item.unit}`));
  }

  unknownPantryIngredients(match: PantryRecipeMatch): Ingredient[] {
    const stockIds = new Set(this.pantryStock().map(item => item.ingredientId));
    const unknown: Ingredient[] = [];
    const seen = new Set<string>();
    for (const ingredient of match.unknownAmount) {
      if (seen.has(ingredient.id)) continue;
      unknown.push(ingredient);
      seen.add(ingredient.id);
    }
    for (const ingredient of match.required) {
      if (this.pantryIds().has(ingredient.id) && !stockIds.has(ingredient.id) && !seen.has(ingredient.id)) {
        unknown.push(ingredient);
        seen.add(ingredient.id);
      }
    }
    return unknown;
  }

  attentionCount(match: PantryRecipeMatch): number {
    return new Set([...match.missing.map(item => item.id), ...this.unknownPantryIngredients(match).map(item => item.id)]).size;
  }

  closeRecipe(): void {
    this.selectedRecipe.set(null);
    afterNextRender(() => window.scrollTo({ top: this.restoreScrollTop(), behavior: 'instant' }), { injector: this.injector });
  }

  private shoppingKey(ingredientId: string, unit: Ingredient['unit']): string {
    return `${ingredientId}:${unit}`;
  }

  private addIngredientToShopping(ingredient: Ingredient): void {
    this.store.addShopping(ingredient.name, {
      ingredientId: ingredient.id,
      category: ingredient.category,
      quantity: ingredient.quantity,
      unit: ingredient.unit,
    });
  }
}
