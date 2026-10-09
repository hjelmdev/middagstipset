import { afterNextRender, ChangeDetectionStrategy, Component, computed, HostListener, input, output, signal } from '@angular/core';
import type { PlannedMeal, Recipe } from '../domain/models';

const STANDARD_TIME_LIMITS = [20, 30, 35, 45, 60, 90] as const;

@Component({
  selector: 'app-recipe-picker',
  standalone: true,
  templateUrl: './recipe-picker.html',
  styleUrl: './recipe-picker.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class RecipePickerComponent {
  constructor() { afterNextRender(() => document.getElementById('picker-title')?.focus()); }
  @HostListener('document:keydown.escape')
  dismiss(): void { this.closed.emit(); }
  readonly recipes = input.required<Recipe[]>();
  readonly meal = input.required<PlannedMeal>();

  readonly selected = output<Recipe>();
  readonly closed = output<void>();

  readonly query = signal('');
  readonly filteredRecipes = computed(() => {
    const query = this.query().toLocaleLowerCase('sv-SE').trim();
    if (!query) return this.recipes();
    return this.recipes().filter((recipe) =>
      `${recipe.name} ${recipe.tags.join(' ')}`.toLocaleLowerCase('sv-SE').includes(query));
  });

  readonly weekday = computed(() => {
    const date = new Date(`${this.meal().date}T12:00:00`);
    return new Intl.DateTimeFormat('sv-SE', { weekday: 'long' }).format(date);
  });

  formatDate(date: string): string {
    return new Intl.DateTimeFormat('sv-SE', { day: 'numeric', month: 'long' })
      .format(new Date(`${date}T12:00:00`));
  }

  recommendedMaxTime(recipe: Recipe): number {
    return STANDARD_TIME_LIMITS.find((limit) => limit >= recipe.totalMinutes) ?? recipe.totalMinutes;
  }

  needsMoreTime(recipe: Recipe): boolean {
    return recipe.totalMinutes > this.meal().maxMinutes;
  }

  imageKindLabel(recipe: Recipe): string {
    switch (recipe.imageKind) {
      case 'illustration': return 'Illustration';
      case 'ai-generated': return 'AI-bild';
      case 'photo': return 'Foto';
    }
  }

  onSearchInput(event: Event): void {
    this.query.set((event.target as HTMLInputElement).value);
  }

  choose(recipe: Recipe): void {
    this.selected.emit(recipe);
  }
}
