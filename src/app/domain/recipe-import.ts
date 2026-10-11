import type { Ingredient, Recipe } from './models.ts';

export interface ImportedIngredientDraft {
  name: string;
  quantity: number | null;
  unit: Ingredient['unit'] | null;
  quantityHint: string;
  needsUnitReview: boolean;
}

export interface ImportedStepDraft {
  text: string;
  needsReview: boolean;
}

/** An untrusted, deliberately incomplete recipe shape for editor review. */
export interface RecipeImportDraft {
  name: string;
  description: string;
  servings: number | null;
  totalMinutes: number | null;
  activeMinutes: number | null;
  ingredients: ImportedIngredientDraft[];
  steps: ImportedStepDraft[];
  warnings: string[];
}

export function parseRecipeImport(source: string): RecipeImportDraft {
  const text = source.trim();
  if (!text) throw new Error('Klistra in recepttext, recept-JSON, JSON-LD eller HTML.');
  if (/^https?:\/\//i.test(text)) throw new Error('Länkar kan inte hämtas ännu. Klistra in receptets text här.');

  const jsonLd = extractJsonLd(text);
  if (jsonLd.length) {
    const recipe = findRecipe(jsonLd);
    if (!recipe) throw new Error('Hittade ingen Recipe-post i sidans JSON-LD.');
    return draftFromStructured(recipe);
  }

  const jsonCandidate = text.replace(/^\s*<pre[^>]*>|<\/pre>\s*$/gi, '').trim();
  if (jsonCandidate.startsWith('{') || jsonCandidate.startsWith('[')) {
    try {
      const parsed: unknown = JSON.parse(jsonCandidate);
      const recipe = findRecipe(parsed);
      if (!recipe) throw new Error('JSON-innehållet innehåller inget recept.');
      return draftFromStructured(recipe);
    } catch (error) {
      if (error instanceof SyntaxError) throw new Error('JSON gick inte att läsa. Kontrollera att hela receptet är inklistrat.');
      throw error;
    }
  }

  const plain = /<\/?[a-z][^>]*>/i.test(text) ? htmlToText(text) : text;
  return draftFromPlainText(plain);
}

function extractJsonLd(source: string): unknown[] {
  const results: unknown[] = [];
  const scripts = source.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi);
  for (const match of scripts) {
    const typeMatch = match[1].match(/\btype\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i);
    const type = typeMatch?.[1] ?? typeMatch?.[2] ?? typeMatch?.[3] ?? '';
    if (type.split(';', 1)[0].trim().toLocaleLowerCase('en-US') !== 'application/ld+json') continue;
    try { results.push(JSON.parse(match[2].replace(/<!--|-->/g, '').trim())); } catch { /* Ignore malformed metadata and inspect other safe content. */ }
  }
  return results;
}

function findRecipe(value: unknown): Record<string, unknown> | undefined {
  if (Array.isArray(value)) {
    const found = value.map(findRecipe).find(Boolean);
    return found;
  }
  if (!isRecord(value)) return undefined;
  const type = value['@type'];
  const isRecipeType = [type, ...(Array.isArray(type) ? type : [])]
    .some(entry => typeof entry === 'string' && (entry === 'Recipe' || /(?:schema\.org\/|^)Recipe$/i.test(entry)));
  const isRecipeJson = typeof value['name'] === 'string'
    && (Array.isArray(value['ingredients']) || Array.isArray(value['recipeIngredient']))
    && (Array.isArray(value['steps']) || Array.isArray(value['recipeInstructions']));
  if (isRecipeType || (isRecipeJson && typeof value['name'] === 'string')) return value;
  for (const key of ['@graph', 'itemListElement', 'mainEntity', 'mainEntityOfPage', 'item', 'recipe']) {
    const found = findRecipe(value[key]);
    if (found) return found;
  }
  for (const [key, nested] of Object.entries(value)) {
    if (['@graph', 'itemListElement', 'mainEntity', 'mainEntityOfPage', 'item', 'recipe'].includes(key)) continue;
    const found = findRecipe(nested);
    if (found) return found;
  }
  return undefined;
}

