import Stripe from 'stripe';
import type {
  CheckoutSession, CheckoutSessionRequest, NormalizedPaymentEvent,
  PaymentsProvider, PortalSessionRequest,
} from './types.js';

/** Traduce el código de plan interno al price id de Stripe. */
export type PriceResolver = (planCode: string) => Promise<string | null>;

export class StripePaymentsProvider implements PaymentsProvider {
  readonly name = 'stripe';
  private readonly stripe: Stripe;

  constructor(
    secretKey: string,
    private readonly webhookSecret: string,
    private readonly resolvePrice: PriceResolver,
  ) {
    // Sin fijar apiVersion: se usa la del SDK instalado, que es la que
    // corresponde a los tipos con los que compila este archivo.
    this.stripe = new Stripe(secretKey);
  }

  async ensureCustomer(userId: string, email: string, name?: string | null): Promise<string> {
    const existing = await this.stripe.customers.search({
      query: `metadata['luxus_user_id']:'${userId}'`,
      limit: 1,
    });
    if (existing.data[0]) return existing.data[0].id;

    const customer = await this.stripe.customers.create({
      email,
      name: name ?? undefined,
      metadata: { luxus_user_id: userId },
    });
    return customer.id;
  }

  async createCheckoutSession(request: CheckoutSessionRequest): Promise<CheckoutSession> {
    const customerId = await this.ensureCustomer(request.userId, request.email);

    const lineItem: Stripe.Checkout.SessionCreateParams.LineItem =
      request.mode === 'subscription'
        ? { price: await this.requirePrice(request.planCode), quantity: 1 }
        : {
            quantity: 1,
            price_data: {
              currency: (request.currency ?? 'usd').toLowerCase(),
              unit_amount: request.amountCents ?? 0,
              product_data: { name: request.description ?? 'LUXUS PERÚ' },
            },
          };

    const session = await this.stripe.checkout.sessions.create({
      mode: request.mode,
      customer: customerId,
      line_items: [lineItem],
      success_url: request.successUrl,
      cancel_url: request.cancelUrl,
      client_reference_id: request.userId,
      metadata: {
        luxus_user_id: request.userId,
        ...(request.planCode ? { luxus_plan_code: request.planCode } : {}),
        ...request.metadata,
      },
      ...(request.mode === 'subscription'
        ? {
            subscription_data: {
              metadata: {
                luxus_user_id: request.userId,
                ...(request.planCode ? { luxus_plan_code: request.planCode } : {}),
              },
            },
          }
        : {}),
    });

    if (!session.url) throw new Error('Stripe no devolvió URL de checkout.');
    return { provider: this.name, sessionId: session.id, url: session.url };
  }

  async createPortalSession(request: PortalSessionRequest): Promise<{ url: string }> {
    const session = await this.stripe.billingPortal.sessions.create({
      customer: request.customerId,
      return_url: request.returnUrl,
    });
    return { url: session.url };
  }

  parseWebhook(rawBody: Buffer, signature: string | undefined): NormalizedPaymentEvent {
    if (!signature) throw new Error('Falta la cabecera stripe-signature.');
    const event = this.stripe.webhooks.constructEvent(rawBody, signature, this.webhookSecret);

    const base = { provider: this.name, eventId: event.id, raw: event };

    switch (event.type) {
      case 'checkout.session.completed': {
        const s = event.data.object;
        return {
          ...base,
          type: 'checkout.completed',
          userId: s.metadata?.luxus_user_id,
          customerId: typeof s.customer === 'string' ? s.customer : undefined,
          subscriptionId: typeof s.subscription === 'string' ? s.subscription : undefined,
          planCode: s.metadata?.luxus_plan_code,
          amountCents: s.amount_total ?? undefined,
          currency: s.currency?.toUpperCase(),
          metadata: (s.metadata ?? {}) as Record<string, string>,
        };
      }
      case 'customer.subscription.created':
      case 'customer.subscription.updated': {
        const s = event.data.object;
        return {
          ...base,
          type: 'subscription.updated',
          userId: s.metadata?.luxus_user_id,
          customerId: typeof s.customer === 'string' ? s.customer : undefined,
          subscriptionId: s.id,
          planCode: s.metadata?.luxus_plan_code,
          status: s.status,
          periodStart: new Date(s.current_period_start * 1000).toISOString(),
          periodEnd: new Date(s.current_period_end * 1000).toISOString(),
        };
      }
      case 'customer.subscription.deleted': {
        const s = event.data.object;
        return {
          ...base,
          type: 'subscription.deleted',
          subscriptionId: s.id,
          customerId: typeof s.customer === 'string' ? s.customer : undefined,
          status: 'canceled',
        };
      }
      case 'invoice.paid': {
        const i = event.data.object;
        return {
          ...base,
          type: 'invoice.paid',
          customerId: typeof i.customer === 'string' ? i.customer : undefined,
          subscriptionId: typeof i.subscription === 'string' ? i.subscription : undefined,
          amountCents: i.amount_paid,
          currency: i.currency?.toUpperCase(),
          invoiceId: i.id,
          receiptUrl: i.hosted_invoice_url ?? undefined,
        };
      }
      case 'invoice.payment_failed': {
        const i = event.data.object;
        return {
          ...base,
          type: 'invoice.failed',
          customerId: typeof i.customer === 'string' ? i.customer : undefined,
          subscriptionId: typeof i.subscription === 'string' ? i.subscription : undefined,
          invoiceId: i.id,
        };
      }
      default:
        return { ...base, type: 'unhandled' };
    }
  }

  private async requirePrice(planCode?: string): Promise<string> {
    if (!planCode) throw new Error('Falta el código de plan.');
    const price = await this.resolvePrice(planCode);
    if (!price) {
      throw new Error(
        `El plan ${planCode} no tiene stripe_price_id configurado. ` +
          'Cree el precio en Stripe y actualice la columna plans.stripe_price_id.',
      );
    }
    return price;
  }
}
