import { ChangeDetectionStrategy, Component, computed, input, output } from '@angular/core';
import { FormsModule } from '@angular/forms';
import type { GenerationSettings, Recipe } from '../domain/models';

const TIME_LIMITS = [20, 25, 30, 35, 45, 60];

@Component({
  selector: 'app-plan-overview',
  imports: [FormsModule],
  templateUrl: './plan-overview.html',
  styleUrl: './plan-overview.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PlanOverviewComponent {
  readonly recipe = input.required<Recipe | null>();
  readonly rangeLabel = input.required<string>();
  readonly planningDays = input.required<number>();
  readonly plannedCount = input.required<number>();
  readonly missingCount = input.required<number>();
  readonly generationLabel = input.required<string>();
  readonly generationDisabled = input(false);
  readonly settings = input.required<GenerationSettings>();

  readonly generated = output<void>();
  readonly settingsChanged = output<GenerationSettings>();
  readonly planningDaysChanged = output<number>();

  readonly timeLimits = TIME_LIMITS;
  readonly dayOptions = Array.from({ length: 28 }, (_, index) => index + 1);
  readonly filtersSummary = computed(() => {
    const settings = this.settings();
    const active = [
      ...(settings.vegetarianOnly ? ['Vegetariskt'] : []),
      ...(settings.favoritesOnly ? ['Favoriter'] : []),
      ...(settings.maxMinutes === null ? [] : [`Max ${settings.maxMinutes} min`]),
    ];
    return active.length ? active.join(' · ') : 'Alla recept';
  });

  get mealCountLabel(): string {
    const planned = this.plannedCount();
    const days = this.planningDays();
    return `${planned} av ${days} ${days === 1 ? 'middag' : 'middagar'} planerade`;
  }

  setVegetarian(value: boolean): void {
    this.settingsChanged.emit({ ...this.settings(), vegetarianOnly: value });
  }

  setFavorites(value: boolean): void {
    this.settingsChanged.emit({ ...this.settings(), favoritesOnly: value });
  }

  setMaxMinutes(value: string | number): void {
    const maxMinutes = value === '' ? null : Number(value);
    if (maxMinutes !== null && (!Number.isFinite(maxMinutes) || maxMinutes <= 0)) return;
    this.settingsChanged.emit({ ...this.settings(), maxMinutes });
  }

  setPlanningDays(value: number | string): void {
    const days = Number(value);
    if (Number.isInteger(days) && days >= 1 && days <= 28) this.planningDaysChanged.emit(days);
  }
}
