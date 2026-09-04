import { randomUUID } from 'node:crypto';
import type {
  CheckoutSession, CheckoutSessionRequest, NormalizedPaymentEvent,
  PaymentsProvider, PortalSessionRequest,
} from './types.js';

/**
 * MOCK: reemplazar por proveedor real.
 * Permite recorrer el flujo de suscripción en local sin claves de Stripe.
 * Devuelve una URL de retorno que marca la sesión como completada.
 */
export class MockPaymentsProvider implements PaymentsProvider {
  readonly name = 'mock';

  async ensureCustomer(userId: string): Promise<string> {
    return `cus_mock_${userId.slice(0, 8)}`;
  }

  async createCheckoutSession(request: CheckoutSessionRequest): Promise<CheckoutSession> {
    const sessionId = `cs_mock_${randomUUID().replace(/-/g, '').slice(0, 16)}`;
    const url = new URL(request.successUrl);
    url.searchParams.set('mock_session', sessionId);
    url.searchParams.set('mock_plan', request.planCode ?? 'listing_fee');
    return { provider: this.name, sessionId, url: url.toString() };
  }

  async createPortalSession(request: PortalSessionRequest): Promise<{ url: string }> {
    return { url: `${request.returnUrl}?mock_portal=1` };
  }

  parseWebhook(rawBody: Buffer): NormalizedPaymentEvent {
    const payload = JSON.parse(rawBody.toString('utf8')) as Record<string, unknown>;
    return {
      provider: this.name,
      eventId: String(payload.id ?? randomUUID()),
      type: (payload.type as NormalizedPaymentEvent['type']) ?? 'unhandled',
      userId: payload.user_id ? String(payload.user_id) : undefined,
      planCode: payload.plan_code ? String(payload.plan_code) : undefined,
      status: payload.status ? String(payload.status) : undefined,
      amountCents: typeof payload.amount_cents === 'number' ? payload.amount_cents : undefined,
      currency: 'USD',
      raw: payload,
    };
  }
}
