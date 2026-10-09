export interface RuntimeConfig { supabaseUrl: string; supabasePublishableKey: string }
// Public browser configuration only. Never put a service_role key here.
export async function loadRuntimeConfig(): Promise<RuntimeConfig | null> {
  const response = await fetch('config.json', { cache: 'no-store' });
  if (!response.ok) throw new Error('Kunde inte läsa appens inställningar. Ladda om sidan.');
  const config = await response.json() as RuntimeConfig;
  if (!config.supabaseUrl && !config.supabasePublishableKey) return null;
  if (!config.supabaseUrl || !config.supabasePublishableKey) throw new Error('Supabase-inställningarna är ofullständiga.');
  const url = new URL(config.supabaseUrl);
  if (!['https:', 'http:'].includes(url.protocol)) throw new Error('Ogiltig Supabase-adress.');
  return config;
}
