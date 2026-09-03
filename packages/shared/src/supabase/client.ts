import { createBrowserClient } from '@supabase/ssr';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '../types/database.types.js';

export type LuxusClient = SupabaseClient<Database>;

export interface PublicSupabaseConfig {
  url: string;
  publishableKey: string;
}

/**
 * Cliente de navegador. Usa exclusivamente la clave publishable (anon) y opera
 * siempre bajo RLS: nunca puede leer `asset_private_details` ni documentos.
 *
 * Solo esta función pertenece de verdad a este archivo: es la única que se
 * empaqueta para el navegador. `createLuxusAnonClient` vivía aquí también por
 * nombre ("cliente sin sesión"), pero en realidad corre en el servidor
 * (render estático de Nivel I) — se movió a `server.ts` para que este módulo
 * nunca arrastre la dependencia `ws` (que no existe en el navegador) al
 * bundle de las islas de React.
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
