import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { checkoutSchema, formatCents, listingFeeCheckoutSchema, portalSchema } from '@luxus/shared';
import { badRequest, notFound } from '../plugins/errors.js';
import { assertControlsAsset } from '../lib/guards.js';

/**
 * Monetización.
 *
 * Membresías y suscripciones de bróker son recurrentes; los listing fees son
 * pagos únicos que se cobran al aprobar la publicación de un activo.
 *
 * Los success fees por transacción cerrada NO se cobran aquí: se registran en
 * el deal (deals.success_fee_amount) como dato para facturación manual.
 */
export default async function billingRoutes(app: FastifyInstance): Promise<void> {
  const r = app.withTypeProvider<ZodTypeProvider>();

  const siteUrl = app.config.PUBLIC_SITE_URL;

  r.get('/billing/me', { preHandler: app.requireAuth }, async (request) => {
    const userId = request.auth!.userId;

    const [subs, payments] = await Promise.all([
      app.supabase
        .from('subscriptions')
        .select('*, plans!subscriptions_plan_code_fkey (name, tagline, amount_cents, interval, benefits)')
        .eq('user_id', userId)
        .order('created_at', { ascending: false }),
      app.supabase
        .from('payments')
        .select('*')
        .eq('user_id', userId)
        .order('created_at', { ascending: false })
        .limit(50),
    ]);

    return { subscriptions: subs.data ?? [], payments: payments.data ?? [] };
  });

  // ── Checkout de suscripción ─────────────────────────────────────────────
  r.post(
    '/billing/checkout',
    { preHandler: app.requireAuth, schema: { body: checkoutSchema } },
    async (request) => {
      const profile = request.auth!.profile;

      const { data: plan } = await app.supabase
        .from('plans')
        .select('*')
        .eq('code', request.body.plan_code)
        .eq('is_active', true)
        .maybeSingle();

      if (!plan) throw notFound('El plan solicitado no existe.');

      if (plan.kind === 'broker' && !['broker', 'seller', 'admin'].includes(profile.role)) {
        throw badRequest('wrong_plan', 'Los planes de bróker son para cuentas de bróker.');
      }

      const session = await app.payments.createCheckoutSession({
        userId: profile.id,
        email: profile.email,
        mode: 'subscription',
        planCode: plan.code,
        successUrl: request.body.success_url ?? `${siteUrl}/dashboard/billing?checkout=success`,
        cancelUrl: request.body.cancel_url ?? `${siteUrl}/membership?checkout=cancelled`,
        metadata: { kind: plan.kind },
      });

      await app.audit(request, {
        action: 'billing.checkout_started',
        entityType: 'plan',
        metadata: { plan: plan.code, provider: session.provider },
      });

      return { url: session.url, sessionId: session.sessionId };
    },
  );

  // ── Listing fee (pago único al aprobar un activo) ───────────────────────
  r.post(
    '/billing/listing-fee',
    { preHandler: app.requireAuth, schema: { body: listingFeeCheckoutSchema } },
    async (request) => {
      const profile = request.auth!.profile;
      const asset = await assertControlsAsset(app, request.body.asset_id, profile);

      const { data: fee } = await app.supabase
        .from('listing_fees')
        .select('*')
        .eq('asset_id', asset.id)
        .neq('status', 'paid')
        .order('quoted_at', { ascending: false })
        .maybeSingle();

      if (!fee) throw notFound('Este activo no tiene un listing fee pendiente.');

      const session = await app.payments.createCheckoutSession({
        userId: profile.id,
        email: profile.email,
        mode: 'payment',
        amountCents: fee.amount_cents,
        currency: fee.currency,
        description: `Publicación ${fee.tier === 'signature' ? 'Signature' : 'Private'} — ${asset.title}`,
        successUrl: request.body.success_url ?? `${siteUrl}/dashboard/seller/assets?fee=paid`,
        cancelUrl: request.body.cancel_url ?? `${siteUrl}/dashboard/seller/assets`,
        metadata: { kind: 'listing_fee', asset_id: asset.id, listing_fee_id: fee.id },
      });

      await app.audit(request, {
        action: 'billing.listing_fee_started',
        entityType: 'listing_fee',
        entityId: fee.id,
        assetId: asset.id,
        metadata: { amount_cents: fee.amount_cents },
      });

      return { url: session.url, amount: formatCents(fee.amount_cents, fee.currency) };
    },
  );

  // ── Portal de cliente ───────────────────────────────────────────────────
  r.post(
    '/billing/portal',
    { preHandler: app.requireAuth, schema: { body: portalSchema } },
    async (request) => {
      const profile = request.auth!.profile;

      const { data: sub } = await app.supabase
        .from('subscriptions')
        .select('provider_customer_id')
        .eq('user_id', profile.id)
        .not('provider_customer_id', 'is', null)
        .limit(1)
        .maybeSingle();

      const customerId =
        sub?.provider_customer_id ??
        (await app.payments.ensureCustomer(profile.id, profile.email, profile.full_name));

      const session = await app.payments.createPortalSession({
        customerId,
        returnUrl: request.body.return_url ?? `${siteUrl}/dashboard/billing`,
      });

      return { url: session.url };
    },
  );

  // ── Recibo descargable ──────────────────────────────────────────────────
  r.get(
    '/billing/payments/:id/receipt',
    {
      preHandler: app.requireAuth,
      schema: { params: z.object({ id: z.string().uuid() }) },
    },
    async (request) => {
      const { data: payment } = await app.supabase
        .from('payments')
        .select('*')
        .eq('id', request.params.id)
        .maybeSingle();

      if (!payment) throw notFound('Pago no encontrado.');
      if (payment.user_id !== request.auth!.userId && request.auth!.profile.role !== 'admin') {
        throw notFound('Pago no encontrado.');
      }

      return {
        receipt: {
          number: payment.receipt_number ?? payment.id.slice(0, 8).toUpperCase(),
          issuer: 'LUXUS PERÚ S.A.C.',
          issuerRuc: '20600000000',
          description: payment.description,
          amount: formatCents(payment.amount_cents, payment.currency),
          currency: payment.currency,
          status: payment.status,
          paidAt: payment.paid_at,
          providerUrl: payment.receipt_url,
        },
      };
    },
  );

  // ══════════════════════════════════════════════════════════════════════
  // Webhook de la pasarela
  // ══════════════════════════════════════════════════════════════════════
  app.post(
    '/webhooks/payments',
    { config: { rateLimit: { max: 200, timeWindow: '1 minute' } } },
    async (request, reply) => {
      const signature = request.headers['stripe-signature'] as string | undefined;
      const raw = request.rawBodyBuffer ?? Buffer.from(JSON.stringify(request.body ?? {}));

      let event;
      try {
        event = app.payments.parseWebhook(raw, signature);
      } catch (err) {
        request.log.warn({ err }, 'Webhook de pagos rechazado');
        return reply.code(400).send({
          error: { code: 'invalid_signature', message: 'Firma no válida.' },
        });
      }

      const { error: dupError } = await app.supabase.from('webhook_events').insert({
        provider: event.provider,
        event_id: event.eventId,
        event_type: event.type,
        payload: event.raw as never,
      } as never);

      if (dupError?.code === '23505') {
        return reply.code(200).send({ ok: true, duplicate: true });
      }

      try {
        await handlePaymentEvent(app, event);
        await app.supabase
          .from('webhook_events')
          .update({ processed_at: new Date().toISOString() } as never)
          .eq('provider', event.provider)
          .eq('event_id', event.eventId);
      } catch (err) {
        request.log.error({ err, event: event.type }, 'Error procesando webhook de pagos');
        await app.supabase
          .from('webhook_events')
          .update({ error: err instanceof Error ? err.message : String(err) } as never)
          .eq('provider', event.provider)
          .eq('event_id', event.eventId);
      }

      return reply.code(200).send({ ok: true });
    },
  );
}

