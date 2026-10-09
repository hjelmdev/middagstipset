import { ChangeDetectionStrategy, Component, effect, input, output } from '@angular/core';
import { FormsModule } from '@angular/forms';
import type { Ingredient, Person, Recipe } from '../domain/models';
import { RECIPES } from '../data/recipes';
import { buildIngredientCatalog, findIngredient, normalizeIngredientName } from '../domain/ingredient-catalog';
import type { RecipeImportDraft } from '../domain/recipe-import';
import { preservedVariantGlutenMetadata } from '../domain/recipe-variants';
import { supportsNeeds } from '../domain/meal-engine';
import { IconComponent } from '../shared/icon';

type GlutenStatus = 'unknown' | 'contains' | 'free';

interface IngredientDraft {
  id: string;
  originalName: string;
  name: string;
  quantity: number | null;
  unit: Ingredient['unit'] | null;
  category: Ingredient['category'];
  glutenStatus: GlutenStatus;
  originalGlutenStatus: GlutenStatus;
  originalComponent: string;
  otherAllergens: Ingredient['allergens'];
  glutenFreeAlternative?: Ingredient['glutenFreeAlternative'];
  quantityHint: string;
  needsUnitReview: boolean;
}

@Component({
  selector: 'app-recipe-editor',
  standalone: true,
  imports: [FormsModule, IconComponent],
  templateUrl: './recipe-editor.html',
  styleUrl: './recipe-editor.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class RecipeEditorComponent {
  readonly recipe = input<Recipe | null>(null);
  readonly importDraft = input<RecipeImportDraft | null>(null);
  readonly saved = output<Recipe>();
  readonly cancelled = output<void>();

  readonly units: Ingredient['unit'][] = ['g', 'ml', 'st', 'msk', 'tsk'];
  readonly categories: Ingredient['category'][] = ['Grönt', 'Skafferi', 'Mejeri', 'Kött & fisk'];
  readonly mainIngredients: Recipe['mainIngredient'][] = ['vegetables', 'fish', 'chicken', 'meat', 'legumes'];
  readonly mainIngredientLabels: Record<Recipe['mainIngredient'], string> = {
    vegetables: 'Grönsaker',
    fish: 'Fisk',
    chicken: 'Kyckling',
    meat: 'Kött',
    legumes: 'Baljväxter',
  };

  name = '';
  description = '';
  servings: number | null = 4;
  totalMinutes: number | null = 30;
  activeMinutes: number | null = 15;
  mainIngredient: Recipe['mainIngredient'] = 'vegetables';
  vegetarian = false;
  ingredients: IngredientDraft[] = [this.newIngredient()];
  steps: string[] = [''];
  stepReviewed: boolean[] = [true];
  submitted = false;

  constructor() {
    effect(() => {
      const recipe = this.recipe();
      const importDraft = this.importDraft();
      if (recipe) this.loadRecipe(recipe);
      else if (importDraft) this.loadImportDraft(importDraft);
    });
  }

  get isValid(): boolean {
    return !!this.name.trim()
      && !!this.description.trim()
      && Number.isInteger(this.servings) && (this.servings ?? 0) > 0
      && Number.isInteger(this.totalMinutes) && (this.totalMinutes ?? 0) > 0
      && Number.isInteger(this.activeMinutes) && (this.activeMinutes ?? 0) > 0
      && (this.activeMinutes ?? Infinity) <= (this.totalMinutes ?? 0)
      && this.ingredients.length > 0
      && this.ingredients.every((ingredient) => ingredient.name.trim() && Number.isFinite(ingredient.quantity) && (ingredient.quantity ?? 0) > 0 && !!ingredient.unit && !ingredient.needsUnitReview)
      && this.steps.some((step) => step.trim())
      && this.steps.every((step, index) => !step.trim() || this.stepReviewed[index]);
  }

  get allIngredientsConfirmedGlutenFree(): boolean {
    return this.ingredients.length > 0 && this.ingredients.every((ingredient) => ingredient.glutenStatus === 'free');
  }

  newIngredient(): IngredientDraft {
    return { id: '', originalName: '', name: '', quantity: null, unit: 'g', category: 'Skafferi', glutenStatus: 'unknown', originalGlutenStatus: 'unknown', originalComponent: 'rätt', otherAllergens: [], quantityHint: '', needsUnitReview: false };
  }

  addIngredient(): void {
    this.ingredients = [...this.ingredients, this.newIngredient()];
  }

  removeIngredient(index: number): void {
    if (this.ingredients.length <= 1) return;
    this.ingredients = this.ingredients.filter((_, currentIndex) => currentIndex !== index);
  }

  addStep(): void {
    this.steps = [...this.steps, ''];
    this.stepReviewed = [...this.stepReviewed, true];
  }

  removeStep(index: number): void {
    if (this.steps.length <= 1) return;
    this.steps = this.steps.filter((_, currentIndex) => currentIndex !== index);
    this.stepReviewed = this.stepReviewed.filter((_, currentIndex) => currentIndex !== index);
  }

  save(): void {
    this.submitted = true;
    if (!this.isValid) return;

    const existingRecipe = this.recipe();
    const glutenFree = this.allIngredientsConfirmedGlutenFree;
    const glutenMetadata = existingRecipe ? preservedVariantGlutenMetadata(existingRecipe, this.ingredients) : null;
    const keepExistingGlutenStrategy = !!glutenMetadata?.preserved;
    const dietaryNeeds: Recipe['dietaryNeeds'] = [];
    const tags: string[] = [];
    if (this.vegetarian) {
      dietaryNeeds.push('vegetarian');
      tags.push('Vegetariskt');
    }
    if (glutenFree) {
      dietaryNeeds.push('gluten-free');
      tags.push('Glutenfritt');
    } else if (keepExistingGlutenStrategy && existingRecipe) {
      if (existingRecipe.dietaryNeeds.includes('gluten-free')) dietaryNeeds.push('gluten-free');
      const glutenFreePerson: Person = { id: 'review', name: 'Review', portionFactor: 1, dietaryNeeds: ['gluten-free'] };
      if (supportsNeeds(existingRecipe, [glutenFreePerson])) tags.push('Kan göras glutenfritt');
    }

    const catalog = buildIngredientCatalog(RECIPES);
    const ingredients: Ingredient[] = this.ingredients.map((draft) => {
      const name = draft.name.trim();
      const catalogMatch = findIngredient(catalog, name);
      const unchanged = !!draft.id && draft.originalName === name;
      const slug = normalizeIngredientName(name).replace(/\s+/g, '-') || 'vara';
      const allergens: Ingredient['allergens'] = [
        ...(unchanged ? draft.otherAllergens : []),
        ...(draft.glutenStatus === 'contains' ? ['gluten' as const] : []),
      ];
      return {
        id: unchanged ? draft.id : catalogMatch?.id ?? `custom-${slug}`,
        name,
        quantity: draft.quantity!,
        unit: draft.unit!,
        category: catalogMatch?.category ?? draft.category,
        component: unchanged ? draft.originalComponent : 'rätt',
        allergens,
        ...(unchanged && draft.glutenFreeAlternative ? { glutenFreeAlternative: draft.glutenFreeAlternative } : {}),
      };
    });

    const existing = existingRecipe;
    const recipe: Recipe = {
      id: existing?.id ?? `custom:${crypto.randomUUID()}`,
      name: this.name.trim(),
      description: this.description.trim(),
      servings: this.servings!,
      totalMinutes: this.totalMinutes!,
      activeMinutes: this.activeMinutes!,
      mainIngredient: this.mainIngredient,
      tags,
      dietaryNeeds,
      glutenStrategy: glutenFree ? 'naturally-free' : keepExistingGlutenStrategy ? glutenMetadata!.glutenStrategy : 'unsupported',
      ...(keepExistingGlutenStrategy && glutenMetadata?.separateGlutenComponents
        ? { separateGlutenComponents: [...glutenMetadata.separateGlutenComponents] }
        : {}),
      ingredients,
      steps: this.steps.filter((step) => step.trim()).map((text) => ({ text: text.trim() })),
      image: existing?.image ?? 'images/custom-recipe.svg',
      imageAlt: existing?.imageAlt ?? 'Neutral illustration för ett eget recept',
      imageKind: existing?.imageKind ?? 'illustration',
      color: existing?.color ?? '#e4f6ed',
    };

    this.saved.emit(recipe);
  }

  private loadRecipe(recipe: Recipe): void {
    this.name = recipe.name;
    this.description = recipe.description;
    this.servings = recipe.servings;
    this.totalMinutes = recipe.totalMinutes;
    this.activeMinutes = recipe.activeMinutes;
    this.mainIngredient = recipe.mainIngredient;
    this.vegetarian = recipe.dietaryNeeds.includes('vegetarian');
    this.ingredients = recipe.ingredients.map((ingredient) => ({
      id: ingredient.id,
      originalName: ingredient.name,
      name: ingredient.name,
      quantity: ingredient.quantity,
      unit: ingredient.unit,
      category: ingredient.category,
      glutenStatus: recipe.glutenStrategy === 'naturally-free'
        ? 'free'
        : ingredient.allergens.includes('gluten') ? 'contains' : 'unknown',
      originalGlutenStatus: recipe.glutenStrategy === 'naturally-free'
        ? 'free'
        : ingredient.allergens.includes('gluten') ? 'contains' : 'unknown',
      originalComponent: ingredient.component,
      otherAllergens: ingredient.allergens.filter((allergen) => allergen !== 'gluten'),
      glutenFreeAlternative: ingredient.glutenFreeAlternative,
      quantityHint: '',
      needsUnitReview: false,
    }));
    this.steps = recipe.steps.length ? recipe.steps.map((step) => step.text) : [''];
    this.stepReviewed = this.steps.map(() => true);
    this.submitted = false;
  }

  private loadImportDraft(draft: RecipeImportDraft): void {
    this.name = draft.name;
    this.description = draft.description;
    this.servings = draft.servings;
    this.totalMinutes = draft.totalMinutes;
    this.activeMinutes = draft.activeMinutes;
    this.mainIngredient = 'vegetables';
    this.vegetarian = false;
    const catalog = buildIngredientCatalog(RECIPES);
    this.ingredients = draft.ingredients.length ? draft.ingredients.map((ingredient) => ({
      id: '',
      originalName: '',
      name: ingredient.name,
      quantity: ingredient.quantity,
      unit: ingredient.unit,
      category: findIngredient(catalog, ingredient.name)?.category ?? 'Skafferi',
      glutenStatus: 'unknown',
      originalGlutenStatus: 'unknown',
      originalComponent: 'rätt',
      otherAllergens: [],
      quantityHint: ingredient.quantityHint,
      needsUnitReview: ingredient.needsUnitReview,
    })) : [this.newIngredient()];
    this.steps = draft.steps.length ? draft.steps.map((step) => step.text) : [''];
    this.stepReviewed = draft.steps.length ? draft.steps.map((step) => !step.needsReview) : [true];
    this.submitted = false;
  }
}
