import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import type { AppState } from '../domain/models';
import { backupOverview, createBackup, MAX_BACKUP_BYTES, parseBackup } from '../domain/data-backup';
import { PlannerStore } from '../core/planner.store';

interface BackupDraft {
  state: AppState;
  fileName: string;
  overview: ReturnType<typeof backupOverview>;
  exportedAt: string;
}

@Component({
  selector: 'app-data-backup-page',
  standalone: true,
  templateUrl: './data-backup-page.html',
  styleUrl: './data-backup-page.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class DataBackupPage {
  readonly store = inject(PlannerStore);
  readonly draft = signal<BackupDraft | null>(null);
  readonly previousState = signal<AppState | null>(null);
  readonly confirmed = signal(false);
  readonly busy = signal(false);
  readonly message = signal('');
  readonly error = signal('');
  private readGeneration = 0;
  readonly currentOverview = computed(() => {
    const state = this.store.state();
    return state ? backupOverview(state) : null;
  });

  async readFile(event: Event): Promise<void> {
    const generation = ++this.readGeneration;
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    this.error.set('');
    this.message.set('');
    this.draft.set(null);
    this.confirmed.set(false);
    if (!file) return;
    if (file.size > MAX_BACKUP_BYTES) {
      this.error.set('Filen är större än 5 MB. Välj en mindre säkerhetskopia.');
      return;
    }
    try {
      const contents = await file.text();
      if (generation !== this.readGeneration) return;
      const state = parseBackup(contents);
      const parsed = JSON.parse(contents) as { exportedAt: string };
      this.draft.set({ state, fileName: file.name, overview: backupOverview(state), exportedAt: parsed.exportedAt });
      this.message.set('Säkerhetskopian är kontrollerad. Ingen data har ändrats.');
    } catch (cause) {
      if (generation !== this.readGeneration) return;
      this.error.set(cause instanceof Error ? cause.message : 'Filen kunde inte läsas.');
    }
  }

  exportCurrent(): void {
    const state = this.store.state();
    if (!state) {
      this.error.set('Data har inte laddats ännu.');
      return;
    }
    try {
      const backup = createBackup(state);
      const blob = new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `middagstipset-${backup.exportedAt.slice(0, 10)}.json`;
      link.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 0);
      this.error.set('');
      this.message.set('Säkerhetskopian har laddats ner.');
    } catch {
      this.error.set('Säkerhetskopian kunde inte skapas.');
    }
  }

  async restore(): Promise<void> {
    const draft = this.draft();
    const current = this.store.state();
    if (!draft || !current || !this.confirmed() || this.busy()) return;
    this.busy.set(true);
    this.error.set('');
    this.message.set('');
    const rollback = structuredClone(current);
    try {
      await this.store.flush();
      this.store.restoreBackup(structuredClone(draft.state));
      this.previousState.set(rollback);
      await this.store.flush();
      this.draft.set(null);
      this.confirmed.set(false);
      this.message.set('Säkerhetskopian har återställts. Du kan ångra så länge sidan är öppen.');
    } catch (cause) {
      this.error.set(cause instanceof Error ? cause.message : 'Säkerhetskopian kunde inte återställas. Utkastet finns kvar så att du kan försöka igen.');
    } finally {
      this.busy.set(false);
    }
  }

  async undoRestore(): Promise<void> {
    const previous = this.previousState();
    if (!previous || this.busy()) return;
    this.busy.set(true);
    this.error.set('');
    this.message.set('');
    try {
      try {
        await this.store.flush();
      } catch (cause) {
        if (!this.store.storageNotice()) throw cause;
      }
      this.store.restoreBackup(structuredClone(previous));
      await this.store.flush();
      this.previousState.set(null);
      this.message.set('Återställningen är ångrad.');
    } catch (cause) {
      this.error.set(cause instanceof Error ? cause.message : 'Återställningen kunde inte ångras.');
    } finally {
      this.busy.set(false);
    }
  }

  formatDate(value: string): string {
    return new Intl.DateTimeFormat('sv-SE', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value));
  }
}
