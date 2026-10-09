import { ChangeDetectionStrategy, Component, input } from '@angular/core';

// Small, local outline icons. Labels on the controls carry their accessible names.
@Component({
  selector: 'app-icon',
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: [':host { display: inline-flex; flex-shrink: 0; } svg { width: 1.4em; height: 1.4em; }'],
  template: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">
    @switch (name()) {
      @case ('home') { <path d="m3 10 9-7 9 7M5 9v11h14V9M9 20v-7h6v7" /> }
      @case ('calendar') { <rect x="3" y="5" width="18" height="16" rx="2" /><path d="M16 3v4M8 3v4M3 11h18M8 15h.01M12 15h.01M16 15h.01M8 18h.01M12 18h.01" /> }
      @case ('book') { <path d="M12 5v16M12 5C9 3 5 3 3 4v15c3-1 6-1 9 2 3-3 6-3 9-2V4c-2-1-6-1-9 1Z" /> }
      @case ('cart') { <path d="M3 3h2l3 12h11l2-8H6M9 15l-1 3h12" /><circle cx="9" cy="21" r="1" /><circle cx="19" cy="21" r="1" /> }
      @case ('user') { <circle cx="12" cy="8" r="4" /><path d="M4 21v-2a8 8 0 0 1 16 0v2" /> }
      @case ('chevron') { <path d="m6 9 6 6 6-6" /> }
      @case ('shuffle') { <path d="M3 6h3c4 0 8 12 12 12h3M18 15l3 3-3 3M3 18h3c1.5 0 3-2 4-4M14 10c1.5-2 2.5-4 4-4h3M18 3l3 3-3 3" /> }
      @case ('lock') { <rect x="5" y="10" width="14" height="11" rx="2" /><path d="M8 10V7a4 4 0 0 1 8 0v3M12 14v3" /> }
      @case ('unlock') { <rect x="5" y="10" width="14" height="11" rx="2" /><path d="M8 10V7a4 4 0 0 1 7-2M12 14v3" /> }
    }
  </svg>`,
})
export class IconComponent {
  readonly name = input.required<'home' | 'calendar' | 'book' | 'cart' | 'user' | 'chevron' | 'shuffle' | 'lock' | 'unlock'>();
}
