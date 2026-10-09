import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import type { Ingredient, ShoppingItem } from '../domain/models';
import { PlannerStore } from '../core/planner.store';
import { IconComponent } from '../shared/icon';
import { buildIngredientCatalog, findIngredient, searchIngredients, type IngredientCategory, type IngredientSuggestion } from '../domain/ingredient-catalog';

const CATEGORY_ORDER: ShoppingItem['category'][] = ['Grönt', 'Kött & fisk', 'Mejeri', 'Skafferi'];
const QUANTITY_FORMAT = new Intl.NumberFormat('sv-SE', { maximumFractionDigits: 2 });

@Component({
  selector: 'app-shopping-list',
  imports: [FormsModule, RouterLink, IconComponent],
  templateUrl: './shopping-list.html',
  styleUrl: './shopping-list.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ShoppingListComponent {
  readonly store = inject(PlannerStore);
  readonly deductPantryStock = computed(() => this.store.state()?.deductPantryStock ?? false);
  readonly newItemName = signal('');
  readonly newItemQuantity = signal<number | null>(1);
  readonly newItemUnit = signal<Ingredient['unit']>('st');
  readonly units: Ingredient['unit'][] = ['st', 'g', 'ml', 'msk', 'tsk'];
  readonly validQuantity = computed(() => {
    const quantity = this.newItemQuantity();
    return quantity !== null && Number.isFinite(quantity) && quantity > 0 && quantity <= 1_000_000;
  });
  readonly catalog = computed(() => buildIngredientCatalog(this.store.recipes));
  readonly suggestions = computed(() => searchIngredients(this.catalog(), this.newItemName())
    .filter(item => item.id !== this.selectedSuggestion()?.id));
  readonly selectedSuggestion = signal<IngredientSuggestion | null>(null);
  readonly selectedCategory = signal<IngredientCategory>('Skafferi');
  readonly categories: IngredientCategory[] = ['Grönt', 'Kött & fisk', 'Mejeri', 'Skafferi'];
  readonly exactIngredient = computed(() => this.selectedSuggestion() ?? findIngredient(this.catalog(), this.newItemName()));
  readonly groups = computed(() => CATEGORY_ORDER
    .map(category => ({
      category,
      items: this.store.shoppingItems()
        .filter(item => item.category === category)
        .sort((a, b) => Number(a.checked) - Number(b.checked) || a.name.localeCompare(b.name, 'sv-SE')),
    }))
    .filter(group => group.items.length > 0));
  readonly completedCount = computed(() => this.store.shoppingItems().filter(item => item.checked).length);

  formatQuantity(item: ShoppingItem): string {
    return `${QUANTITY_FORMAT.format(item.quantity)} ${item.unit}`;
  }

  addItem(): void {
    const name = this.newItemName().trim();
    const quantity = this.newItemQuantity();
    if (!name || !this.validQuantity() || quantity === null) return;
    const ingredient = this.exactIngredient();
    this.store.addShopping(name, ingredient
      ? { ingredientId: ingredient.id, category: ingredient.category, quantity, unit: this.newItemUnit() }
      : { category: this.selectedCategory(), quantity, unit: this.newItemUnit() });
    this.newItemName.set('');
    this.selectedSuggestion.set(null);
    this.selectedCategory.set('Skafferi');
    this.newItemQuantity.set(1);
    this.newItemUnit.set('st');
  }

  setItemName(name: string): void {
    this.newItemName.set(name);
    this.selectedSuggestion.set(null);
    this.selectedCategory.set(findIngredient(this.catalog(), name)?.category ?? 'Skafferi');
  }

  chooseSuggestion(ingredient: IngredientSuggestion): void {
    this.newItemName.set(ingredient.name);
    this.selectedSuggestion.set(ingredient);
    this.selectedCategory.set(ingredient.category);
  }

  setCategory(category: string): void {
    if (this.categories.includes(category as IngredientCategory)) this.selectedCategory.set(category as IngredientCategory);
  }

  setQuantity(quantity: number | null): void {
    this.newItemQuantity.set(quantity);
  }

  setUnit(unit: string): void {
    if (this.units.includes(unit as Ingredient['unit'])) this.newItemUnit.set(unit as Ingredient['unit']);
  }

  removeManualItem(item: ShoppingItem): void {
    if (item.source === 'manual') this.store.removeManualShopping(item.id);
  }

  setDeductPantryStock(enabled: boolean): void {
    this.store.setDeductPantryStock(enabled);
  }
}
