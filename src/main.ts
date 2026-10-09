import { bootstrapApplication } from '@angular/platform-browser';
import { provideBrowserGlobalErrorListeners } from '@angular/core';
import { provideRouter, withHashLocation, withInMemoryScrolling } from '@angular/router';
import { App } from './app/app';
import { routes } from './app/app.routes';
bootstrapApplication(App, { providers: [provideBrowserGlobalErrorListeners(), provideRouter(routes, withHashLocation(), withInMemoryScrolling({ scrollPositionRestoration: 'top' }))] }).catch(console.error);
