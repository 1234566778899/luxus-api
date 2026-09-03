import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import {
  createOfferSchema, formatUsd, generateLoiSchema, isDealRoomOpen, respondOfferSchema,
} from '@luxus/shared';
import { badRequest, conflict, forbidden, notFound } from '../plugins/errors.js';
import { loadDealContext } from '../lib/guards.js';
import { requireRow } from '../lib/db.js';
import { createSignedUrl, uploadObject } from '../lib/storage.js';
import { generateLoiPdf } from '../services/pdf/documents.js';

const SIGNED_BUCKET = 'signed-documents';

export default async function offerRoutes(app: FastifyInstance): Promise<void> {
  const r = app.withTypeProvider<ZodTypeProvider>();

  // ── Presentar oferta ────────────────────────────────────────────────────
  r.post(
    '/offers',
    {
      preHandler: app.requireAuth,
      config: { rateLimit: { max: 20, timeWindow: '1 hour' } },
      schema: { body: createOfferSchema },
    },
    async (request, reply) => {
      const profile = request.auth!.profile;
      const { deal, asset, side } = await loadDealContext(app, request.body.deal_id, profile);

      if (side === 'broker') throw forbidden('El bróker no presenta ofertas en nombre propio.');
      if (!isDealRoomOpen(deal.stage)) {
        throw conflict('deal_closed', 'El Deal Room no admite ofertas en este momento.');
      }

      const round = request.body.parent_offer_id
        ? ((
            await app.supabase
              .from('offers')
              .select('round')
              .eq('id', request.body.parent_offer_id)
              .maybeSingle()
          ).data?.round ?? 0) + 1
        : 1;

      const { data: offer, error } = await app.supabase
        .from('offers')
        .insert({
          deal_id: deal.id,
          author_id: profile.id,
          parent_offer_id: request.body.parent_offer_id ?? null,
          round,
          amount: request.body.amount,
          currency: request.body.currency,
          payment_structure: request.body.payment_structure,
          deposit_amount: request.body.deposit_amount ?? null,
          conditions: request.body.conditions ?? null,
          dd_period_days: request.body.dd_period_days ?? null,
          exclusivity_days: request.body.exclusivity_days ?? null,
          valid_until: request.body.valid_until ?? null,
        } as never)
        .select('*')
        .single();

      if (error || !offer) throw badRequest('offer_failed', 'No se pudo registrar la oferta.');

      if (deal.stage !== 'offer' && deal.stage !== 'loi') {
        await app.supabase.from('deals').update({ stage: 'offer' } as never).eq('id', deal.id);
      }

      const counterpartId = profile.id === deal.buyer_id ? deal.seller_id : deal.buyer_id;
      const { data: counterpart } = await app.supabase
        .from('profiles')
        .select('email, full_name')
        .eq('id', counterpartId)
        .maybeSingle();

      if (counterpart) {
        await app.sendMail({
          to: counterpart.email,
          userId: counterpartId,
          template: 'offer_received',
          subject: '',
          data: {
            assetTitle: asset.title,
            amount: formatUsd(request.body.amount),
            validUntil: request.body.valid_until ?? 'sin plazo indicado',
            dealId: deal.id,
          },
        });
      }

      await app.notify({
        userId: counterpartId,
        type: 'offer.received',
        title: 'Oferta recibida',
        body: `${formatUsd(request.body.amount)} por «${asset.title}».`,
        link: `/deal/${deal.id}#offers`,
        dealId: deal.id,
        severity: 'info',
      });

      await app.audit(request, {
        action: 'offer.submitted',
        entityType: 'offer',
        entityId: offer.id,
        dealId: deal.id,
        assetId: asset.id,
        metadata: { amount: request.body.amount, round },
      });

      return reply.code(201).send({ offer });
    },
  );

  // ── Responder: aceptar / rechazar / contraofertar ───────────────────────
  r.post(
    '/offers/respond',
    { preHandler: app.requireAuth, schema: { body: respondOfferSchema } },
    async (request) => {
      const profile = request.auth!.profile;

      const { data: offer } = await app.supabase
        .from('offers')
        .select('*')
        .eq('id', request.body.offer_id)
        .maybeSingle();

      if (!offer) throw notFound('Oferta no encontrada.');
      if (offer.author_id === profile.id) {
        throw forbidden('No puede responder a su propia oferta.');
      }
      if (offer.status !== 'submitted') {
        throw conflict('already_answered', 'Esta oferta ya fue respondida.');
      }

      const { deal, asset } = await loadDealContext(app, offer.deal_id, profile);

      const statusByAction = {
        accept: 'accepted',
        reject: 'rejected',
        counter: 'countered',
      } as const;

      await app.supabase
        .from('offers')
        .update({
          status: statusByAction[request.body.action],
          responded_by: profile.id,
          responded_at: new Date().toISOString(),
          response_note: request.body.response_note ?? null,
        } as never)
        .eq('id', offer.id);

      let counterOffer = null;
      if (request.body.action === 'counter' && request.body.counter) {
        const c = request.body.counter;
        const { data } = await app.supabase
          .from('offers')
          .insert({
            deal_id: deal.id,
            author_id: profile.id,
            parent_offer_id: offer.id,
            round: offer.round + 1,
            amount: c.amount,
            currency: c.currency,
            payment_structure: c.payment_structure,
            deposit_amount: c.deposit_amount ?? null,
            conditions: c.conditions ?? null,
            dd_period_days: c.dd_period_days ?? null,
            exclusivity_days: c.exclusivity_days ?? null,
            valid_until: c.valid_until ?? null,
          } as never)
          .select('*')
          .single();
        counterOffer = data;
      }

      const counterpartId = offer.author_id;
      const { data: counterpart } = await app.supabase
        .from('profiles')
        .select('email, full_name')
        .eq('id', counterpartId)
        .maybeSingle();

      const actionLabel = {
        accept: 'aceptada',
        reject: 'rechazada',
        counter: 'contraofertada',
      }[request.body.action];

      if (counterpart) {
        await app.sendMail({
          to: counterpart.email,
          userId: counterpartId,
          template: 'offer_response',
          subject: '',
          data: {
            assetTitle: asset.title,
            action: actionLabel,
            note: request.body.response_note ?? '',
            dealId: deal.id,
          },
        });
      }

      await app.notify({
        userId: counterpartId,
        type: 'offer.response',
        title: `Su oferta fue ${actionLabel}`,
        body: request.body.response_note ?? `Sobre «${asset.title}».`,
        link: `/deal/${deal.id}#offers`,
        dealId: deal.id,
        severity: request.body.action === 'accept' ? 'success' : 'info',
      });

      await app.audit(request, {
        action: `offer.${request.body.action}ed`,
        entityType: 'offer',
        entityId: offer.id,
        dealId: deal.id,
        assetId: asset.id,
        metadata: { note: request.body.response_note, counter: counterOffer?.id },
      });

      return { ok: true, status: statusByAction[request.body.action], counterOffer };
    },
  );

  // ── Generar la LOI a partir de una oferta aceptada ──────────────────────
  r.post(
    '/loi',
    { preHandler: app.requireAuth, schema: { body: generateLoiSchema } },
    async (request, reply) => {
      const profile = request.auth!.profile;

      const { data: offer } = await app.supabase
        .from('offers')
        .select('*')
        .eq('id', request.body.offer_id)
        .maybeSingle();

      if (!offer) throw notFound('Oferta no encontrada.');

      const { deal, asset, side } = await loadDealContext(app, offer.deal_id, profile);
      if (side === 'buyer') throw forbidden('La LOI la emite el vendedor o la plataforma.');
      if (offer.status !== 'accepted') {
        throw conflict('offer_not_accepted', 'La LOI se genera sobre una oferta aceptada.');
      }

      const [buyerResult, sellerResult] = await Promise.all([
        app.supabase.from('profiles').select('id, full_name, email').eq('id', deal.buyer_id).single(),
        app.supabase.from('profiles').select('id, full_name, email').eq('id', deal.seller_id).single(),
      ]);
      const buyer = requireRow(buyerResult, 'El comprador ya no existe.');
      const seller = requireRow(sellerResult, 'El vendedor ya no existe.');

      const terms = request.body.terms;
      const expiry = new Date(Date.now() + terms.expiry_days * 86_400_000);

      const pdf = await generateLoiPdf({
        dealReference: deal.reference_code,
        assetTitle: asset.title,
        assetReference: asset.reference_code,
        buyerName: buyer.full_name ?? buyer.email,
        sellerName: seller.full_name ?? seller.email,
        issuedAt: new Date(),
        purchasePrice: formatUsd(terms.purchase_price),
        structure: terms.structure,
        depositAmount: terms.deposit_amount ? formatUsd(terms.deposit_amount) : undefined,
        ddPeriodDays: terms.dd_period_days,
        exclusivityDays: terms.exclusivity_days,
        conditionsPrecedent: terms.conditions_precedent,
        governingLaw: terms.governing_law,
        disputeResolution: terms.dispute_resolution,
        expiryDate: expiry.toLocaleDateString('es-PE'),
        templateVersion: 'loi-v1-es-PE',
      });

      const draftPath = `lois/${deal.reference_code}/loi-${offer.id}.pdf`;
      await uploadObject(app, SIGNED_BUCKET, draftPath, pdf, 'application/pdf');

      const envelope = await app.esign.createEnvelope({
        referenceId: `${deal.id}:loi:${offer.id}`,
        documentTitle: `LOI — ${asset.title} (${deal.reference_code})`,
        pdf,
        signers: [
          { name: buyer.full_name ?? buyer.email, email: buyer.email, role: 'buyer' },
          { name: seller.full_name ?? seller.email, email: seller.email, role: 'seller' },
        ],
        expiresInDays: terms.expiry_days,
        callbackUrl: `${app.config.PUBLIC_SITE_URL}/deal/${deal.id}`,
        metadata: { deal_id: deal.id, offer_id: offer.id, kind: 'loi' },
      });

      const { data: loi, error } = await app.supabase
        .from('lois')
        .insert({
          deal_id: deal.id,
          offer_id: offer.id,
          status: 'sent',
          template_version: 'loi-v1-es-PE',
          terms: terms as never,
          bucket: SIGNED_BUCKET,
          draft_path: draftPath,
          provider: envelope.provider,
          provider_envelope_id: envelope.envelopeId,
          sent_at: new Date().toISOString(),
          expires_at: expiry.toISOString(),
          created_by: profile.id,
        } as never)
        .select('*')
        .single();

      if (error || !loi) throw badRequest('loi_failed', 'No se pudo generar la LOI.');

      await app.supabase.from('deals').update({ stage: 'loi' } as never).eq('id', deal.id);

      for (const user of [buyer, seller]) {
        await app.sendMail({
          to: user.email,
          userId: user.id,
          template: 'loi_ready',
          subject: '',
          data: { assetTitle: asset.title, dealId: deal.id },
        });
        await app.notify({
          userId: user.id,
          type: 'loi.ready',
          title: 'Carta de intención lista',
          body: `La LOI de «${asset.title}» está lista para firma.`,
          link: `/deal/${deal.id}#loi`,
          dealId: deal.id,
        });
      }

      await app.audit(request, {
        action: 'loi.generated',
        entityType: 'loi',
        entityId: loi.id,
        dealId: deal.id,
        assetId: asset.id,
        metadata: { offer_id: offer.id, amount: terms.purchase_price },
      });

      return reply.code(201).send({ loi, signingUrl: envelope.signingUrl ?? null });
    },
  );

  // ── Descargar la LOI ────────────────────────────────────────────────────
  r.get(
    '/loi/:id/document',
    {
      preHandler: app.requireAuth,
      schema: { params: z.object({ id: z.string().uuid() }) },
    },
    async (request) => {
      const profile = request.auth!.profile;

      const { data: loi } = await app.supabase
        .from('lois')
        .select('*')
        .eq('id', request.params.id)
        .maybeSingle();

      if (!loi) throw notFound('LOI no encontrada.');
      const { deal } = await loadDealContext(app, loi.deal_id, profile);

      const path = loi.signed_path ?? loi.draft_path;
      if (!path) throw notFound('La LOI no tiene documento asociado.');

      const url = await createSignedUrl(app, loi.bucket, path, app.config.SIGNED_URL_TTL);

      await app.audit(request, {
        action: 'loi.viewed',
        entityType: 'loi',
        entityId: loi.id,
        dealId: deal.id,
      });

      return { url, expiresIn: app.config.SIGNED_URL_TTL, status: loi.status };
    },
  );
}
