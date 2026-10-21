import { ChangeDetectionStrategy, Component, computed, DestroyRef, inject, input, output, signal } from '@angular/core';
import { Ingredient, Person, Recipe } from '../domain/models';
import { portionCount, scaleIngredients, supportsNeeds } from '../domain/meal-engine';

interface WakeLockSentinelLike {
  readonly released: boolean;
  release(): Promise<void>;
  addEventListener(type: 'release', listener: () => void, options?: { once?: boolean }): void;
}

interface WakeLockApiLike {
  request(type: 'screen'): Promise<WakeLockSentinelLike>;
}

@Component({
  selector: 'app-recipe-detail',
  standalone: true,
  templateUrl: './recipe-detail.html',
  styleUrl: './recipe-detail.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class RecipeDetailComponent {
  readonly recipe = input.required<Recipe>();
  readonly people = input.required<Person[]>();
  readonly extraPortions = input(0);
  readonly canMarkCooked = input(false);

  readonly closed = output<void>();
  readonly cooked = output<void>();

  readonly servingCount = computed(() => portionCount(this.people(), this.extraPortions()));
  readonly supportsDietaryNeeds = computed(() => supportsNeeds(this.recipe(), this.people()));
  readonly scaledIngredients = computed(() => this.supportsDietaryNeeds()
    ? scaleIngredients(this.recipe(), this.people(), this.extraPortions())
    : []);
  readonly needsGlutenFree = computed(() => this.people().some((person) => person.dietaryNeeds.includes('gluten-free')));
  readonly hasVegetarianNeed = computed(() => this.people().some((person) => person.dietaryNeeds.includes('vegetarian')));
  readonly showGlutenFreeBadge = computed(() => this.recipe().dietaryNeeds.includes('gluten-free')
    && this.recipe().glutenStrategy === 'naturally-free'
    && this.recipe().ingredients.every((ingredient) => !ingredient.allergens.includes('gluten')));
  readonly viewMode = signal<'compact' | 'stepwise'>('compact');
  readonly currentStepIndex = signal(0);
  readonly checkedIngredientIds = signal<Set<string>>(new Set());
  readonly wakeLockSupported = computed(() => this.wakeLockApi() !== null);
  readonly wakeLockEnabled = signal(false);
  readonly wakeLockMessage = signal('');

  private readonly destroyRef = inject(DestroyRef);
  private wakeLockSentinel: WakeLockSentinelLike | null = null;

  constructor() {
    if (typeof document !== 'undefined') document.addEventListener('visibilitychange', this.onVisibilityChange);
    this.destroyRef.onDestroy(() => {
      this.wakeLockEnabled.set(false);
      if (typeof document !== 'undefined') document.removeEventListener('visibilitychange', this.onVisibilityChange);
      void this.releaseWakeLock();
    });
  }

  get imageKindLabel(): string {
    switch (this.recipe().imageKind) {
      case 'illustration': return 'Illustration';
      case 'ai-generated': return 'AI-genererad bild';
      case 'photo': return 'Foto';
    }
  }

  get currentStepNumber(): number {
    return Math.min(this.currentStepIndex() + 1, this.recipe().steps.length);
  }

  isIngredientChecked(ingredient: Ingredient): boolean {
    return this.checkedIngredientIds().has(ingredient.id);
  }

  toggleIngredient(ingredient: Ingredient): void {
    this.checkedIngredientIds.update((checked) => {
      const next = new Set(checked);
      if (next.has(ingredient.id)) next.delete(ingredient.id);
      else next.add(ingredient.id);
      return next;
    });
  }

  setViewMode(mode: 'compact' | 'stepwise'): void {
    this.viewMode.set(mode);
    this.currentStepIndex.set(0);
  }

  previousStep(): void {
    this.currentStepIndex.update((index) => Math.max(0, index - 1));
  }

  nextStep(): void {
    this.currentStepIndex.update((index) => Math.min(this.recipe().steps.length - 1, index + 1));
  }

  formatQuantity(quantity: number): string {
    return new Intl.NumberFormat('sv-SE', { maximumFractionDigits: 2 }).format(quantity);
  }

  async toggleWakeLock(): Promise<void> {
    if (this.wakeLockEnabled()) {
      this.wakeLockEnabled.set(false);
      this.wakeLockMessage.set('');
      await this.releaseWakeLock();
      return;
    }

    this.wakeLockMessage.set('');
    this.wakeLockEnabled.set(true);
    await this.acquireWakeLock();
    if (!this.wakeLockSentinel) this.wakeLockEnabled.set(false);
  }

  ingredientName(ingredient: Ingredient): string {
    return ingredient.name;
  }

  private wakeLockApi(): WakeLockApiLike | null {
    if (typeof navigator === 'undefined') return null;
    return (navigator as Navigator & { wakeLock?: WakeLockApiLike }).wakeLock ?? null;
  }

  private readonly onVisibilityChange = (): void => {
    if (document.hidden) {
      void this.releaseWakeLock();
    } else if (this.wakeLockEnabled()) {
      void this.acquireWakeLock();
    }
  };

  private async acquireWakeLock(): Promise<void> {
    const wakeLock = this.wakeLockApi();
    if (!wakeLock || typeof document === 'undefined' || document.hidden || this.wakeLockSentinel) return;
    try {
      const sentinel = await wakeLock.request('screen');
      if (this.destroyRef.destroyed || !this.wakeLockEnabled() || document.hidden) { await sentinel.release(); return; }
      this.wakeLockSentinel = sentinel;
      this.wakeLockMessage.set('');
      sentinel.addEventListener('release', () => {
        if (this.wakeLockSentinel === sentinel) this.wakeLockSentinel = null;
      }, { once: true });
    } catch {
      this.wakeLockMessage.set('Enheten kunde inte hålla skärmen vaken just nu.');
    }
  }

  private async releaseWakeLock(): Promise<void> {
    const sentinel = this.wakeLockSentinel;
    this.wakeLockSentinel = null;
    if (!sentinel || sentinel.released) return;
    try {
      await sentinel.release();
    } catch {
      // Best-effort release on close or when the document is hidden.
    }
  }

}