function draftFromStructured(recipe: Record<string, unknown>): RecipeImportDraft {
  const warnings: string[] = [];
  const name = plainValue(recipe['name']);
  if (!name) throw new Error('Receptet saknar namn.');
  const rawIngredients = Array.isArray(recipe['recipeIngredient']) ? recipe['recipeIngredient'] : recipe['ingredients'];
  const ingredients = Array.isArray(rawIngredients)
    ? rawIngredients.map(parseStructuredIngredient).filter((item): item is ImportedIngredientDraft => item !== null)
    : [];
  const steps = readInstructions(recipe['recipeInstructions'] ?? recipe['steps']);
  const servings = parseServings(recipe['recipeYield'] ?? recipe['servings']);
  const prep = parseDuration(recipe['prepTime'] ?? recipe['activeMinutes']);
  const cook = parseDuration(recipe['cookTime']);
  const total = parseDuration(recipe['totalTime'] ?? recipe['totalMinutes']) ?? (prep !== null && cook !== null ? prep + cook : prep ?? cook);
  if (!ingredients.length) warnings.push('Ingrediensrader hittades inte. Lägg till dem manuellt.');
  if (ingredients.some(ingredient => ingredient.needsUnitReview)) warnings.push('En eller flera ingredienser saknar tydlig mängd eller enhet. Kontrollera dem i formuläret.');
  if (!steps.length) warnings.push('Tillagningssteg hittades inte. Lägg till minst ett steg.');
  if (!plainValue(recipe['description'])) warnings.push('Beskrivning saknas och behöver skrivas innan receptet kan sparas.');
  if (servings === null) warnings.push('Portionsantal saknas och behöver anges.');
  if (total === null) warnings.push('Total tillagningstid saknas och behöver anges.');
  if (prep === null) warnings.push('Aktiv tid saknas och behöver anges.');
  warnings.push('Huvudingrediens importerades inte. Kontrollera och välj rätt i formuläret.');
  return {
    name,
    description: plainValue(recipe['description']),
    servings,
    totalMinutes: total,
    activeMinutes: prep,
    ingredients,
    steps: steps.map(text => ({ text, needsReview: true })),
    warnings,
  };
}

function parseStructuredIngredient(value: unknown): ImportedIngredientDraft | null {
  if (typeof value === 'string') return parseIngredientLine(value);
  if (!isRecord(value)) return null;
  const name = plainValue(value['name'] ?? value['item'] ?? value['description']);
  if (!name) return null;
  const quantity = finiteNumber(value['quantity'] ?? value['amount']);
  const unitValue = plainValue(value['unit'] ?? value['unitText']);
  const conversion = unitValue ? normalizeUnit(quantity, unitValue) : null;
  return {
    name,
    quantity: conversion?.quantity ?? null,
    unit: conversion?.unit ?? null,
    quantityHint: quantity === null ? (unitValue ? unitValue : 'Mängd saknas') : unitValue ? `${quantity} ${unitValue}` : String(quantity),
    needsUnitReview: !conversion,
  };
}

