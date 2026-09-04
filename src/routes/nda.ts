import { createHash } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { conflict, forbidden, notFound, badRequest } from '../plugins/errors.js';
import { loadDealContext } from '../lib/guards.js';
import { embedded, requireRow } from '../lib/db.js';
import { createSignedUrl, uploadObject } from '../lib/storage.js';
import { generateNdaPdf } from '../services/pdf/documents.js';

const SIGNED_BUCKET = 'signed-documents';
const NDA_DURATION_MONTHS = 24;

export default async function ndaRoutes(app: FastifyInstance): Promise<void> {
  const r = app.withTypeProvider<ZodTypeProvider>();

  // ── Emitir el NDA del deal ──────────────────────────────────────────────
  r.post(
    '/deals/:id/nda/issue',
    {
      preHandler: app.requireAuth,
      schema: { params: z.object({ id: z.string().uuid() }) },
    },
    async (request) => {
      const profile = request.auth!.profile;
      const { deal, asset, side } = await loadDealContext(app, request.params.id, profile);

      if (side === 'buyer') throw forbidden('El NDA lo emite el vendedor o la plataforma.');
      if (deal.stage !== 'nda_pending' && deal.stage !== 'seller_review') {
        throw conflict('invalid_stage', 'El deal no está en fase de emisión de NDA.');
      }

      const { data: existing } = await app.supabase
        .from('ndas')
        .select('*')
        .eq('deal_id', deal.id)
        .maybeSingle();

      if (existing?.status === 'signed') {
        throw conflict('already_signed', 'El NDA ya fue firmado.');
      }

      const [buyerResult, sellerResult] = await Promise.all([
        app.supabase.from('profiles').select('id, full_name, email').eq('id', deal.buyer_id).single(),
        app.supabase.from('profiles').select('id, full_name, email').eq('id', deal.seller_id).single(),
      ]);
      const buyer = requireRow(buyerResult, 'El comprador ya no existe.');
      const seller = requireRow(sellerResult, 'El vendedor ya no existe.');

      const pdf = await generateNdaPdf({
        dealReference: deal.reference_code,
        assetTitle: asset.title,
        assetReference: asset.reference_code,
        buyerName: buyer.full_name ?? buyer.email,
        buyerEmail: buyer.email,
        sellerName: seller.full_name ?? seller.email,
        issuedAt: new Date(),
        durationMonths: NDA_DURATION_MONTHS,
        templateVersion: 'nda-v1-es-PE',
      });

      const draftPath = `ndas/${deal.reference_code}/nda-draft.pdf`;
      await uploadObject(app, SIGNED_BUCKET, draftPath, pdf, 'application/pdf');

      const envelope = await app.esign.createEnvelope({
        referenceId: deal.id,
        documentTitle: `NDA — ${asset.title} (${deal.reference_code})`,
        pdf,
        signers: [
          { name: buyer.full_name ?? buyer.email, email: buyer.email, role: 'buyer' },
        ],
        expiresInDays: 14,
        callbackUrl: `${app.config.PUBLIC_SITE_URL}/deal/${deal.id}`,
        metadata: { deal_id: deal.id, asset_id: asset.id },
      });

      const payload = {
        deal_id: deal.id,
        status: 'sent' as const,
        provider: envelope.provider,
        provider_envelope_id: envelope.envelopeId,
        template_version: 'nda-v1-es-PE',
        bucket: SIGNED_BUCKET,
        draft_path: draftPath,
        signer_name: buyer.full_name ?? buyer.email,
        signer_email: buyer.email,
        sent_at: new Date().toISOString(),
        expires_at: new Date(Date.now() + 14 * 86_400_000).toISOString(),
        provider_audit: envelope.raw,
      };

      const { data: nda, error } = existing
        ? await app.supabase.from('ndas').update(payload as never).eq('id', existing.id).select('*').single()
        : await app.supabase.from('ndas').insert(payload as never).select('*').single();

      if (error || !nda) throw badRequest('nda_failed', 'No se pudo emitir el NDA.');

      if (deal.stage !== 'nda_pending') {
        await app.supabase.from('deals').update({ stage: 'nda_pending' } as never).eq('id', deal.id);
      }

      await app.sendMail({
        to: buyer.email,
        userId: buyer.id,
        template: 'nda_pending',
        subject: '',
        data: { name: buyer.full_name ?? '', assetTitle: asset.title, dealId: deal.id },
      });

      await app.notify({
        userId: buyer.id,
        type: 'nda.pending',
        title: 'NDA pendiente de firma',
        body: `El acuerdo de confidencialidad de «${asset.title}» está listo.`,
        link: `/deal/${deal.id}#nda`,
        dealId: deal.id,
      });

      await app.audit(request, {
        action: 'nda.issued',
        entityType: 'nda',
        entityId: nda.id,
        dealId: deal.id,
        assetId: asset.id,
        metadata: { provider: envelope.provider, envelope: envelope.envelopeId },
      });

      return { nda, signingUrl: envelope.signingUrl ?? null };
    },
  );

  // ── Enlace de firma / previsualización del borrador ─────────────────────
  r.get(
    '/deals/:id/nda',
    {
      preHandler: app.requireAuth,
      schema: { params: z.object({ id: z.string().uuid() }) },
    },
    async (request) => {
      const profile = request.auth!.profile;
      const { deal } = await loadDealContext(app, request.params.id, profile);

      const { data: nda } = await app.supabase
        .from('ndas')
        .select('*')
        .eq('deal_id', deal.id)
        .maybeSingle();

      if (!nda) throw notFound('Este deal aún no tiene NDA emitido.');

      const path = nda.signed_path ?? nda.draft_path;
      const url = path
        ? await createSignedUrl(app, nda.bucket, path, app.config.SIGNED_URL_TTL)
        : null;

      await app.audit(request, {
        action: 'nda.viewed',
        entityType: 'nda',
        entityId: nda.id,
        dealId: deal.id,
      });

      return {
        nda: { ...nda, provider_audit: undefined },
        url,
        expiresIn: app.config.SIGNED_URL_TTL,
      };
    },
  );

  // ── Firma (en el proveedor real esto ocurre fuera; el mock lo cierra aquí) ──
  r.post(
    '/deals/:id/nda/sign',
    {
      preHandler: app.requireAuth,
      schema: { params: z.object({ id: z.string().uuid() }) },
    },
    async (request) => {
      const profile = request.auth!.profile;
      const { deal, side } = await loadDealContext(app, request.params.id, profile);

      if (side !== 'buyer') throw forbidden('El NDA lo firma el comprador.');

      const { data: nda } = await app.supabase
        .from('ndas')
        .select('*')
        .eq('deal_id', deal.id)
        .maybeSingle();

      if (!nda) throw notFound('No hay NDA emitido.');
      if (nda.status === 'signed') throw conflict('already_signed', 'El NDA ya está firmado.');
      if (!nda.provider_envelope_id) throw badRequest('no_envelope', 'El sobre de firma no existe.');

      const signed = await app.esign.downloadSigned(nda.provider_envelope_id);
      if (!signed) {
        throw badRequest(
          'not_signed_yet',
          'El proveedor aún no reporta la firma. Complete el proceso en el proveedor.',
        );
      }

      await finalizeNdaSignature(app, deal.id, nda.id, {
        pdf: signed.pdf,
        sha256: signed.sha256,
        signedAt: signed.signedAt,
        signerName: signed.signerName,
        signerEmail: signed.signerEmail,
        auditTrail: signed.auditTrail,
        signerIp: request.ip,
      });

      await app.audit(request, {
        action: 'nda.signed',
        entityType: 'nda',
        entityId: nda.id,
        dealId: deal.id,
        assetId: deal.asset_id,
        metadata: { sha256: signed.sha256, provider: app.esign.name },
      });

      return { ok: true, status: 'signed', sha256: signed.sha256 };
    },
  );

  // ── Webhook del proveedor de firma ──────────────────────────────────────
  app.post(
    '/webhooks/esign',
    {
      // El cuerpo crudo lo captura el content-type parser global de server.ts:
      // JSON.stringify(request.body) no reproduce los bytes originales y
      // rompería la verificación HMAC.
      config: { rateLimit: { max: 120, timeWindow: '1 minute' } },
    },
    async (request, reply) => {
      const signature =
        (request.headers['x-luxus-signature'] as string | undefined) ??
        (request.headers['x-signature'] as string | undefined);

      let event;
      try {
        event = app.esign.parseWebhook(
          request.rawBodyString ?? '',
          signature,
          app.config.ESIGN_WEBHOOK_SECRET,
        );
      } catch (err) {
        request.log.warn({ err }, 'Webhook de firma rechazado');
        return reply.code(400).send({ error: { code: 'invalid_signature', message: 'Firma no válida.' } });
      }

      // Idempotencia: el proveedor puede reintentar.
      const eventId = `${event.envelopeId}:${event.type}:${event.occurredAt}`;
      const { error: dupError } = await app.supabase.from('webhook_events').insert({
        provider: app.esign.name,
        event_id: eventId,
        event_type: event.type,
        payload: event.raw as never,
      } as never);

      if (dupError?.code === '23505') {
        return reply.code(200).send({ ok: true, duplicate: true });
      }

      const { data: nda } = await app.supabase
        .from('ndas')
        .select('*')
        .eq('provider_envelope_id', event.envelopeId)
        .maybeSingle();

      if (!nda) {
        request.log.warn({ envelope: event.envelopeId }, 'Webhook para un NDA desconocido');
        return reply.code(200).send({ ok: true, ignored: true });
      }

      if (event.type === 'viewed') {
        await app.supabase
          .from('ndas')
          .update({ status: 'viewed', viewed_at: event.occurredAt } as never)
          .eq('id', nda.id);
      }

      if (event.type === 'declined' || event.type === 'expired') {
        await app.supabase
          .from('ndas')
          .update({ status: event.type } as never)
          .eq('id', nda.id);
      }

      if (event.type === 'signed') {
        const signed = await app.esign.downloadSigned(event.envelopeId);
        if (signed) {
          await finalizeNdaSignature(app, nda.deal_id, nda.id, {
            pdf: signed.pdf,
            sha256: signed.sha256,
            signedAt: signed.signedAt,
            signerName: signed.signerName,
            signerEmail: signed.signerEmail,
            auditTrail: signed.auditTrail,
            signerIp: null,
          });

          await app.audit(null, {
            action: 'nda.signed',
            entityType: 'nda',
            entityId: nda.id,
            dealId: nda.deal_id,
            metadata: { via: 'webhook', sha256: signed.sha256 },
            actor: { email: event.signerEmail ?? nda.signer_email },
          });
        }
      }

      await app.supabase
        .from('webhook_events')
        .update({ processed_at: new Date().toISOString() } as never)
        .eq('provider', app.esign.name)
        .eq('event_id', eventId);

      return reply.code(200).send({ ok: true });
    },
  );
}