type PaymentEvent = Awaited<ReturnType<FastifyInstance['payments']['parseWebhook']>>;

/** Traduce el evento normalizado de la pasarela a estado interno. */
async function handlePaymentEvent(app: FastifyInstance, event: PaymentEvent): Promise<void> {
  const resolveUserId = async (): Promise<string | null> => {
    if (event.userId) return event.userId;
    if (!event.customerId) return null;
    const { data } = await app.supabase
      .from('subscriptions')
      .select('user_id')
      .eq('provider_customer_id', event.customerId)
      .limit(1)
      .maybeSingle();
    return data?.user_id ?? null;
  };

  switch (event.type) {
    case 'checkout.completed': {
      const userId = await resolveUserId();
      if (!userId) return;

      // Pago único (listing fee).
      if (event.metadata?.kind === 'listing_fee') {
        const listingFeeId = event.metadata.listing_fee_id;
        const assetId = event.metadata.asset_id;

        const { data: payment } = await app.supabase
          .from('payments')
          .insert({
            user_id: userId,
            kind: 'listing_fee',
            status: 'paid',
            asset_id: assetId ?? null,
            description: 'Listing fee',
            amount_cents: event.amountCents ?? 0,
            currency: event.currency ?? 'USD',
            provider: event.provider,
            provider_payment_id: event.eventId,
            paid_at: new Date().toISOString(),
            receipt_number: `LX-${new Date().getFullYear()}-${Date.now().toString().slice(-6)}`,
          } as never)
          .select('*')
          .single();

        if (listingFeeId) {
          await app.supabase
            .from('listing_fees')
            .update({ status: 'paid', payment_id: payment?.id ?? null } as never)
            .eq('id', listingFeeId);
        }

        await app.audit(null, {
          action: 'payment.listing_fee_paid',
          entityType: 'payment',
          entityId: payment?.id,
          assetId: assetId ?? undefined,
          actor: { id: userId },
          metadata: { amount_cents: event.amountCents },
        });
        return;
      }

      // Suscripción: se materializa con subscription.updated; aquí solo se
      // guarda el customer para poder abrir el portal más adelante.
      if (event.customerId && event.planCode) {
        const { data: plan } = await app.supabase
          .from('plans')
          .select('kind')
          .eq('code', event.planCode)
          .maybeSingle();

        await app.supabase.from('subscriptions').upsert(
          {
            user_id: userId,
            kind: plan?.kind ?? 'membership',
            plan_code: event.planCode,
            status: 'active',
            provider: event.provider,
            provider_customer_id: event.customerId,
            provider_subscription_id: event.subscriptionId ?? null,
          } as never,
          { onConflict: 'provider_subscription_id' },
        );
      }
      return;
    }

    case 'subscription.updated': {
      const userId = await resolveUserId();
      if (!userId || !event.subscriptionId) return;

      const { data: plan } = event.planCode
        ? await app.supabase.from('plans').select('kind, code').eq('code', event.planCode).maybeSingle()
        : { data: null };

      await app.supabase.from('subscriptions').upsert(
        {
          user_id: userId,
          kind: plan?.kind ?? 'membership',
          plan_code: event.planCode ?? 'membership_private',
          status: (event.status ?? 'active') as never,
          provider: event.provider,
          provider_customer_id: event.customerId ?? null,
          provider_subscription_id: event.subscriptionId,
          current_period_start: event.periodStart ?? null,
          current_period_end: event.periodEnd ?? null,
        } as never,
        { onConflict: 'provider_subscription_id' },
      );

      // El tier de membresía es un derecho de la plataforma: se deriva del
      // plan pagado, nunca lo elige el usuario.
      const tierByPlan: Record<string, string> = {
        membership_private: 'private',
        membership_black: 'black',
        membership_family_office: 'family_office',
      };
      const brokerPlanByCode: Record<string, string> = {
        broker_essential: 'essential',
        broker_professional: 'professional',
        broker_private_desk: 'private_desk',
      };

      const active = ['active', 'trialing'].includes(event.status ?? '');

      if (event.planCode && tierByPlan[event.planCode]) {
        await app.supabase
          .from('profiles')
          .update({
            membership_tier: active ? (tierByPlan[event.planCode] as never) : ('none' as never),
          } as never)
          .eq('id', userId);
      }
      if (event.planCode && brokerPlanByCode[event.planCode]) {
        await app.supabase
          .from('profiles')
          .update({
            broker_plan: active ? (brokerPlanByCode[event.planCode] as never) : ('none' as never),
          } as never)
          .eq('id', userId);
      }
      return;
    }

    case 'subscription.deleted': {
      if (!event.subscriptionId) return;
      const { data: sub } = await app.supabase
        .from('subscriptions')
        .update({ status: 'canceled', canceled_at: new Date().toISOString() } as never)
        .eq('provider_subscription_id', event.subscriptionId)
        .select('user_id, kind')
        .maybeSingle();

      if (sub) {
        await app.supabase
          .from('profiles')
          .update(
            (sub.kind === 'broker'
              ? { broker_plan: 'none' }
              : { membership_tier: 'none' }) as never,
          )
          .eq('id', sub.user_id);
      }
      return;
    }

    case 'invoice.paid': {
      const userId = await resolveUserId();
      if (!userId) return;

      const { data: sub } = event.subscriptionId
        ? await app.supabase
            .from('subscriptions')
            .select('id, plan_code')
            .eq('provider_subscription_id', event.subscriptionId)
            .maybeSingle()
        : { data: null };

      await app.supabase.from('payments').insert({
        user_id: userId,
        kind: 'subscription',
        status: 'paid',
        subscription_id: sub?.id ?? null,
        plan_code: sub?.plan_code ?? null,
        description: 'Suscripción LUXUS PERÚ',
        amount_cents: event.amountCents ?? 0,
        currency: event.currency ?? 'USD',
        provider: event.provider,
        provider_payment_id: event.eventId,
        provider_invoice_id: event.invoiceId ?? null,
        receipt_url: event.receiptUrl ?? null,
        receipt_number: `LX-${new Date().getFullYear()}-${Date.now().toString().slice(-6)}`,
        paid_at: new Date().toISOString(),
      } as never);

      const { data: user } = await app.supabase
        .from('profiles')
        .select('email, full_name')
        .eq('id', userId)
        .maybeSingle();

      if (user) {
        await app.sendMail({
          to: user.email,
          userId,
          template: 'payment_receipt',
          subject: '',
          data: {
            name: user.full_name ?? '',
            amount: formatCents(event.amountCents ?? 0, event.currency ?? 'USD'),
            description: 'Suscripción LUXUS PERÚ',
            receiptNumber: event.invoiceId ?? '',
          },
        });
      }
      return;
    }

    case 'invoice.failed': {
      const userId = await resolveUserId();
      if (!userId) return;

      await app.supabase
        .from('subscriptions')
        .update({ status: 'past_due' } as never)
        .eq('provider_subscription_id', event.subscriptionId ?? '');

      const { data: user } = await app.supabase
        .from('profiles')
        .select('email, full_name')
        .eq('id', userId)
        .maybeSingle();

      if (user) {
        await app.sendMail({
          to: user.email,
          userId,
          template: 'subscription_past_due',
          subject: '',
          data: { name: user.full_name ?? '', planName: 'suscripción' },
        });
      }
      return;
    }

    default:
      return;
  }
}
