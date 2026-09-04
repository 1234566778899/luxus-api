/**
 * Contrato de la pasarela de pagos.
 *
 * Stripe es la implementación inicial. El contrato se mantiene deliberadamente
 * genérico (checkout hospedado + portal + webhooks) para poder añadir después
 * una pasarela local peruana (Culqi, Niubiz, Izipay) sin tocar las rutas.
 *
 * Los success fees por transacción cerrada NO pasan por aquí: se registran en
 * el deal como dato para facturación manual.
 */

export interface CheckoutSessionRequest {
  userId: string;
  email: string;
  mode: 'subscription' | 'payment';
  /** Código de plan interno; el adaptador lo traduce a su precio. */
  planCode?: string;
  amountCents?: number;
  currency?: string;
  description?: string;
  successUrl: string;
  cancelUrl: string;
  metadata?: Record<string, string>;
}

export interface CheckoutSession {
  provider: string;
  sessionId: string;
  url: string;
}

export interface PortalSessionRequest {
  customerId: string;
  returnUrl: string;
}

export interface NormalizedPaymentEvent {
  provider: string;
  eventId: string;
  type:
    | 'checkout.completed'
    | 'subscription.updated'
    | 'subscription.deleted'
    | 'invoice.paid'
    | 'invoice.failed'
    | 'unhandled';
  userId?: string;
  customerId?: string;
  subscriptionId?: string;
  planCode?: string;
  status?: string;
  amountCents?: number;
  currency?: string;
  invoiceId?: string;
  paymentId?: string;
  receiptUrl?: string;
  periodStart?: string;
  periodEnd?: string;
  metadata?: Record<string, string>;
  raw: unknown;
}

export interface PaymentsProvider {
  readonly name: string;
  createCheckoutSession(request: CheckoutSessionRequest): Promise<CheckoutSession>;
  createPortalSession(request: PortalSessionRequest): Promise<{ url: string }>;
  ensureCustomer(userId: string, email: string, name?: string | null): Promise<string>;
  parseWebhook(rawBody: Buffer, signature: string | undefined): NormalizedPaymentEvent;
}
