import type { Routes } from '@angular/router';

const loadPlannerPage = () => import('./features/planner-page').then(module => module.PlannerPage);

export const routes: Routes = [
  { path: 'idag', loadComponent: loadPlannerPage, data: { screen: 'today' } },
  { path: 'planera', loadComponent: loadPlannerPage, data: { screen: 'plan' } },
  { path: 'recept', loadComponent: loadPlannerPage, data: { screen: 'recipes' } },
  { path: 'handla', loadComponent: loadPlannerPage, data: { screen: 'shopping' } },
  { path: 'hushall', loadComponent: loadPlannerPage, data: { screen: 'household' } },
  { path: 'historik', loadComponent: () => import('./features/history-page').then(module => module.HistoryPage) },
  { path: 'hemma', loadComponent: () => import('./features/pantry-page').then(module => module.PantryPage) },
  { path: 'lunch', loadComponent: () => import('./features/lunch-page').then(module => module.LunchPage) },
  { path: 'import', loadComponent: () => import('./features/recipe-import-page').then(module => module.RecipeImportPage) },
  { path: 'data', loadComponent: () => import('./features/data-backup-page').then(module => module.DataBackupPage) },
  { path: '', pathMatch: 'full', redirectTo: 'idag' },
  { path: '**', redirectTo: 'idag' },
];