function parseIngredientLine(line: string): ImportedIngredientDraft | null {
  const cleaned = plainValue(line).replace(/^\s*(?:[-*•]\s+|\d+[.)]\s+)/, '').trim();
  if (!cleaned) return null;
  const amountPattern = '(\\d+\\s+\\d+\\/\\d+|\\d+\\/\\d+|\\d+(?:[.,]\\d+)?|[¼½¾⅓⅔⅛⅜⅝⅞])';
  const amountMatch = cleaned.match(new RegExp(`^${amountPattern}\\s*(.*)$`, 'i'));
  if (!amountMatch) {
    const name = cleaned.replace(/\s*,?\s*(efter smak|efter behag|valfritt)$/i, '').trim();
    return { name, quantity: null, unit: null, quantityHint: 'Mängd saknas', needsUnitReview: true };
  }
  const [, amountText, tail] = amountMatch;
  const amount = parseAmount(amountText);
  const trimmedTail = tail.trim();
  const tokens = trimmedTail.match(/^([a-zåäö]+)\s+(.+)$/i);
  const knownUnit = tokens ? normalizeUnit(amount, tokens[1]) : null;
  if (tokens && knownUnit) {
    return { name: tokens[2].trim(), quantity: knownUnit.quantity, unit: knownUnit.unit, quantityHint: '', needsUnitReview: false };
  }
  if (tokens && isUnclearUnit(tokens[1])) {
    return { name: tokens[2].trim(), quantity: null, unit: null, quantityHint: `${amountText} ${tokens[1]}`, needsUnitReview: true };
  }
  if (isCountableItem(trimmedTail)) {
    return { name: trimmedTail, quantity: amount, unit: 'st', quantityHint: '', needsUnitReview: false };
  }
  if (!trimmedTail) return { name: cleaned, quantity: null, unit: null, quantityHint: amountText, needsUnitReview: true };
  const tasteName = trimmedTail.replace(/\s*,?\s*(efter smak|efter behag|valfritt)$/i, '').trim();
  const count = tokens && !isUnclearUnit(tokens[1]);
  const name = count ? trimmedTail : tasteName;
  const hint = count ? amountText : amountText;
  return { name, quantity: null, unit: null, quantityHint: hint, needsUnitReview: true };
}

function isCountableItem(value: string): boolean {
  return /^(?:ägg|äggula|äggulor|äggvita|äggvitor|potatis|potatisar|tomat|tomater|lök|lökar|avokado|avokador|morot|morötter|citron|citroner|lime|limefrukter|äpple|äpplen|gurka|gurkor|paprika|paprikor|banan|bananer|brödskiva|brödskivor)$/i.test(value.trim());
}

function isUnclearUnit(value: string): boolean {
  return /^(?:burk|burkar|paket|förpackning|förpackningar|påse|påsar|nypa|nypor|näve|nävar|skiva|skivor|klyfta|klyftor|knippe|knippen|portion|portioner|burk|burkar)$/i.test(value);
}

function normalizeUnit(quantity: number | null, sourceUnit: string): { quantity: number; unit: Ingredient['unit'] } | null {
  if (quantity === null || !Number.isFinite(quantity) || quantity <= 0) return null;
  const unit = sourceUnit.trim().toLocaleLowerCase('sv-SE').replace(/[.\s]/g, '');
  if (['g', 'gram', 'gramm'].includes(unit)) return { quantity, unit: 'g' };
  if (['kg', 'kilogram', 'kilogramm'].includes(unit)) return { quantity: quantity * 1000, unit: 'g' };
  if (['ml', 'milliliter', 'millilitre'].includes(unit)) return { quantity, unit: 'ml' };
  if (['cl', 'centiliter', 'centilitre'].includes(unit)) return { quantity: quantity * 10, unit: 'ml' };
  if (['dl', 'deciliter', 'decilitre'].includes(unit)) return { quantity: quantity * 100, unit: 'ml' };
  if (['l', 'liter', 'litre'].includes(unit)) return { quantity: quantity * 1000, unit: 'ml' };
  if (['st', 'styck', 'stycken', 'pcs', 'piece', 'pieces'].includes(unit)) return { quantity, unit: 'st' };
  if (['msk', 'matsked', 'matskedar', 'tbsp'].includes(unit)) return { quantity, unit: 'msk' };
  if (['tsk', 'tesked', 'teskedar', 'tsp'].includes(unit)) return { quantity, unit: 'tsk' };
  return null;
}

