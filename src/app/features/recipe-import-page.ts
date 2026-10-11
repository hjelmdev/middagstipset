import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { PlannerStore } from '../core/planner.store';
import type { Recipe } from '../domain/models';
import { parseRecipeImport, type RecipeImportDraft } from '../domain/recipe-import';
import { RecipeEditorComponent } from './recipe-editor';

@Component({
  selector: 'app-recipe-import-page',
  standalone: true,
  imports: [FormsModule, RouterLink, RecipeEditorComponent],
  templateUrl: './recipe-import-page.html',
  styleUrl: './recipe-import-page.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class RecipeImportPage {
  readonly store = inject(PlannerStore);
  private readonly router = inject(Router);

  readonly source = signal('');
  readonly url = signal('');
  readonly urlLoading = signal(false);
  readonly urlSource = signal('');
  readonly draft = signal<RecipeImportDraft | null>(null);
  readonly error = signal('');

  import(): void {
    if (this.urlLoading()) return;
    this.error.set('');
    this.urlSource.set('');
    try {
      this.draft.set(parseRecipeImport(this.source()));
    } catch (error) {
      this.draft.set(null);
      this.error.set(error instanceof Error ? error.message : 'Receptet kunde inte läsas.');
    }
  }

  async importFromUrl(): Promise<void> {
    if (this.urlLoading()) return;
    const url = this.url().trim();
    this.error.set('');
    this.draft.set(null);
    this.urlSource.set('');
    if (!url) {
      this.error.set('Klistra in en receptlänk. Du kan också använda textrutan nedan.');
      return;
    }
    try {
      const parsedUrl = new URL(url);
      if (parsedUrl.protocol !== 'http:' && parsedUrl.protocol !== 'https:') {
        this.error.set('Länken måste börja med http:// eller https://. Du kan i stället klistra in recepttexten nedan.');
        return;
      }
    } catch {
      this.error.set('Ange en giltig webbadress. Du kan i stället klistra in recepttexten nedan.');
      return;
    }

    const client = this.store.auth.client;
    if (!client) {
      this.error.set('URL-importen är inte ansluten till Supabase just nu. Du kan klistra in recepttexten i rutan nedan.');
      return;
    }
    // Re-read the persisted Supabase session in case the UI signal lagged behind an OAuth refresh.
    if (!await this.store.auth.refreshUser()) {
      this.error.set('Du behöver vara inloggad via Profil för att importera en receptlänk. Du kan också klistra in recepttexten nedan.');
      return;
    }

    this.urlLoading.set(true);
    try {
      const { data, error } = await client.functions.invoke('import-recipe-url', { body: { url } });
      if (error) throw new Error(await functionErrorMessage(error));
      if (isRecord(data) && typeof data['error'] === 'string') throw new Error(data['error']);
      const recipe = isRecord(data) && isRecord(data['recipe']) ? data['recipe'] : null;
      if (!recipe) throw new Error('Hittade inget strukturerat recept. Klistra in recepttexten i rutan nedan i stället.');
      const parsed = parseRecipeImport(JSON.stringify(recipe));
      this.draft.set({
        ...parsed,
        warnings: [...parsed.warnings, 'Kostbehov, allergener och vegetarisk/glutenfri märkning från källsidan är inte verifierade. Kontrollera och rätta dem innan du sparar.'],
      });
      this.urlSource.set(url);
      this.source.set('');
    } catch (error) {
      const message = error instanceof Error ? error.message : '';
      this.error.set(`${message || 'Receptet kunde inte hämtas eller tolkas från länken.'} Du kan försöka igen eller klistra in recepttexten i rutan nedan.`);
    } finally {
      this.urlLoading.set(false);
    }
  }

  reviewAnother(): void {
    this.draft.set(null);
    this.urlSource.set('');
    this.error.set('');
  }

  cancelImport(): void {
    void this.router.navigate(['/recept']);
  }

  save(recipe: Recipe): void {
    this.store.addRecipe(recipe);
    if (this.store.actionNotice()) return;
    this.draft.set(null);
    this.urlSource.set('');
    void this.router.navigate(['/recept']);
  }
}

async function functionErrorMessage(error: unknown): Promise<string> {
  const context = isRecord(error) ? error['context'] : null;
  if (context instanceof Response) {
    try {
      const payload: unknown = await context.clone().json();
      if (isRecord(payload) && typeof payload['error'] === 'string') return payload['error'];
    } catch { /* Fall through to a safe generic error. */ }
  }
  return 'Receptet kunde inte hämtas från länken.';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
