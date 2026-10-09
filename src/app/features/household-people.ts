import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { PlannerStore } from '../core/planner.store';
import type { Person } from '../domain/models';

@Component({ selector: 'app-household-people', imports: [FormsModule], changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <h2>Personer vid bordet</h2>
    <p class="small muted">Portionsstorlek och kostbehov används för förslag och inköpsmängder.</p>
    @for (person of store.state()?.household?.people; track person.id) {
      <div class="person"><div><strong>{{ person.name }}</strong><p class="small">{{ person.portionFactor }} portion · {{ needs(person) }}</p></div><button class="secondary" (click)="edit(person)">Ändra</button></div>
    }
    @if (draft(); as person) {
      <form (ngSubmit)="save()">
        <label>Namn<input name="personName" maxlength="80" required [ngModel]="person.name" (ngModelChange)="patch({name: $event})"></label>
        <label>Portionsstorlek<select name="portion" [ngModel]="person.portionFactor" (ngModelChange)="patch({portionFactor: +$event})"><option [ngValue]="0.5">Liten · ½ portion</option><option [ngValue]="0.75">Mellan · ¾ portion</option><option [ngValue]="1">Standard · 1 portion</option><option [ngValue]="1.5">Stor · 1½ portion</option></select></label>
        <label class="check"><input type="checkbox" name="vegetarian" [ngModel]="person.dietaryNeeds.includes('vegetarian')" (ngModelChange)="toggle('vegetarian', $event)">Vegetariskt</label>
        <label class="check"><input type="checkbox" name="gluten" [ngModel]="person.dietaryNeeds.includes('gluten-free')" (ngModelChange)="toggle('gluten-free', $event)">Glutenfritt</label>
        <p class="small muted">Kontrollera alltid märkningen på de produkter du använder. Redan valda middagar behålls; de som inte passar markeras i planen.</p>
        <div class="buttons"><button class="primary" type="submit" [disabled]="!person.name.trim()">Spara person</button><button class="secondary" type="button" (click)="draft.set(null)">Avbryt</button></div>
      </form>
    } @else { <button class="secondary" (click)="add()">Lägg till person</button> }
    @if (saved()) { <p role="status" class="small">{{ saved() }}</p> }
    <p class="small muted">Nya personer läggs till på tomma dagar. Ändra deltagare på en redan planerad dag via Personer i Planera.</p>
  `,
  styles: `:host{display:block;min-width:0}.person{display:flex;justify-content:space-between;align-items:center;gap:12px;padding:12px 0;border-bottom:1px solid var(--line)}.person>div{min-width:0;overflow-wrap:anywhere}.person p{margin:4px 0}form{display:grid;gap:12px;margin:16px 0}label{display:grid;gap:5px;min-width:0}input,select{min-height:44px;max-width:100%;min-width:0;width:100%;font-size:16px}.check{display:flex;align-items:center;gap:10px}.check input{min-height:auto;width:20px;height:20px}.buttons{display:flex;gap:8px;flex-wrap:wrap}` })
export class HouseholdPeopleComponent {
  readonly store = inject(PlannerStore);
  readonly draft = signal<Person | null>(null);
  readonly saved = signal('');
  edit(person: Person): void { this.saved.set(''); this.draft.set({ ...person, dietaryNeeds: [...person.dietaryNeeds] }); }
  add(): void { this.edit({ id: crypto.randomUUID(), name: '', portionFactor: 1, dietaryNeeds: [] }); }
  patch(patch: Partial<Person>): void { this.draft.update(person => person ? { ...person, ...patch } : null); }
  toggle(need: 'vegetarian' | 'gluten-free', selected: boolean): void {
    const person = this.draft(); if (!person) return;
    this.patch({ dietaryNeeds: selected ? [...new Set([...person.dietaryNeeds, need])] : person.dietaryNeeds.filter(value => value !== need) });
  }
  save(): void { const person = this.draft(); if (!person?.name.trim()) return; this.store.savePerson(person); if (this.store.actionNotice()) return; this.draft.set(null); this.saved.set(`${person.name.trim()} är sparad.`); }
  needs(person: Person): string { return person.dietaryNeeds.map(need => need === 'vegetarian' ? 'vegetariskt' : 'glutenfritt').join(', ') || 'inga valda kostbehov'; }
}
