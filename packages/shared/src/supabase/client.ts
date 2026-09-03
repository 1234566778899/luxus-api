import { createBrowserClient } from '@supabase/ssr';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '../types/database.types.js';

export type LuxusClient = SupabaseClient<Database>;

export interface PublicSupabaseConfig {
  url: string;
  publishableKey: string;
}

/**
 * Cliente de navegador. Usa exclusivamente la clave publishable (anon) y opera
 * siempre bajo RLS: nunca puede leer `asset_private_details` ni documentos.
 */
export function createLuxusBrowserClient(config: PublicSupabaseConfig): LuxusClient {
  return createBrowserClient<Database>(config.url, config.publishableKey, {
    auth: {
      flowType: 'pkce',
      autoRefreshToken: true,
      persistSession: true,
      detectSessionInUrl: true,
    },
  });
}

/**
 * Cliente sin sesión, para render estático de páginas públicas (Nivel I).
 */
export function createLuxusAnonClient(config: PublicSupabaseConfig): LuxusClient {
  return createClient<Database>(config.url, config.publishableKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { 'x-luxus-surface': 'public' } },
  });
}
