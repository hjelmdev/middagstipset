import type { Ingredient, Recipe } from './models.ts';

export type IngredientCategory = Ingredient['category'];

export interface IngredientSuggestion {
  id: string;
  name: string;
  category: IngredientCategory;
  aliases: string[];
}

const CATEGORY_ORDER: IngredientCategory[] = ['Grönt', 'Kött & fisk', 'Mejeri', 'Skafferi'];

/** Normalize Swedish names for exact matching without losing the displayed spelling. */
export function normalizeIngredientName(name: string): string {
  return name
    .trim()
    .toLocaleLowerCase('sv-SE')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

/** Build a compact, deduplicated catalogue from the recipe ingredients. */
export function buildIngredientCatalog(recipes: Recipe[]): IngredientSuggestion[] {
  const entriesById = new Map<string, IngredientSuggestion>();
  const entriesByName = new Map<string, IngredientSuggestion>();

  for (const recipe of recipes) {
    for (const ingredient of recipe.ingredients) {
      const key = normalizeIngredientName(ingredient.name);
      const existing = entriesById.get(ingredient.id) ?? entriesByName.get(key);
      if (existing) {
        addAlias(existing, ingredient.name);
        for (const alias of tomatoAliases(ingredient)) addAlias(existing, alias);
        entriesById.set(ingredient.id, existing);
        entriesByName.set(key, existing);
      } else {
        const entry: IngredientSuggestion = {
          id: ingredient.id,
          name: ingredient.name,
          category: ingredient.category,
          aliases: tomatoAliases(ingredient),
        };
        entriesById.set(ingredient.id, entry);
        entriesByName.set(key, entry);
      }
    }
  }

  return [...new Set(entriesById.values())].sort((a, b) =>
    CATEGORY_ORDER.indexOf(a.category) - CATEGORY_ORDER.indexOf(b.category) || a.name.localeCompare(b.name, 'sv-SE'));
}

/** Search names and aliases, preferring exact and then prefix matches. */
export function searchIngredients(
  catalog: IngredientSuggestion[],
  query: string,
  limit = 8,
): IngredientSuggestion[] {
  const normalizedQuery = normalizeIngredientName(query);
  if (!normalizedQuery || limit <= 0) return [];

  return catalog
    .map((ingredient) => {
      const names = [ingredient.name, ...ingredient.aliases].map(normalizeIngredientName);
      const exact = names.includes(normalizedQuery);
      const prefix = names.some((name) => name.startsWith(normalizedQuery));
      const contains = names.some((name) => name.includes(normalizedQuery));
      return { ingredient, score: exact ? 0 : prefix ? 1 : contains ? 2 : Number.POSITIVE_INFINITY };
    })
    .filter((result) => Number.isFinite(result.score))
    .sort((a, b) => a.score - b.score || a.ingredient.name.localeCompare(b.ingredient.name, 'sv-SE'))
    .slice(0, Math.trunc(limit))
    .map((result) => result.ingredient);
}

/** Find an exact normalized name or alias. Partial matches are intentionally excluded. */
export function findIngredient(
  catalog: IngredientSuggestion[],
  name: string,
): IngredientSuggestion | undefined {
  const normalizedName = normalizeIngredientName(name);
  if (!normalizedName) return undefined;
  return catalog.find((ingredient) =>
    [ingredient.name, ...ingredient.aliases].some((candidate) => normalizeIngredientName(candidate) === normalizedName));
}

function tomatoAliases(ingredient: Ingredient): string[] {
  const normalizedName = normalizeIngredientName(ingredient.name);
  if (ingredient.category === 'Grönt' && /^(farska )?tomater?$/.test(normalizedName)) {
    return ['tomat', 'tomater', 'färsk tomat', 'färska tomater'];
  }
  return [];
}

function addAlias(entry: IngredientSuggestion, alias: string): void {
  const key = normalizeIngredientName(alias);
  if (!key || key === normalizeIngredientName(entry.name) || entry.aliases.some((existing) => normalizeIngredientName(existing) === key)) return;
  entry.aliases.push(alias);
}
