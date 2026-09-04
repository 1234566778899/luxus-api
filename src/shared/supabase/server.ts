import { createServerClient, type CookieOptions } from '@supabase/ssr';
import { createClient } from '@supabase/supabase-js';
import WebSocket from 'ws';
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
 * supabase-js instancia un `RealtimeClient` en cuanto se crea el cliente,
 * aunque nunca se abra un canal — y ese constructor exige un `WebSocket`
 * global. Los navegadores siempre lo traen; Node solo lo trae nativo desde
 * la versión 22. Mientras el despliegue de Vercel siga en Node 20 (el
 * adapter de Astro compatible con Astro 4 no reconoce 22 como runtime
 * válido), toda función de servidor que construya un cliente sin este
 * transporte explícito revienta con "Node.js detected but native WebSocket
 * not found" en la primera petición. Se le pasa `ws` a mano para no
 * depender de qué versión de Node termine corriendo el hosting.
 */

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
    realtime: { transport: WebSocket as any },
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
    realtime: { transport: WebSocket as any },
  });
}

/**
 * Cliente sin sesión, para render estático de páginas públicas (Nivel I).
 * Corre en el servidor (Astro SSR), nunca en el navegador — por eso vive
 * aquí y no en `client.ts`, que sí se empaqueta para las islas de React.
 */
export function createLuxusAnonClient(config: PublicSupabaseConfig): LuxusClient {
  return createClient<Database>(config.url, config.publishableKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { 'x-luxus-surface': 'public' } },
    realtime: { transport: WebSocket as any },
  });
}
