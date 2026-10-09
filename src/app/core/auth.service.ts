import { Injectable, signal } from '@angular/core';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { AuthUser } from '../domain/models';
import { loadRuntimeConfig } from './runtime-config';

export interface AuthGateway {
  readonly user: ReturnType<typeof signal<AuthUser | null>>;
  signInWithGoogle(): Promise<void>;
  signOut(): Promise<void>;
}
@Injectable({ providedIn: 'root' })
export class AuthService implements AuthGateway {
  readonly user = signal<AuthUser | null>(null);
  readonly ready = signal(false);
  readonly configured = signal(false);
  readonly error = signal('');
  client: SupabaseClient | null = null;
  async initialize(): Promise<void> {
    try {
      const config = await loadRuntimeConfig();
      if (!config) return;
      this.client = createClient(config.supabaseUrl, config.supabasePublishableKey, {
        auth: { flowType: 'pkce', detectSessionInUrl: true, persistSession: true, autoRefreshToken: true },
      });
      this.configured.set(true);
      this.client.auth.onAuthStateChange((_event, session) => {
        const user = session?.user;
        this.user.set(user ? { id: user.id, displayName: String(user.user_metadata['full_name'] ?? 'Mitt konto'), email: user.email } : null);
      });
      const { data, error } = await this.client.auth.getSession();
      if (error) throw error;
      const user = data.session?.user;
      this.user.set(user ? { id: user.id, displayName: String(user.user_metadata['full_name'] ?? 'Mitt konto'), email: user.email } : null);
    } catch { this.error.set('Kunde inte ansluta till kontot. Kontrollera inställningarna och försök igen.'); }
    finally { this.ready.set(true); }
  }
  async signInWithGoogle(): Promise<void> {
    this.error.set('');
    if (!this.client) { this.error.set('Google-inloggning aktiveras när Supabase är anslutet. Du kan använda demoläget så länge.'); return; }
    const { error } = await this.client.auth.signInWithOAuth({ provider: 'google', options: { redirectTo: `${location.origin}${location.pathname}` } });
    if (error) this.error.set('Google-inloggningen kunde inte starta. Försök igen.');
  }
  async signOut(): Promise<void> {
    const { error } = await this.client!.auth.signOut();
    if (error) throw error;
    this.user.set(null);
  }
}
