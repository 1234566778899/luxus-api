import type { FastifyInstance } from 'fastify';
import type { AppConfig } from '../../config.js';
import { MockEmailProvider, ResendEmailProvider } from './providers.js';
import { renderTemplate } from './templates.js';
import type { EmailMessage, EmailProvider } from './types.js';

export * from './types.js';

export function createEmailProvider(config: AppConfig, log: FastifyInstance['log']): EmailProvider {
  switch (config.EMAIL_PROVIDER) {
    case 'resend':
      return new ResendEmailProvider(config.RESEND_API_KEY, config.EMAIL_FROM);
    case 'sendgrid':
      // MOCK: reemplazar por proveedor real.
      throw new Error(
        '[luxus:email] SendGrid aún no está implementado. ' +
          'Implemente EmailProvider en apps/api/src/services/email/providers.ts.',
      );
    case 'mock':
    default:
      return new MockEmailProvider((msg, data) => log.info(data, msg));
  }
}

/** Clave de preferencia que gobierna cada plantilla. */
const PREFERENCE_BY_TEMPLATE: Record<string, string | null> = {
  deal_access_requested: 'email_deal_activity',
  deal_access_approved: 'email_deal_activity',
  deal_access_declined: 'email_deal_activity',
  nda_pending: 'email_deal_activity',
  nda_signed: 'email_deal_activity',
  qa_new_message: 'email_qa',
  offer_received: 'email_offers',
  offer_response: 'email_offers',
  loi_ready: 'email_offers',
  permission_expiring: 'email_expiry_alerts',
  permission_expired: 'email_expiry_alerts',
  kyc_approved: 'email_kyc',
  kyc_rejected: 'email_kyc',
  kyc_manual_review: 'email_kyc',
  payment_receipt: 'email_billing',
  subscription_past_due: 'email_billing',
  asset_published: 'email_deal_activity',
  asset_changes_requested: 'email_deal_activity',
  // Los correos de admisión no son opcionales: son transaccionales puros.
  private_access_approved: null,
  private_access_rejected: null,
};

/**
 * Envía respetando las preferencias del destinatario y deja traza en email_log.
 * No lanza: un fallo de correo no debe abortar una transacción de negocio.
 */
export async function sendEmail(
  app: FastifyInstance,
  config: AppConfig,
  provider: EmailProvider,
  message: EmailMessage,
): Promise<void> {
  try {
    const preferenceKey = PREFERENCE_BY_TEMPLATE[message.template];

    if (preferenceKey && message.userId) {
      const { data: prefs } = await app.supabase
        .from('notification_preferences')
        .select('*')
        .eq('user_id', message.userId)
        .maybeSingle();

      if (prefs && (prefs as Record<string, unknown>)[preferenceKey] === false) {
        app.log.debug({ template: message.template, userId: message.userId }, 'Correo omitido por preferencia');
        return;
      }
      if (prefs && prefs.digest_frequency === 'off') return;
    }

    const rendered = renderTemplate(message, config.PUBLIC_SITE_URL);
    const result = await provider.send(
      { ...message, subject: rendered.subject },
      rendered.html,
      rendered.text,
    );

    await app.supabase.from('email_log').insert({
      user_id: message.userId ?? null,
      to_email: message.to,
      template: message.template,
      subject: rendered.subject,
      provider: result.provider,
      provider_ref: result.providerRef,
      status: result.status,
      error: result.error ?? null,
      payload: message.data as never,
    } as never);
  } catch (err) {
    app.log.error({ err, template: message.template }, 'Fallo enviando correo transaccional');
  }
}
