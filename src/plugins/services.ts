import fp from 'fastify-plugin';
import type { AppConfig } from '../config.js';
import { createKycProvider, type KycProvider } from '../services/kyc/index.js';
import { createScreeningProvider, type ScreeningProvider } from '../services/screening/index.js';
import { createEsignProvider, type EsignProvider } from '../services/esign/index.js';
import { createEmailProvider, sendEmail, type EmailMessage, type EmailProvider } from '../services/email/index.js';
import { createPaymentsProvider, type PaymentsProvider } from '../services/payments/index.js';
import { notify, type NotificationInput } from '../services/notifications.js';

declare module 'fastify' {
  interface FastifyInstance {
    config: AppConfig;
    kyc: KycProvider;
    screening: ScreeningProvider;
    esign: EsignProvider;
    email: EmailProvider;
    payments: PaymentsProvider;
    sendMail(message: EmailMessage): Promise<void>;
    notify(input: NotificationInput): Promise<void>;
  }
}

/**
 * Cablea los proveedores externos. Todos se instancian de forma perezosa salvo
 * los que fallan rápido por configuración: así el proceso arranca en local con
 * mocks aunque no haya claves de Stripe ni de correo.
 */
export default fp<{ config: AppConfig }>(
  async (app, opts) => {
    const { config } = opts;

    app.decorate('config', config);
    app.decorate('kyc', createKycProvider(config));
    app.decorate('screening', createScreeningProvider(config));
    app.decorate('esign', createEsignProvider(config));
    app.decorate('email', createEmailProvider(config, app.log));
    app.decorate('payments', createPaymentsProvider(config, app));

    app.decorate('sendMail', (message: EmailMessage) =>
      sendEmail(app, config, app.email, message),
    );
    app.decorate('notify', (input: NotificationInput) => notify(app, input));

    app.log.info(
      {
        kyc: config.KYC_PROVIDER,
        screening: config.SCREENING_PROVIDER,
        esign: config.ESIGN_PROVIDER,
        email: config.EMAIL_PROVIDER,
        payments: config.PAYMENTS_PROVIDER,
      },
      'Proveedores externos configurados',
    );
  },
  { name: 'luxus-services', dependencies: ['luxus-supabase'] },
);
