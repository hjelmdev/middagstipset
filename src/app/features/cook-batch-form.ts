import { ChangeDetectionStrategy, Component, computed, input, output, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import type { DietaryNeed, Person, Recipe } from '../domain/models';
import { localDate, supportsNeeds } from '../domain/meal-engine';

export interface CookBatchDraft {
  recipeId: string;
  date: string;
  portions: number;
  needs: DietaryNeed[];
}

@Component({
  selector: 'app-cook-batch-form',
  imports: [FormsModule],
  templateUrl: './cook-batch-form.html',
  styleUrl: './cook-batch-form.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CookBatchFormComponent {
  readonly recipes = input.required<Recipe[]>();
  readonly todayDate = input.required<string>();
  readonly created = output<CookBatchDraft>();
  readonly cancelled = output<void>();

  readonly date = signal(localDate());
  readonly portions = signal(5);
  readonly needs = signal<DietaryNeed[]>([]);
  readonly selectedRecipeId = signal('');
  readonly eligibleRecipes = computed(() => {
    const person: Person = { id: 'batch-preview', name: 'Hela satsen', portionFactor: 1, dietaryNeeds: this.needs() };
    return this.recipes().filter(recipe => supportsNeeds(recipe, [person]));
  });
  readonly selectedRecipe = computed(() => this.eligibleRecipes().find(recipe => recipe.id === this.selectedRecipeId()) ?? this.eligibleRecipes()[0] ?? null);
  readonly canCreate = computed(() => !!this.selectedRecipe() && this.date() >= this.todayDate() && Number.isFinite(this.portions()) && this.portions() > 0 && this.portions() <= 120);

  setDate(value: string): void { this.date.set(value); }
  setPortions(value: number): void { this.portions.set(value); }
  setRecipe(value: string): void { this.selectedRecipeId.set(value); }
  currentRecipeId(): string { return this.selectedRecipe()?.id ?? ''; }

  toggleNeed(need: DietaryNeed, enabled: boolean): void {
    this.needs.update(current => enabled
      ? current.includes(need) ? current : [...current, need]
      : current.filter(item => item !== need));
  }

  create(): void {
    const recipe = this.selectedRecipe();
    if (!recipe || !this.canCreate()) return;
    this.created.emit({ recipeId: recipe.id, date: this.date(), portions: this.portions(), needs: [...this.needs()] });
  }
}
