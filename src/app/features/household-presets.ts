import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { PlannerStore } from '../core/planner.store';
import type { ParticipantPreset, Person } from '../domain/models';

@Component({
  selector: 'app-household-presets',
  standalone: true,
  templateUrl: './household-presets.html',
  styleUrl: './household-presets.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class HouseholdPresetsComponent {
  readonly store = inject(PlannerStore);
  readonly people = computed(() => this.store.state()?.household.people ?? []);
  readonly presets = computed(() => this.store.state()?.participantPresets ?? []);
  readonly name = signal('');
  readonly selectedIds = signal<string[]>([]);
  readonly savedMessage = signal('');

  isSelected(person: Person): boolean {
    return this.selectedIds().includes(person.id);
  }

  togglePerson(person: Person, event: Event): void {
    const checked = (event.target as HTMLInputElement).checked;
    this.selectedIds.update(ids => checked
      ? [...new Set([...ids, person.id])]
      : ids.filter(id => id !== person.id));
    this.savedMessage.set('');
  }

  setName(event: Event): void {
    this.name.set((event.target as HTMLInputElement).value.slice(0, 80));
    this.savedMessage.set('');
  }

  save(): void {
    const name = this.name().trim();
    const validIds = this.people().filter(person => this.selectedIds().includes(person.id)).map(person => person.id);
    if (!name || name.length > 80 || validIds.length === 0) return;
    const preset: ParticipantPreset = { id: crypto.randomUUID(), name, participantIds: validIds };
    this.store.savePreset(preset);
    this.name.set('');
    this.savedMessage.set(`${name} är sparat.`);
  }

  remove(preset: ParticipantPreset): void {
    this.store.removePreset(preset.id);
    this.savedMessage.set(`${preset.name} är borttaget.`);
  }
}
