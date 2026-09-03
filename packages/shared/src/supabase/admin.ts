import { createClient } from '@supabase/supabase-js';
import type { Database } from '../types/database.types.js';
import type { LuxusClient } from './client.js';

/**
 * Cliente con service_role: ELUDE RLS por completo.
 *
 * Solo puede instanciarse en el proceso de la API Fastify. La guarda de abajo
 * es una red de seguridad: si este módulo termina alguna vez en un bundle de
 * navegador (una isla de React, por ejemplo), falla en vez de filtrar la clave.
 */
export function createLuxusAdminClient(url: string, serviceRoleKey: string): LuxusClient {
  if (typeof window !== 'undefined') {
    throw new Error(
      '[luxus] createLuxusAdminClient no puede ejecutarse en el navegador. ' +
        'La service_role key es exclusiva del servidor.',
    );
  }
  if (!serviceRoleKey) {
    throw new Error('[luxus] Falta SUPABASE_SERVICE_ROLE_KEY en el entorno de la API.');
  }
  // Las publishable empiezan por sb_publishable_; las de servidor son un JWT
  // (legacy) o empiezan por sb_secret_. Confundirlas rompe silenciosamente
  // todas las escrituras de la API, así que se detecta en el arranque.
  if (serviceRoleKey.startsWith('sb_publishable_')) {
    throw new Error(
      '[luxus] SUPABASE_SERVICE_ROLE_KEY contiene una clave publishable. ' +
        'Use la service_role (o secret) key del proyecto.',
    );
  }

  return createClient<Database>(url, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { 'x-luxus-surface': 'api' } },
  });
}
