import fp from 'fastify-plugin';
import { createLuxusAdminClient, createLuxusUserClient, type LuxusClient } from '@luxus/shared';
import type { AppConfig } from '../config.js';

declare module 'fastify' {
  interface FastifyInstance {
    /** Cliente con service_role: elude RLS. Uso deliberado y auditado. */
    supabase: LuxusClient;
    /** Cliente que actúa en nombre del usuario: RLS sigue aplicando. */
    supabaseAs(accessToken: string): LuxusClient;
  }
}

export default fp<{ config: AppConfig }>(
  async (app, opts) => {
    const { config } = opts;

    const admin = createLuxusAdminClient(config.SUPABASE_URL, config.SUPABASE_SERVICE_ROLE_KEY);

    app.decorate('supabase', admin);
    app.decorate('supabaseAs', (accessToken: string) =>
      createLuxusUserClient(
        { url: config.SUPABASE_URL, publishableKey: config.SUPABASE_PUBLISHABLE_KEY },
        accessToken,
      ),
    );

    app.log.info(
      { url: config.SUPABASE_URL },
      'Supabase conectado (service role activo solo en el proceso de la API)',
    );
  },
  { name: 'luxus-supabase' },
);
