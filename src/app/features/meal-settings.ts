import { afterNextRender, ChangeDetectionStrategy, Component, computed, effect, ElementRef, inject, input, output, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import type { ParticipantPreset, Person, PlannedMeal } from '../domain/models';

const TIME_LIMITS = [20, 25, 30, 35, 45, 60] as const;

@Component({
  selector: 'app-meal-settings',
  standalone: true,
  imports: [FormsModule],
  templateUrl: './meal-settings.html',
  styleUrl: './meal-settings.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class MealSettingsComponent {
  readonly meal = input.required<PlannedMeal>();
  readonly people = input.required<Person[]>();
  readonly presets = input<ParticipantPreset[]>([]);

  readonly changed = output<Partial<PlannedMeal>>();
  readonly closed = output<void>();

  readonly draftParticipantIds = signal<string[]>([]);
  readonly draftExtraPortions = signal(0);
  readonly draftMaxMinutes = signal(35);

  readonly readOnly = computed(() => this.meal().locked || this.meal().status === 'cooked');
  readonly selectedPeople = computed(() => this.people().filter((person) => this.draftParticipantIds().includes(person.id)));
  readonly hasSelectedPerson = computed(() => this.selectedPeople().length > 0);
  readonly dietarySummary = computed(() => {
    const needs = new Set(this.selectedPeople().flatMap((person) => person.dietaryNeeds));
    const labels = [
      ...(needs.has('gluten-free') ? ['Glutenfritt'] : []),
      ...(needs.has('vegetarian') ? ['Vegetariskt'] : []),
    ];
    return labels.length ? labels.join(' · ') : 'Inga särskilda kostbehov angivna';
  });
  readonly timeOptions = computed(() => [...new Set([...TIME_LIMITS, this.meal().maxMinutes])].sort((a, b) => a - b));
  readonly readOnlyMessage = computed(() => this.meal().status === 'cooked'
    ? 'Middagen är redan markerad som lagad och kan inte ändras.'
    : 'Middagen är låst och kan inte ändras.');

  constructor() {
    const host = inject(ElementRef<HTMLElement>);
    afterNextRender(() => (host.nativeElement.querySelector('[data-panel-heading]') as HTMLElement | null)?.focus());
    effect(() => {
      const meal = this.meal();
      const people = this.people();
      const validIds = meal.participantIds.filter((id) => people.some((person) => person.id === id));
      this.draftParticipantIds.set(validIds.length ? validIds : people.slice(0, 1).map((person) => person.id));
      this.draftExtraPortions.set(Math.min(12, Math.max(0, Math.trunc(meal.extraPortions))));
      this.draftMaxMinutes.set(meal.maxMinutes);
    });
  }

  applyPreset(preset: ParticipantPreset): void {
    const validIds = preset.participantIds.filter((id) => this.people().some((person) => person.id === id));
    if (validIds.length > 0) this.draftParticipantIds.set([...new Set(validIds)]);
  }

  isSelected(person: Person): boolean {
    return this.draftParticipantIds().includes(person.id);
  }

  isOnlySelected(person: Person): boolean {
    return this.isSelected(person) && this.draftParticipantIds().length === 1;
  }

  togglePerson(person: Person, event: Event): void {
    const checked = (event.target as HTMLInputElement).checked;
    const selected = this.draftParticipantIds();
    if (checked) {
      if (!selected.includes(person.id)) this.draftParticipantIds.set([...selected, person.id]);
      return;
    }
    if (selected.length > 1) this.draftParticipantIds.set(selected.filter((id) => id !== person.id));
  }

  setExtraPortions(event: Event): void {
    const value = Number((event.target as HTMLInputElement).value);
    this.draftExtraPortions.set(Number.isFinite(value) ? Math.min(12, Math.max(0, Math.trunc(value))) : 0);
  }

  setMaxMinutesValue(value: number): void {
    if (Number.isFinite(value) && value > 0) this.draftMaxMinutes.set(value);
  }

  save(): void {
    const participantIds = this.people().filter((person) => this.draftParticipantIds().includes(person.id)).map((person) => person.id);
    if (this.readOnly() || participantIds.length === 0) return;
    this.changed.emit({
      participantIds,
      extraPortions: this.draftExtraPortions(),
      maxMinutes: this.draftMaxMinutes(),
    });
  }
}
