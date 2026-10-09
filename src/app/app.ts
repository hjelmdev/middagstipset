import { ChangeDetectionStrategy, Component, HostListener, inject, signal } from '@angular/core';
import { NavigationEnd, Router, RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { IconComponent } from './shared/icon';
import { AuthService } from './core/auth.service';
import { PlannerStore } from './core/planner.store';
@Component({ selector: 'app-root', imports: [RouterLink, RouterLinkActive, RouterOutlet, IconComponent], templateUrl: './app.html', changeDetection: ChangeDetectionStrategy.OnPush })
export class App {
  readonly auth = inject(AuthService);
  readonly store = inject(PlannerStore);
  readonly profileOpen = signal(false);
  readonly palette = signal<'coral' | 'blue' | 'green'>('green');
  constructor() {
    try {
      const saved = localStorage.getItem('middagstipset.palette');
      if (saved === 'coral' || saved === 'blue' || saved === 'green') this.palette.set(saved);
    } catch { /* The appearance still works when browser storage is unavailable. */ }
    document.documentElement.dataset['palette'] = this.palette();
    void this.auth.initialize();
    inject(Router).events.pipe(takeUntilDestroyed()).subscribe(event => {
      if (event instanceof NavigationEnd) this.profileOpen.set(false);
      if (event instanceof NavigationEnd) this.store.refreshToday();
    });
  }
  setPalette(value: 'coral' | 'blue' | 'green'): void {
    this.palette.set(value);
    document.documentElement.dataset['palette'] = value;
    try { localStorage.setItem('middagstipset.palette', value); } catch { /* Keep the current choice for this visit. */ }
  }
  @HostListener('document:click', ['$event'])
  closeProfileOutside(event: MouseEvent): void {
    if (!(event.target as Element | null)?.closest('.profile-menu')) this.profileOpen.set(false);
  }
  @HostListener('document:keydown.escape')
  closeProfile(): void {
    if (this.profileOpen()) { this.profileOpen.set(false); document.getElementById('profile-button')?.focus(); }
  }
  focusMain(): void { document.getElementById('main')?.focus(); }
  @HostListener('window:focus')
  refreshDate(): void { this.store.refreshToday(); }
  @HostListener('window:beforeunload', ['$event'])
  protectUnsavedChanges(event: BeforeUnloadEvent): void {
    if (this.store.saving() || this.store.storageNotice()) event.preventDefault();
  }
}

