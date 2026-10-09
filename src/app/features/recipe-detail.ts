import { ChangeDetectionStrategy, Component, computed, DestroyRef, inject, input, output, signal } from '@angular/core';
import { Ingredient, Person, Recipe } from '../domain/models';
import { portionCount, scaleIngredients, supportsNeeds } from '../domain/meal-engine';

type TimerStatus = 'idle' | 'running' | 'paused' | 'done';

interface StepTimer {
  status: TimerStatus;
  remainingSeconds: number;
  endsAt: number | null;
}

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
  readonly hasTimers = computed(() => this.recipe().steps.some((step) => (step.timerMinutes ?? 0) > 0));

  readonly viewMode = signal<'compact' | 'stepwise'>('compact');
  readonly currentStepIndex = signal(0);
  readonly checkedIngredientIds = signal<Set<string>>(new Set());
  readonly stepTimers = signal<Record<number, StepTimer>>({});
  readonly backgroundTimers = computed(() => this.recipe().steps.flatMap((step, stepIndex) => {
    const timer = this.stepTimers()[stepIndex];
    return step.timerMinutes && timer && timer.status !== 'idle' && stepIndex !== this.currentStepIndex()
      ? [{ stepIndex, minutes: step.timerMinutes }]
      : [];
  }));
  readonly wakeLockSupported = computed(() => this.wakeLockApi() !== null);
  readonly wakeLockEnabled = signal(false);
  readonly wakeLockMessage = signal('');

  private readonly destroyRef = inject(DestroyRef);
  private timerInterval: ReturnType<typeof setInterval> | null = null;
  private wakeLockSentinel: WakeLockSentinelLike | null = null;

  constructor() {
    if (typeof document !== 'undefined') document.addEventListener('visibilitychange', this.onVisibilityChange);
    this.destroyRef.onDestroy(() => {
      this.stopTimerInterval();
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

  timerStatus(stepIndex: number): TimerStatus {
    return this.timerFor(stepIndex).status;
  }

  timerDisplay(stepIndex: number, minutes: number): string {
    const seconds = this.timerFor(stepIndex, minutes).remainingSeconds;
    const mins = Math.floor(seconds / 60);
    const remainder = seconds % 60;
    return `${String(mins).padStart(2, '0')}:${String(remainder).padStart(2, '0')}`;
  }

  startTimer(stepIndex: number, minutes: number): void {
    const current = this.timerFor(stepIndex, minutes);
    if (current.status === 'running' || current.status === 'done' || current.remainingSeconds <= 0) return;
    this.setTimer(stepIndex, {
      status: 'running',
      remainingSeconds: current.remainingSeconds,
      endsAt: Date.now() + current.remainingSeconds * 1000,
    });
    this.startTimerInterval();
  }

  pauseTimer(stepIndex: number, minutes: number): void {
    const current = this.timerFor(stepIndex, minutes);
    if (current.status !== 'running' || current.endsAt === null) return;
    const remainingSeconds = Math.max(0, Math.ceil((current.endsAt - Date.now()) / 1000));
    this.setTimer(stepIndex, {
      status: remainingSeconds === 0 ? 'done' : 'paused',
      remainingSeconds,
      endsAt: null,
    });
    this.stopIntervalIfIdle();
  }

  resetTimer(stepIndex: number, minutes: number): void {
    this.setTimer(stepIndex, { status: 'idle', remainingSeconds: minutes * 60, endsAt: null });
    this.stopIntervalIfIdle();
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

  private timerFor(stepIndex: number, minutes = this.recipe().steps[stepIndex]?.timerMinutes ?? 0): StepTimer {
    return this.stepTimers()[stepIndex] ?? { status: 'idle', remainingSeconds: Math.max(0, minutes) * 60, endsAt: null };
  }

  private setTimer(stepIndex: number, timer: StepTimer): void {
    this.stepTimers.update((timers) => ({ ...timers, [stepIndex]: timer }));
  }

  private startTimerInterval(): void {
    if (this.timerInterval !== null) return;
    this.timerInterval = setInterval(() => this.updateRunningTimers(), 1000);
  }

  private updateRunningTimers(): void {
    const now = Date.now();
    let running = false;
    this.stepTimers.update((timers) => {
      let changed = false;
      const next = { ...timers };
      for (const [key, timer] of Object.entries(timers)) {
        if (timer.status !== 'running' || timer.endsAt === null) continue;
        changed = true;
        const remainingSeconds = Math.max(0, Math.ceil((timer.endsAt - now) / 1000));
        if (remainingSeconds === 0) {
          next[Number(key)] = { status: 'done', remainingSeconds: 0, endsAt: null };
        } else {
          next[Number(key)] = { ...timer, remainingSeconds };
          running = true;
        }
      }
      return changed ? next : timers;
    });
    if (!running) this.stopTimerInterval();
  }

  private stopIntervalIfIdle(): void {
    if (Object.values(this.stepTimers()).some((timer) => timer.status === 'running')) return;
    this.stopTimerInterval();
  }

  private stopTimerInterval(): void {
    if (this.timerInterval === null) return;
    clearInterval(this.timerInterval);
    this.timerInterval = null;
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
