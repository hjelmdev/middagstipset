import { afterNextRender, ChangeDetectionStrategy, Component, computed, effect, inject, Injector, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import type { CookBatch, LunchPlan, Person, Recipe } from '../domain/models';
import { batchLunchCompatibilityError } from '../domain/cook-batches';
import { lunchCompatibilityError, lunchSourceId, lunchSourceType, portionNeed, type LunchSource } from '../domain/leftovers';
import { localDate, shiftDate } from '../domain/meal-engine';
import { PlannerStore } from '../core/planner.store';
import { RecipeDetailComponent } from './recipe-detail';
import { CookBatchFormComponent, type CookBatchDraft } from './cook-batch-form';

interface LunchDisplayRow {
  lunch: LunchPlan;
  source: LunchSource | null;
  sourceName: string;
  sourceDate?: string;
  sourceKind?: 'meal' | 'batch';
  sourceIsPrepared: boolean;
  image?: string;
  imageAlt?: string;
}

interface CookBatchDisplayRow {
  batch: CookBatch;
  reservedPortions: number;
  availablePortions: number;
}

@Component({
  selector: 'app-lunch-page',
  imports: [FormsModule, RouterLink, RecipeDetailComponent, CookBatchFormComponent],
  templateUrl: './lunch-page.html',
  styleUrl: './lunch-page.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class LunchPage {
  readonly store = inject(PlannerStore);
  private readonly injector = inject(Injector);
  private returnScrollTop = 0;
  readonly lunchDate = signal(this.store.todayDate());
  readonly selectedSourceId = signal('');
  readonly selectedParticipantIds = signal<string[]>([]);
  readonly message = signal('');
  readonly batchMessage = signal('');
  readonly batchFormOpen = signal(false);
  readonly selectedRecipe = signal<Recipe | null>(null);
  readonly selectedRecipePeople = signal<Person[]>([]);
  readonly selectedRecipeExtraPortions = signal(0);
  private participantsInitialized = false;

  readonly householdPeople = computed(() => this.store.state()?.household.people ?? []);
  readonly maxDate = computed(() => shiftDate(this.store.todayDate(), 28));
  readonly availableSources = computed(() => this.store.lunchSources().filter(source => source.availablePortions > 0));
  readonly selectedSource = computed(() => {
    const sources = this.availableSources().filter(source => this.effectiveSourceDate(source) <= this.lunchDate());
    return sources.find(source => source.id === this.selectedSourceId()) ?? sources[0] ?? null;
  });
  readonly selectedPeople = computed(() => {
    const selected = new Set(this.selectedParticipantIds());
    return this.householdPeople().filter(person => selected.has(person.id));
  });
  readonly expectedPortions = computed(() => portionNeed(this.selectedPeople().map(person => person.id), this.householdPeople()));
  readonly compatibilityError = computed(() => {
    const source = this.selectedSource();
    if (!source) return '';
    return source.kind === 'batch'
      ? batchLunchCompatibilityError(source.batch, this.selectedPeople())
      : lunchCompatibilityError(source.recipe, source.people, this.selectedPeople(), source.meal);
  });
  readonly canReserve = computed(() => {
    const source = this.selectedSource();
    return !!source && this.lunchDate() >= this.store.todayDate() && this.lunchDate() <= this.maxDate() &&
      this.lunchDate() >= this.effectiveSourceDate(source) &&
      this.selectedPeople().length > 0 && this.expectedPortions() > 0 &&
      this.expectedPortions() <= source.availablePortions + 0.000001 && !this.compatibilityError();
  });
  readonly batchRows = computed<CookBatchDisplayRow[]>(() => this.store.cookBatches().map(batch => {
    const reservedPortions = this.store.lunchPlans().filter(lunch => lunchSourceType(lunch) === 'batch' && lunchSourceId(lunch) === batch.id)
      .reduce((sum, lunch) => sum + lunch.portions, 0);
    return { batch, reservedPortions, availablePortions: Math.max(0, batch.portions - reservedPortions) };
  }).sort((a, b) => a.batch.date.localeCompare(b.batch.date)));
  readonly lunchRows = computed<LunchDisplayRow[]>(() => {
    const sources = this.store.lunchSources();
    return this.store.lunchPlans().map(lunch => {
      const source = sources.find(item => item.id === lunchSourceId(lunch) && item.kind === lunchSourceType(lunch)) ?? null;
      const sourceDate = source ? this.effectiveSourceDate(source) : undefined;
      return {
        lunch,
        source,
        sourceName: source?.recipe.name ?? 'Lunchkälla saknas',
        sourceDate,
        sourceKind: source?.kind,
        sourceIsPrepared: source ? this.sourceIsPrepared(source) : false,
        image: source?.recipe.image,
        imageAlt: source?.recipe.imageAlt,
      };
    }).sort((a, b) => a.lunch.date.localeCompare(b.lunch.date));
  });
  readonly plannedLunches = computed(() => this.lunchRows()
    .filter(row => row.lunch.status === 'planned' && row.lunch.date >= this.store.todayDate()));
  readonly historicalLunches = computed(() => this.lunchRows()
    .filter(row => row.lunch.status === 'eaten' || row.lunch.date < this.store.todayDate())
    .sort((a, b) => b.lunch.date.localeCompare(a.lunch.date)));

  constructor() {
    effect(() => {
      const people = this.householdPeople();
      if (!this.participantsInitialized && people.length) {
        this.selectedParticipantIds.set(people.map(person => person.id));
        this.participantsInitialized = true;
      }
    });
  }

  setLunchDate(date: string): void {
    this.lunchDate.set(date);
  }

  setSource(sourceId: string): void {
    this.selectedSourceId.set(sourceId);
    const source = this.availableSources().find(candidate => candidate.id === sourceId);
    if (!source) return;
    const currentPeople = new Set(this.householdPeople().map(person => person.id));
    if (source.kind === 'meal') {
      const sourcePeople = source.people.map(person => person.id).filter(id => currentPeople.has(id));
      this.selectedParticipantIds.set(sourcePeople.length ? sourcePeople : [...currentPeople]);
    } else this.selectedParticipantIds.set([...currentPeople]);
  }

  toggleParticipant(personId: string): void {
    this.selectedParticipantIds.update(ids => ids.includes(personId)
      ? ids.filter(id => id !== personId)
      : [...ids, personId]);
  }

  reserveLunch(): void {
    const source = this.selectedSource();
    if (!source || !this.canReserve()) return;
    const error = this.store.planLunch(this.lunchDate(), source.id, this.selectedPeople().map(person => person.id));
    this.message.set(error || 'Lunchlådan är reserverad.');
  }

  removeLunch(id: string): void {
    const error = this.store.removeLunch(id);
    this.message.set(error || 'Lunchplanen är borttagen.');
  }

  markEaten(row: LunchDisplayRow): void {
    const error = this.store.markLunchEaten(row.lunch.id);
    this.message.set(error || 'Lunchlådan är markerad som uppäten.');
  }

  undoEaten(id: string): void {
    this.store.undoLunchEaten(id);
    this.message.set('Markeringen som uppäten är ångrad.');
  }

  formatDate(date: string): string {
    return new Intl.DateTimeFormat('sv-SE', { weekday: 'long', day: 'numeric', month: 'short' })
      .format(new Date(`${date}T12:00:00`));
  }

  formatPortions(value: number): string {
    return new Intl.NumberFormat('sv-SE', { maximumFractionDigits: 2 }).format(value);
  }

  selectedSourceValue(): string {
    return this.selectedSource()?.id ?? '';
  }

  sourceLabel(source: LunchSource): string {
    const kind = source.kind === 'batch' ? 'Storkok' : 'Middag';
    const status = this.sourceIsPrepared(source) ? 'Tillagad' : 'Planerad';
    return `${kind} · ${source.recipe.name} · ${this.formatDate(this.effectiveSourceDate(source))} · ${this.formatPortions(source.availablePortions)} portioner kvar · ${status}`;
  }

  effectiveSourceDate(source: LunchSource): string {
    return source.kind === 'batch' && source.batch.status === 'prepared' && source.batch.preparedAt
      ? localDate(new Date(source.batch.preparedAt))
      : source.date;
  }

  sourceIsPrepared(source: LunchSource): boolean {
    return source.kind === 'batch' ? source.status === 'prepared' : source.status === 'cooked';
  }

  preparedDate(batch: CookBatch): string {
    return batch.preparedAt ? localDate(new Date(batch.preparedAt)) : batch.date;
  }

  sourceKindLabel(kind?: 'meal' | 'batch'): string {
    return kind === 'batch' ? 'Storkok' : kind === 'meal' ? 'Middag' : 'Källa saknas';
  }

  batchNeedsLabel(needs: CookBatch['needs']): string {
    if (!needs.length) return 'Inget särskilt kostkrav';
    return needs.map(need => need === 'vegetarian' ? 'vegetarisk' : 'glutenfri').join(' · ');
  }

  createBatch(draft: CookBatchDraft): void {
    const error = this.store.createCookBatch(draft.recipeId, draft.date, draft.portions, draft.needs);
    this.batchMessage.set(error ? '' : 'Storkoket är planerat.');
    if (!error) this.batchFormOpen.set(false);
  }

  prepareBatch(id: string): void {
    const error = this.store.markCookBatchPrepared(id);
    this.batchMessage.set(error ? '' : 'Storkoket är markerat som tillagat idag.');
  }

  undoBatch(id: string): void {
    const error = this.store.undoCookBatchPrepared(id);
    this.batchMessage.set(error ? '' : 'Tillagningsmarkeringen är ångrad.');
  }

  removeBatch(id: string): void {
    const error = this.store.removeCookBatch(id);
    this.batchMessage.set(error ? '' : 'Storkoket är borttaget.');
  }

  openBatchRecipe(batch: CookBatch): void {
    this.returnScrollTop = window.scrollY;
    this.selectedRecipe.set(batch.recipeSnapshot);
    this.selectedRecipePeople.set([{ id: `batch:${batch.id}`, name: 'Storkok', portionFactor: batch.portions, dietaryNeeds: [...batch.needs] }]);
    this.selectedRecipeExtraPortions.set(0);
    afterNextRender(() => window.scrollTo({ top: 0, behavior: 'instant' }), { injector: this.injector });
  }

  closeRecipe(): void {
    this.selectedRecipe.set(null);
    this.selectedRecipePeople.set([]);
    this.selectedRecipeExtraPortions.set(0);
    const top = this.returnScrollTop;
    afterNextRender(() => window.scrollTo({ top, behavior: 'instant' }), { injector: this.injector });
  }

  openRecipe(source: LunchSource): void {
    this.returnScrollTop = window.scrollY;
    this.selectedRecipe.set(source.recipe);
    if (source.kind === 'meal') {
      this.selectedRecipePeople.set(source.people);
      this.selectedRecipeExtraPortions.set(source.meal.cookedSnapshot?.extraPortions ?? source.meal.extraPortions);
    } else {
      this.selectedRecipePeople.set([{ id: `batch:${source.batch.id}`, name: 'Storkok', portionFactor: source.batch.portions, dietaryNeeds: [...source.batch.needs] }]);
      this.selectedRecipeExtraPortions.set(0);
    }
    afterNextRender(() => window.scrollTo({ top: 0, behavior: 'instant' }), { injector: this.injector });
  }
}
