import { Injectable, computed, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { createClient, type SupabaseClient, type User } from '@supabase/supabase-js';
import type { AuthUser } from '../domain/models';
import { loadRuntimeConfig } from './runtime-config';

export interface AuthGateway {
  readonly user: ReturnType<typeof signal<AuthUser | null>>;
  signInWithGoogle(): Promise<void>;
  signOut(): Promise<void>;
}
@Injectable({ providedIn: 'root' })
export class AuthService implements AuthGateway {
  private static readonly recipeUrlImportOwner = 'hjelm.adam@gmail.com';
  private readonly router = inject(Router);
  private readonly returnPathKey = 'middagstipset.auth.return-path';
  private signInTimeout: number | undefined;
  readonly user = signal<AuthUser | null>(null);
  readonly canImportRecipeUrl = computed(() => this.user()?.email?.trim().toLowerCase() === AuthService.recipeUrlImportOwner);
  readonly signInPending = signal(false);
  readonly ready = signal(false);
  readonly configured = signal(false);
  readonly error = signal('');
  client: SupabaseClient | null = null;
  async initialize(): Promise<void> {
    const callbackUrl = new URL(location.href);
    const oauthCode = callbackUrl.searchParams.get('code');
    const oauthFlowId = callbackUrl.searchParams.get('flow_id');
    const oauthError = callbackUrl.searchParams.get('error_description') ?? callbackUrl.searchParams.get('error');
    try {
      const config = await loadRuntimeConfig();
      if (!config) {
        if (oauthCode) this.reportOAuthCallbackFailure();
        return;
      }
      this.client = createClient(config.supabaseUrl, config.supabasePublishableKey, {
        // Angular's hash router can rewrite the query string during startup. Capture and exchange
        // the PKCE callback ourselves so the router cannot erase Google's `?code=` first.
        auth: { flowType: 'pkce', detectSessionInUrl: false, persistSession: true, autoRefreshToken: true },
      });
      this.configured.set(true);
      this.client.auth.onAuthStateChange((event, session) => {
        const user = session?.user ?? null;
        this.user.set(toAuthUser(user));
        if (event === 'SIGNED_IN' && user) this.clearSignInPending();
        // Route restoration belongs to the completed sign-in only. Token refreshes and
        // other auth events must never navigate away from an in-progress screen.
        if (event === 'SIGNED_IN' && user) this.restoreReturnPath();
      });
      if (oauthError) {
        this.error.set('Google kunde inte slutföra inloggningen. Försök igen.');
        this.clearOAuthCallbackParameters();
      } else if (oauthCode) {
        const { data, error } = await this.client.auth.exchangeCodeForSession(oauthCode, oauthFlowId ? { flowId: oauthFlowId } : undefined);
        if (error || !data.session) {
          this.reportOAuthCallbackFailure();
          return;
        }
        this.clearOAuthCallbackParameters();
      }
      const { data, error } = await this.client.auth.getSession();
      if (error) throw error;
      const user = data.session?.user ?? null;
      this.user.set(toAuthUser(user));
      if (user) this.restoreReturnPath();
    } catch {
      if (oauthCode) this.reportOAuthCallbackFailure();
      else this.error.set('Kunde inte ansluta till kontot. Kontrollera inställningarna och försök igen.');
    }
    finally { this.ready.set(true); }
  }
  private reportOAuthCallbackFailure(): void {
    this.error.set('Google skickade dig tillbaka, men inloggningen kunde inte slutföras. Starta om inloggningen i samma webbläsare som Middagstipset och försök igen.');
    this.clearOAuthCallbackParameters();
  }
  private clearOAuthCallbackParameters(): void {
    const url = new URL(location.href);
    for (const parameter of ['code', 'flow_id', 'error', 'error_description', 'error_code']) url.searchParams.delete(parameter);
    history.replaceState(history.state, '', url.toString());
  }
  async refreshUser(): Promise<AuthUser | null> {
    if (!this.client) return null;
    try {
      const { data, error } = await this.client.auth.getSession();
      if (error) throw error;
      const user = toAuthUser(data.session?.user ?? null);
      this.user.set(user);
      return user;
    } catch {
      this.error.set('Kunde inte kontrollera inloggningen. Försök igen eller logga in via Profil.');
      return null;
    }
  }
  async signInWithGoogle(): Promise<void> {
    if (this.signInPending()) return;
    this.error.set('');
    if (!this.client) { this.error.set('Google-inloggning aktiveras när Supabase är anslutet. Du kan använda demoläget så länge.'); return; }
    this.signInPending.set(true);
    try { sessionStorage.setItem(this.returnPathKey, this.router.url || '/idag'); } catch { /* Route restoration is optional if browser storage is blocked. */ }
    try {
      const { error } = await this.client.auth.signInWithOAuth({ provider: 'google', options: { redirectTo: `${location.origin}${location.pathname}` } });
      if (error) throw error;
      // If a mobile browser blocks or interrupts the redirect, let the user retry without reloading.
      this.signInTimeout = window.setTimeout(() => {
        this.signInPending.set(false);
        this.error.set('Google-inloggningen tog för lång tid. Försök igen och slutför steget i Google-fönstret.');
      }, 45_000);
    } catch {
      try { sessionStorage.removeItem(this.returnPathKey); } catch { /* Ignore unavailable browser storage. */ }
      this.signInPending.set(false);
      this.error.set('Google-inloggningen kunde inte starta. Försök igen.');
    }
  }
  private clearSignInPending(): void {
    this.signInPending.set(false);
    if (this.signInTimeout !== undefined) window.clearTimeout(this.signInTimeout);
    this.signInTimeout = undefined;
  }
  private restoreReturnPath(): void {
    let path: string | null = null;
    try { path = sessionStorage.getItem(this.returnPathKey); sessionStorage.removeItem(this.returnPathKey); } catch { /* Ignore unavailable browser storage. */ }
    if (path?.startsWith('/') && !path.startsWith('//')) queueMicrotask(() => void this.router.navigateByUrl(path!));
  }
  async signOut(): Promise<void> {
    const { error } = await this.client!.auth.signOut();
    if (error) throw error;
    this.user.set(null);
  }
}

function toAuthUser(user: User | null): AuthUser | null {
  return user ? { id: user.id, displayName: String(user.user_metadata['full_name'] ?? 'Mitt konto'), email: user.email } : null;
}
