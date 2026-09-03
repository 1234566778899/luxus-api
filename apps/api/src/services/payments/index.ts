import type { FastifyInstance } from 'fastify';
import type { AppConfig } from '../../config.js';
import { MockPaymentsProvider } from './mock.js';
import { StripePaymentsProvider } from './stripe.js';
import type { PaymentsProvider } from './types.js';

export * from './types.js';

export function createPaymentsProvider(config: AppConfig, app: FastifyInstance): PaymentsProvider {
  switch (config.PAYMENTS_PROVIDER) {
    case 'stripe':
      return new StripePaymentsProvider(
        config.STRIPE_SECRET_KEY,
        config.STRIPE_WEBHOOK_SECRET,
        async (planCode) => {
          const { data } = await app.supabase
            .from('plans')
            .select('stripe_price_id')
            .eq('code', planCode)
            .maybeSingle();
          return data?.stripe_price_id ?? null;
        },
      );
    case 'culqi':
      // Pasarela local peruana. El contrato PaymentsProvider ya contempla
      // checkout hospedado + webhooks; falta el adaptador.
      throw new Error(
        '[luxus:payments] La pasarela local (Culqi) aún no está implementada. ' +
          'Implemente PaymentsProvider en apps/api/src/services/payments/ y regístrela aquí.',
      );
    case 'mock':
    default:
      return new MockPaymentsProvider();
  }
}
