import { createServerClient, type CookieOptions } from '@supabase/ssr';
import { createClient } from '@supabase/supabase-js';
import type { Database } from '../types/database.types.js';
import type { LuxusClient, PublicSupabaseConfig } from './client.js';

export interface CookieRecord {
  name: string;
  value: string;
  options?: CookieOptions;
}

/**
 * Adaptador mínimo sobre el objeto de cookies del framework.
 * Astro expone `Astro.cookies`; cualquier host puede implementar estas dos.
 */
export interface CookieAdapter {
  getAll(): CookieRecord[];
  setAll(cookies: CookieRecord[]): void;
}

/**
 * Cliente para SSR de Astro: lee y renueva la sesión desde cookies.
 * Sigue sujeto a RLS — el nivel de acceso lo decide la base de datos, no el
 * servidor de render.
 */
export function createLuxusServerClient(
  config: PublicSupabaseConfig,
  cookies: CookieAdapter,
): LuxusClient {
  return createServerClient<Database>(config.url, config.publishableKey, {
    cookies: {
      getAll: () => cookies.getAll().map(({ name, value }) => ({ name, value })),
      setAll: (records) => cookies.setAll(records),
    },
  });
}

/**
 * Cliente que actúa *en nombre del usuario* a partir de su access token.
 * Lo usa Fastify para las lecturas donde queremos que RLS siga aplicando:
 * la API sube a service role solo cuando la operación lo exige.
 */
export function createLuxusUserClient(
  config: PublicSupabaseConfig,
  accessToken: string,
): LuxusClient {
  return createClient<Database>(config.url, config.publishableKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${accessToken}` } },
  });
}