function parseAmount(value: string): number {
  const normalized = value.replace(',', '.');
  if (/\d+\s+\d+\/\d+/.test(normalized)) {
    const [whole, fraction] = normalized.split(/\s+/);
    return Number(whole) + parseFraction(fraction);
  }
  if (/\d+\/\d+/.test(normalized)) return parseFraction(normalized);
  const fractions: Record<string, number> = { '¼': 0.25, '½': 0.5, '¾': 0.75, '⅓': 1 / 3, '⅔': 2 / 3, '⅛': 0.125, '⅜': 0.375, '⅝': 0.625, '⅞': 0.875 };
  return fractions[normalized] ?? Number(normalized);
}

function parseFraction(value: string): number {
  const [numerator, denominator] = value.split('/').map(Number);
  return denominator ? numerator / denominator : NaN;
}

function readInstructions(value: unknown): string[] {
  if (typeof value === 'string') return splitInstructions(stripMarkup(value));
  if (Array.isArray(value)) return value.flatMap(readInstructions);
  if (!isRecord(value)) return [];
  const text = plainValue(value['text']);
  if (text) return splitInstructions(text);
  const nested = readInstructions(value['itemListElement']);
  return nested.length ? nested : splitInstructions(plainValue(value['name'] ?? value['description']));
}

function draftFromPlainText(text: string): RecipeImportDraft {
  const lines = text.split(/\r?\n/).map(line => line.trim()).filter(Boolean);
  let section: 'intro' | 'ingredients' | 'steps' = 'intro';
  let name = '';
  const description: string[] = [];
  const rawIngredients: string[] = [];
  const rawSteps: string[] = [];
  let servings: number | null = null;
  let totalMinutes: number | null = null;
  let activeMinutes: number | null = null;
  for (const raw of lines) {
    const line = raw.replace(/^[-*•]\s*/, '').trim();
    const header = normalizeHeading(line);
    if (/^(ingredienser|ingredients|du behöver)$/.test(header)) { section = 'ingredients'; continue; }
    if (/^(tillagning|gör så här|instruktioner|method|directions|recipe instructions)$/.test(header)) { section = 'steps'; continue; }
    if (/^(beskrivning|description)$/.test(header)) { section = 'intro'; continue; }
    const title = line.match(/^(?:namn|receptnamn|title)\s*:\s*(.+)$/i);
    const descriptionMatch = line.match(/^(?:beskrivning|description)\s*:\s*(.*)$/i);
    const servingsMatch = line.match(/^(?:portioner|portion|servings|yield)\s*:\s*(.+)$/i);
    const totalMatch = line.match(/^(?:total tid|tid|total time|time)\s*:\s*(.+)$/i);
    const activeMatch = line.match(/^(?:aktiv tid|prep time|förberedelsetid)\s*:\s*(.+)$/i);
    if (title) { name = plainValue(title[1]); continue; }
    if (descriptionMatch) {
      section = 'intro';
      if (descriptionMatch[1].trim()) description.push(plainValue(descriptionMatch[1]));
      continue;
    }
    if (servingsMatch) { servings = parseServings(servingsMatch[1]); continue; }
    if (totalMatch) { totalMinutes = parseDuration(totalMatch[1]); continue; }
    if (activeMatch) { activeMinutes = parseDuration(activeMatch[1]); continue; }
    if (!name && section === 'intro' && !line.endsWith(':')) { name = line; continue; }
    if (section === 'ingredients') rawIngredients.push(line);
    else if (section === 'steps') rawSteps.push(line.replace(/^\d+[.)]\s*/, ''));
    else description.push(line);
  }
  if (!name) throw new Error('Hittade inget receptnamn. Använd rubrikerna Namn, Ingredienser och Tillagning.');
  const ingredients = rawIngredients.map(parseIngredientLine).filter((item): item is ImportedIngredientDraft => !!item);
  const steps = rawSteps.map(text => ({ text, needsReview: true }));
  const warnings: string[] = [];
  if (!ingredients.length) warnings.push('Ingrediensrader hittades inte. Lägg till dem manuellt.');
  if (!steps.length) warnings.push('Tillagningssteg hittades inte. Lägg till minst ett steg.');
  if (servings === null) warnings.push('Portionsantal saknas och behöver anges.');
  if (totalMinutes === null) warnings.push('Total tillagningstid saknas och behöver anges.');
  if (activeMinutes === null) warnings.push('Aktiv tid saknas och behöver anges.');
  warnings.push('Huvudingrediens importerades inte. Kontrollera och välj rätt i formuläret.');
  return { name, description: description.join(' '), servings, totalMinutes, activeMinutes, ingredients, steps, warnings };
}

