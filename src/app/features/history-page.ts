import { afterNextRender, ChangeDetectionStrategy, Component, computed, inject, Injector, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { PlannerStore } from '../core/planner.store';
import type { Person, PlannedMeal, Recipe } from '../domain/models';
import { RecipeDetailComponent } from './recipe-detail';

@Component({
  selector: 'app-history-page',
  standalone: true,
  imports: [RouterLink, RecipeDetailComponent],
  templateUrl: './history-page.html',
  styleUrl: './history-page.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class HistoryPage {
  readonly store = inject(PlannerStore);
  private readonly injector = inject(Injector);
  private returnScroll = 0;
  readonly filter = signal<'cooked' | 'all'>('cooked');
  readonly selectedRecipe = signal<Recipe | null>(null);
  readonly selectedMeal = signal<PlannedMeal | null>(null);

  readonly entries = computed(() => {
    const history = this.store.history();
    return this.filter() === 'cooked'
      ? history.filter((entry) => entry.meal.status === 'cooked')
      : history;
  });

  readonly people = computed<Person[]>(() => {
    const allPeople = this.store.state()?.household.people ?? [];
    const meal = this.selectedMeal();
    return meal?.cookedSnapshot?.people ?? (meal ? allPeople.filter((person) => meal.participantIds.includes(person.id)) : allPeople);
  });

  readonly extraPortions = computed(() => this.selectedMeal()?.cookedSnapshot?.extraPortions ?? this.selectedMeal()?.extraPortions ?? 0);

  formatDate(date: string): string {
    return new Intl.DateTimeFormat('sv-SE', {
      weekday: 'long',
      day: 'numeric',
      month: 'long',
      year: 'numeric',
    }).format(new Date(`${date}T12:00:00`));
  }

  open(entry: { meal: PlannedMeal; recipe?: Recipe }): void {
    if (!entry.recipe) return;
    this.returnScroll = window.scrollY;
    this.selectedMeal.set(entry.meal);
    this.selectedRecipe.set(entry.recipe);
    window.scrollTo({ top: 0, behavior: 'instant' });
  }

  closeRecipe(): void {
    this.selectedRecipe.set(null);
    this.selectedMeal.set(null);
    const top = this.returnScroll;
    afterNextRender(() => window.scrollTo({ top, behavior: 'instant' }), { injector: this.injector });
  }
}