interface SignaturePayload {
  pdf: Uint8Array;
  sha256: string;
  signedAt: string;
  signerName: string;
  signerEmail: string;
  auditTrail: Record<string, unknown>;
  signerIp: string | null;
}

/**
 * Cierra el ciclo de firma: guarda el PDF firmado con su hash, marca el NDA y
 * abre el Deal Room. Es el único sitio donde un deal pasa a `nda_signed`.
 */
async function finalizeNdaSignature(
  app: FastifyInstance,
  dealId: string,
  ndaId: string,
  payload: SignaturePayload,
): Promise<void> {
  const deal = requireRow(
    await app.supabase
      .from('deals')
      .select('*, assets!deals_asset_id_fkey (title)')
      .eq('id', dealId)
      .single(),
    'El deal ya no existe.',
  );

  const signedPath = `ndas/${deal.reference_code}/nda-signed.pdf`;
  await uploadObject(app, SIGNED_BUCKET, signedPath, payload.pdf, 'application/pdf');

  // Se recalcula el hash sobre lo efectivamente almacenado, no sobre lo que
  // dijo el proveedor: es lo que se podrá cotejar más adelante.
  const storedHash = createHash('sha256').update(payload.pdf).digest('hex');

  await app.supabase
    .from('ndas')
    .update({
      status: 'signed',
      signed_path: signedPath,
      signed_sha256: storedHash,
      signer_name: payload.signerName || null,
      signer_email: payload.signerEmail || null,
      signer_ip: payload.signerIp,
      signed_at: payload.signedAt,
      provider_audit: payload.auditTrail as never,
    } as never)
    .eq('id', ndaId);

  await app.supabase
    .from('deals')
    .update({
      stage: 'nda_signed',
      nda_signed_at: payload.signedAt,
      opened_at: new Date().toISOString(),
    } as never)
    .eq('id', dealId);

  const assetTitle =
    embedded<{ title: string } | undefined>(
      (deal as unknown as Record<string, unknown>).assets,
    )?.title ??
    'el activo';

  for (const userId of [deal.buyer_id, deal.seller_id]) {
    const { data: user } = await app.supabase
      .from('profiles')
      .select('email, full_name')
      .eq('id', userId)
      .maybeSingle();

    if (user) {
      await app.sendMail({
        to: user.email,
        userId,
        template: 'nda_signed',
        subject: '',
        data: { assetTitle, signerName: payload.signerName, dealId },
      });
    }

    await app.notify({
      userId,
      type: 'nda.signed',
      title: 'NDA firmado — Deal Room abierto',
      body: `La documentación de «${assetTitle}» ya está disponible según los permisos concedidos.`,
      link: `/deal/${dealId}#documents`,
      dealId,
      severity: 'success',
    });
  }
}
