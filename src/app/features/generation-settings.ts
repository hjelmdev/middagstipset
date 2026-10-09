import { afterNextRender, ChangeDetectionStrategy, Component, effect, ElementRef, inject, input, output, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import type { GenerationSettings } from '../domain/models';

@Component({
  selector: 'app-generation-settings',
  standalone: true,
  imports: [FormsModule],
  templateUrl: './generation-settings.html',
  styleUrl: './generation-settings.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class GenerationSettingsComponent {
  readonly current = input.required<GenerationSettings>();
  readonly changed = output<GenerationSettings>();
  readonly closed = output<void>();

  readonly vegetarianOnly = signal(false);
  readonly favoritesOnly = signal(false);
  readonly maxMinutes = signal<number | null>(null);
  readonly timeLimits = [20, 25, 30, 35, 45, 60];

  constructor() {
    const host = inject(ElementRef<HTMLElement>);
    afterNextRender(() => (host.nativeElement.querySelector('[data-panel-heading]') as HTMLElement | null)?.focus());
    effect(() => {
      const current = this.current();
      this.vegetarianOnly.set(current.vegetarianOnly);
      this.favoritesOnly.set(current.favoritesOnly);
      this.maxMinutes.set(current.maxMinutes);
    });
  }

  setVegetarianOnly(event: Event): void {
    this.vegetarianOnly.set((event.target as HTMLInputElement).checked);
  }

  setFavoritesOnly(event: Event): void {
    this.favoritesOnly.set((event.target as HTMLInputElement).checked);
  }

  setMaxMinutes(value: string | number): void {
    if (value === '') {
      this.maxMinutes.set(null);
      return;
    }
    const minutes = Number(value);
    if (Number.isFinite(minutes) && minutes > 0) this.maxMinutes.set(minutes);
  }

  save(): void {
    this.changed.emit({
      vegetarianOnly: this.vegetarianOnly(),
      favoritesOnly: this.favoritesOnly(),
      maxMinutes: this.maxMinutes(),
    });
  }
}
