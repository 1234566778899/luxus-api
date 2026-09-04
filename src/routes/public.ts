import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { complaintSchema, enquirySchema, formatComplaintReference, privateAccessSchema } from '@luxus/shared';
import { badRequest, notFound } from '../plugins/errors.js';

/**
 * Superficie pública de la API. Todo lo de aquí es anónimo, por lo que va con
 * límites de tasa estrictos, honeypot y validación de esquema.
 *
 * El catálogo público NO pasa por aquí: Astro lo lee directamente de Supabase,
 * donde RLS ya garantiza que un anónimo solo alcanza el Nivel I.
 */
export default async function publicRoutes(app: FastifyInstance): Promise<void> {
  const r = app.withTypeProvider<ZodTypeProvider>();

  // ── Solicitud de Private Access ─────────────────────────────────────────
  r.post(
    '/private-access',
    {
      config: { rateLimit: { max: 5, timeWindow: '10 minutes' } },
      schema: {
        body: privateAccessSchema,
        response: {
          201: z.object({ ok: z.literal(true), reference: z.string() }),
        },
      },
    },
    async (request, reply) => {
      const body = request.body;

      // Honeypot: los bots rellenan todos los campos. Se responde 201 para no
      // darles señal, pero no se registra nada.
      if (body.website) {
        request.log.warn({ email: body.email }, 'Solicitud descartada por honeypot');
        return reply.code(201).send({ ok: true as const, reference: 'discarded' });
      }

      const { data, error } = await app.supabase
        .from('private_access_requests')
        .insert({
          applicant_profile: body.applicant_profile,
          full_name: body.full_name,
          email: body.email,
          phone: body.phone ?? null,
          company: body.company ?? null,
          country: body.country,
          city: body.city ?? null,
          interest: body.interest ?? null,
          budget_range: body.budget_range ?? null,
          message: body.message ?? null,
          source: 'website',
          ip_address: request.ip,
          user_agent: request.headers['user-agent'] ?? null,
        } as never)
        .select('id')
        .single();

      if (error) {
        request.log.error({ err: error }, 'No se pudo registrar la solicitud de acceso');
        throw badRequest('request_failed', 'No pudimos registrar su solicitud. Inténtelo de nuevo.');
      }

      // Alta paralela en el CRM para que el equipo la trabaje como lead.
      await app.supabase.from('leads').insert({
        kind: body.applicant_profile === 'seller' ? 'seller_pipeline' : 'buyer_enquiry',
        stage: 'contacted',
        name: body.full_name,
        email: body.email,
        phone: body.phone ?? null,
        company: body.company ?? null,
        source: 'private-access',
        message: body.message ?? null,
      } as never);

      await app.audit(request, {
        action: 'private_access.requested',
        entityType: 'private_access_request',
        entityId: data.id,
        metadata: { profile: body.applicant_profile },
      });

      return reply.code(201).send({ ok: true as const, reference: data.id });
    },
  );

  // ── Consulta privada sobre un activo ────────────────────────────────────
  r.post(
    '/enquiries',
    {
      config: { rateLimit: { max: 8, timeWindow: '10 minutes' } },
      schema: {
        body: enquirySchema,
        response: { 201: z.object({ ok: z.literal(true) }) },
      },
    },
    async (request, reply) => {
      const body = request.body;
      if (body.website) return reply.code(201).send({ ok: true as const });

      const { data: asset } = await app.supabase
        .from('assets')
        .select('id, title, slug, owner_id, category, status')
        .eq('id', body.asset_id)
        .eq('status', 'published')
        .maybeSingle();

      if (!asset) throw notFound('El activo no está disponible.');

      await app.supabase.from('leads').insert({
        kind: 'buyer_enquiry',
        stage: 'contacted',
        name: body.name,
        email: body.email,
        phone: body.phone ?? null,
        company: body.company ?? null,
        category: asset.category,
        asset_id: asset.id,
        source: 'enquire-privately',
        message: body.message,
      } as never);

      await app.supabase.rpc('increment_asset_enquiries' as never, {
        p_asset_id: asset.id,
      } as never);

      // Aviso al vendedor y al equipo.
      await app.notify({
        userId: asset.owner_id,
        type: 'enquiry.received',
        title: 'Nueva consulta privada',
        body: `${body.name} preguntó por «${asset.title}».`,
        link: '/dashboard/seller/enquiries',
        assetId: asset.id,
      });

      await app.audit(request, {
        action: 'enquiry.submitted',
        entityType: 'asset',
        entityId: asset.id,
        assetId: asset.id,
        metadata: { email: body.email },
      });

      return reply.code(201).send({ ok: true as const });
    },
  );

  // ── Libro de Reclamaciones ───────────────────────────────────────────────
  r.post(
    '/complaint-book',
    {
      config: { rateLimit: { max: 5, timeWindow: '10 minutes' } },
      schema: {
        body: complaintSchema,
        response: {
          201: z.object({ ok: z.literal(true), reference: z.string() }),
        },
      },
    },
    async (request, reply) => {
      const body = request.body;

      if (body.website) {
        request.log.warn({ email: body.email }, 'Reclamo descartado por honeypot');
        return reply.code(201).send({ ok: true as const, reference: 'discarded' });
      }

      const { data, error } = await app.supabase
        .from('complaint_entries')
        .insert({
          kind: body.kind,
          full_name: body.full_name,
          document_type: body.document_type,
          document_number: body.document_number,
          email: body.email,
          phone: body.phone ?? null,
          address: body.address ?? null,
          is_minor: body.is_minor,
          guardian_name: body.guardian_name ?? null,
          product_or_service: body.product_or_service,
          asset_id: body.asset_id ?? null,
          amount: body.amount ?? null,
          detail: body.detail,
          requested_action: body.requested_action ?? null,
          source: 'website',
          ip_address: request.ip,
          user_agent: request.headers['user-agent'] ?? null,
        } as never)
        .select('id, entry_number')
        .single();

      if (error) {
        request.log.error({ err: error }, 'No se pudo registrar el reclamo');
        throw badRequest('request_failed', 'No pudimos registrar su reclamo. Inténtelo de nuevo.');
      }

      const reference = formatComplaintReference(data.entry_number);

      await app.sendMail({
        to: body.email,
        template: 'complaint_received',
        subject: '',
        data: { name: body.full_name, kindLabel: body.kind, reference, detail: body.detail },
      });

      await app.audit(request, {
        action: 'complaint.submitted',
        entityType: 'complaint_entry',
        entityId: data.id,
        metadata: { kind: body.kind, reference },
      });

      return reply.code(201).send({ ok: true as const, reference });
    },
  );

  // ── Beacon de vistas (estadísticas del vendedor) ────────────────────────
  r.post(
    '/assets/:id/view',
    {
      config: { rateLimit: { max: 60, timeWindow: '1 minute' } },
      schema: {
        params: z.object({ id: z.string().uuid() }),
        response: { 204: z.null() },
      },
    },
    async (request, reply) => {
      await app.supabase.from('asset_views').insert({
        asset_id: request.params.id,
        viewer_id: request.auth?.userId ?? null,
        is_member: Boolean(request.auth),
        referrer: request.headers.referer ?? null,
      } as never);

      await app.supabase.rpc('increment_asset_views' as never, {
        p_asset_id: request.params.id,
      } as never);

      return reply.code(204).send(null);
    },
  );

  // ── Catálogo de planes (para la página de membresías) ───────────────────
  r.get('/plans', async () => {
    const { data } = await app.supabase
      .from('plans')
      .select('code, kind, name, tagline, amount_cents, currency, interval, listing_quota, benefits, sort_order')
      .eq('is_active', true)
      .order('sort_order');
    return { plans: data ?? [] };
  });
}