function parseServings(value: unknown): number | null {
  if (Array.isArray(value)) value = value[0];
  const match = String(value ?? '').match(/\d+(?:[.,]\d+)?/);
  const number = match ? Number(match[0].replace(',', '.')) : NaN;
  return Number.isInteger(number) && number > 0 ? number : null;
}

function parseDuration(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) && value > 0 ? Math.round(value) : null;
  if (typeof value !== 'string') return null;
  const iso = value.match(/^PT(?:(\d+(?:\.\d+)?)H)?(?:(\d+(?:\.\d+)?)M)?(?:(\d+(?:\.\d+)?)S)?$/i);
  if (iso) {
    const minutes = Number(iso[1] ?? 0) * 60 + Number(iso[2] ?? 0) + Number(iso[3] ?? 0) / 60;
    return minutes > 0 ? Math.round(minutes) : null;
  }
  const minutes = value.match(/\d+(?:[.,]\d+)?/);
  return minutes ? Math.max(1, Math.round(Number(minutes[0].replace(',', '.')))) : null;
}

function htmlToText(html: string): string {
  const withoutScripts = html.replace(/<script\b(?![^>]*\btype\s*=\s*(?:"application\/ld\+json"|'application\/ld\+json'))[^>]*>[\s\S]*?<\/script\s*>/gi, ' ')
    .replace(/<script\b[^>]*>[\s\S]*?<\/script\s*>/gi, ' ')
    .replace(/<(style|svg|noscript|template)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, ' ');
  return stripMarkup(withoutScripts).replace(/[ \t]+/g, ' ').replace(/\n\s*\n+/g, '\n').trim();
}

function stripMarkup(value: string): string {
  return decodeEntities(value.replace(/<br\s*\/?>|<\/(?:p|div|li|h[1-6]|section|article|tr)>/gi, '\n').replace(/<[^>]*>/g, ' '))
    .replace(/[\t\r ]+/g, ' ').replace(/\n +/g, '\n').trim();
}

function decodeEntities(value: string): string {
  return value.replace(/&(#x[\da-f]+|#\d+|amp|lt|gt|quot|apos|nbsp);/gi, (match, entity: string) => {
    const named: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
    const key = entity.toLowerCase();
    if (key.startsWith('#x') || key.startsWith('#')) {
      const point = Number.parseInt(key.startsWith('#x') ? key.slice(2) : key.slice(1), key.startsWith('#x') ? 16 : 10);
      if (point > 0 && point <= 0x10ffff && !(point >= 0xd800 && point <= 0xdfff)) return String.fromCodePoint(point);
      return match;
    }
    return named[key] ?? match;
  });
}

function splitInstructions(value: string): string[] {
  return value.split(/\n+|(?<=[.!?])\s+(?=[A-ZÅÄÖ0-9])/).map(part => part.trim().replace(/^\d+[.)]\s*/, '')).filter(Boolean);
}

function normalizeHeading(value: string): string {
  return value.replace(/[:：]$/, '').trim().toLocaleLowerCase('sv-SE');
}

function plainValue(value: unknown): string {
  if (typeof value === 'string') return stripMarkup(value).trim();
  if (typeof value === 'number') return String(value);
  return '';
}

function finiteNumber(value: unknown): number | null {
  const number = typeof value === 'number' ? value : typeof value === 'string' ? Number(value.replace(',', '.')) : NaN;
  return Number.isFinite(number) && number > 0 ? number : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
