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
  readonly draft = signal<RecipeImportDraft | null>(null);
  readonly error = signal('');

  import(): void {
    this.error.set('');
    try {
      this.draft.set(parseRecipeImport(this.source()));
    } catch (error) {
      this.draft.set(null);
      this.error.set(error instanceof Error ? error.message : 'Receptet kunde inte läsas.');
    }
  }

  reviewAnother(): void {
    this.draft.set(null);
    this.error.set('');
  }

  cancelImport(): void {
    void this.router.navigate(['/recept']);
  }

  save(recipe: Recipe): void {
    this.store.addRecipe(recipe);
    if (this.store.actionNotice()) return;
    this.draft.set(null);
    void this.router.navigate(['/recept']);
  }
}
