import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import {
  articleSchema, auditQuerySchema, formatComplaintReference, LISTING_FEE_BANDS, manageUserSchema,
  respondComplaintSchema, reviewAccessRequestSchema, slugify, verifyAssetSchema,
} from '@luxus/shared';
import { badRequest, notFound } from '../plugins/errors.js';
import { toCsv } from '../lib/csv.js';

export default async function adminRoutes(app: FastifyInstance): Promise<void> {
  const r = app.withTypeProvider<ZodTypeProvider>();
  const adminOnly = { preHandler: app.requireRole('admin') };

  // ══════════════════════════════════════════════════════════════════════
  // Solicitudes de Private Access
  // ══════════════════════════════════════════════════════════════════════
  r.get(
    '/admin/access-requests',
    {
      ...adminOnly,
      schema: {
        querystring: z.object({
          status: z.enum(['pending', 'approved', 'rejected']).default('pending'),
        }),
      },
    },
    async (request) => {
      const { data } = await app.supabase
        .from('private_access_requests')
        .select('*')
        .eq('status', request.query.status)
        .order('created_at', { ascending: false });
      return { requests: data ?? [] };
    },
  );

  r.post(
    '/admin/access-requests/review',
    { ...adminOnly, schema: { body: reviewAccessRequestSchema } },
    async (request) => {
      const { request_id, decision, role, review_notes } = request.body;

      const { data: accessRequest } = await app.supabase
        .from('private_access_requests')
        .select('*')
        .eq('id', request_id)
        .maybeSingle();

      if (!accessRequest) throw notFound('Solicitud no encontrada.');
      if (accessRequest.status !== 'pending') {
        throw badRequest('already_reviewed', 'Esta solicitud ya fue revisada.');
      }

      if (decision === 'reject') {
        await app.supabase
          .from('private_access_requests')
          .update({
            status: 'rejected',
            reviewed_by: request.auth!.userId,
            reviewed_at: new Date().toISOString(),
            review_notes: review_notes ?? null,
          } as never)
          .eq('id', request_id);

        await app.sendMail({
          to: accessRequest.email,
          template: 'private_access_rejected',
          subject: '',
          data: { name: accessRequest.full_name },
        });

        await app.audit(request, {
          action: 'access_request.rejected',
          entityType: 'private_access_request',
          entityId: request_id,
        });

        return { ok: true, status: 'rejected' };
      }

      // Aprobación: se emite invitación desde GoTrue. El registro abierto está
      // deshabilitado, así que esta es la única puerta de entrada.
      const { data: invited, error } = await app.supabase.auth.admin.inviteUserByEmail(
        accessRequest.email,
        {
          data: {
            full_name: accessRequest.full_name,
            role,
            phone: accessRequest.phone ?? undefined,
          },
          redirectTo: `${app.config.PUBLIC_SITE_URL}/auth/welcome`,
        },
      );

      if (error) {
        request.log.error({ err: error }, 'No se pudo emitir la invitación');
        throw badRequest('invite_failed', `No se pudo invitar: ${error.message}`);
      }

      await app.supabase
        .from('private_access_requests')
        .update({
          status: 'approved',
          reviewed_by: request.auth!.userId,
          reviewed_at: new Date().toISOString(),
          review_notes: review_notes ?? null,
          invited_at: new Date().toISOString(),
          invited_user_id: invited.user?.id ?? null,
        } as never)
        .eq('id', request_id);

      await app.sendMail({
        to: accessRequest.email,
        template: 'private_access_approved',
        subject: '',
        data: { name: accessRequest.full_name },
      });

      await app.audit(request, {
        action: 'access_request.approved',
        entityType: 'private_access_request',
        entityId: request_id,
        metadata: { role, invited_user: invited.user?.id },
      });

      return { ok: true, status: 'approved', user_id: invited.user?.id };
    },
  );

  // ══════════════════════════════════════════════════════════════════════
  // Libro de Reclamaciones
  // ══════════════════════════════════════════════════════════════════════
  r.get(
    '/admin/complaint-book',
    {
      ...adminOnly,
      schema: {
        querystring: z.object({
          status: z.enum(['received', 'in_review', 'responded', 'closed']).default('received'),
        }),
      },
    },
    async (request) => {
      const { data } = await app.supabase
        .from('complaint_entries')
        .select('*')
        .eq('status', request.query.status)
        .order('created_at', { ascending: false });
      return { entries: data ?? [] };
    },
  );

  r.post(
    '/admin/complaint-book/respond',
    { ...adminOnly, schema: { body: respondComplaintSchema } },
    async (request) => {
      const { entry_id, status, response_text } = request.body;

      const { data: entry } = await app.supabase
        .from('complaint_entries')
        .select('*')
        .eq('id', entry_id)
        .maybeSingle();

      if (!entry) throw notFound('Registro no encontrado.');

      if (status === 'responded' && !response_text) {
        throw badRequest('response_required', 'Escriba la respuesta antes de marcarlo como respondido.');
      }

      const patch: Record<string, unknown> = { status, updated_at: new Date().toISOString() };
      if (response_text) patch.response_text = response_text;
      if (status === 'responded') {
        patch.responded_by = request.auth!.userId;
        patch.responded_at = new Date().toISOString();
      }

      await app.supabase.from('complaint_entries').update(patch as never).eq('id', entry_id);

      if (status === 'responded' && response_text) {
        await app.sendMail({
          to: entry.email,
          template: 'complaint_responded',
          subject: '',
          data: {
            name: entry.full_name,
            kindLabel: entry.kind,
            reference: formatComplaintReference(entry.entry_number),
            responseText: response_text,
          },
        });
      }

      await app.audit(request, {
        action: 'complaint.status_changed',
        entityType: 'complaint_entry',
        entityId: entry_id,
        metadata: { status },
      });

      return { ok: true, status };
    },
  );

  // ══════════════════════════════════════════════════════════════════════
  // Cola de verificación de activos
  // ══════════════════════════════════════════════════════════════════════
  r.get('/admin/assets/queue', adminOnly, async () => {
    const { data } = await app.supabase
      .from('assets')
      .select(`
        *,
        profiles!assets_owner_id_fkey (id, full_name, email),
        brokers!assets_broker_id_fkey (company_name, is_verified),
        asset_verification_items (*)
      `)
      .in('status', ['pending_review', 'changes_requested'])
      .order('created_at', { ascending: true });

    return { assets: data ?? [] };
  });

  r.post(
    '/admin/assets/verify',
    { ...adminOnly, schema: { body: verifyAssetSchema } },
    async (request) => {
      const body = request.body;

      const { data: asset } = await app.supabase
        .from('assets')
        .select('*')
        .eq('id', body.asset_id)
        .maybeSingle();

      if (!asset) throw notFound('Activo no encontrado.');

      // Checklist peruano por categoría (SUNARP, SUNAT, DICAPI, DGAC…)
      for (const item of body.checklist) {
        await app.supabase
          .from('asset_verification_items')
          .update({
            status: item.status,
            notes: item.notes ?? null,
            checked_by: request.auth!.userId,
            checked_at: new Date().toISOString(),
          } as never)
          .eq('asset_id', body.asset_id)
          .eq('item_key', item.item_key);
      }

      const statusByDecision = {
        publish: 'published',
        request_changes: 'changes_requested',
        reject: 'rejected',
      } as const;

      const newStatus = statusByDecision[body.decision];

      await app.supabase
        .from('assets')
        .update({
          status: newStatus,
          ownership_verified: body.ownership_verified ?? asset.ownership_verified,
          registry_reviewed: body.registry_reviewed ?? asset.registry_reviewed,
          documentation_reviewed: body.documentation_reviewed ?? asset.documentation_reviewed,
          valuation_available: body.valuation_available ?? asset.valuation_available,
          verification_notes: body.reason ?? null,
          verified_at: body.decision === 'publish' ? new Date().toISOString() : null,
          verified_by: body.decision === 'publish' ? request.auth!.userId : null,
          published_at:
            body.decision === 'publish' ? (asset.published_at ?? new Date().toISOString()) : null,
        } as never)
        .eq('id', asset.id);

      // Al aprobar se cotiza el listing fee, que se cobra por separado.
      if (body.decision === 'publish') {
        const band = LISTING_FEE_BANDS[asset.tier];
        const amount = body.listing_fee_cents ?? band.minCents;

        const { data: existingFee } = await app.supabase
          .from('listing_fees')
          .select('id, status')
          .eq('asset_id', asset.id)
          .maybeSingle();

        if (!existingFee) {
          await app.supabase.from('listing_fees').insert({
            asset_id: asset.id,
            tier: asset.tier,
            amount_cents: amount,
            currency: 'USD',
            status: 'pending',
            quoted_by: request.auth!.userId,
            due_at: new Date(Date.now() + 15 * 86_400_000).toISOString(),
          } as never);
        }
      }

      const { data: owner } = await app.supabase
        .from('profiles')
        .select('id, email, full_name')
        .eq('id', asset.owner_id)
        .maybeSingle();

      if (owner) {
        await app.sendMail({
          to: owner.email,
          userId: owner.id,
          template: body.decision === 'publish' ? 'asset_published' : 'asset_changes_requested',
          subject: '',
          data: { assetTitle: asset.title, slug: asset.slug, reason: body.reason ?? '' },
        });

        await app.notify({
          userId: owner.id,
          type: `asset.${newStatus}`,
          title:
            body.decision === 'publish'
              ? 'Su activo fue publicado'
              : body.decision === 'request_changes'
                ? 'Cambios requeridos'
                : 'Publicación rechazada',
          body: body.reason ?? `«${asset.title}»`,
          link: '/dashboard/seller/assets',
          assetId: asset.id,
          severity: body.decision === 'publish' ? 'success' : 'warning',
        });
      }

      await app.audit(request, {
        action: `asset.${body.decision}`,
        entityType: 'asset',
        entityId: asset.id,
        assetId: asset.id,
        metadata: { checklist: body.checklist.length, reason: body.reason },
      });

      return { ok: true, status: newStatus };
    },
  );

  // ══════════════════════════════════════════════════════════════════════
  // Usuarios
  // ══════════════════════════════════════════════════════════════════════
  r.get(
    '/admin/users',
    {
      ...adminOnly,
      schema: {
        querystring: z.object({
          q: z.string().trim().max(120).optional(),
          role: z.enum(['buyer', 'seller', 'broker', 'admin']).optional(),
          kyc: z.string().optional(),
          page: z.coerce.number().int().min(1).default(1),
          pageSize: z.coerce.number().int().min(1).max(100).default(50),
        }),
      },
    },
    async (request) => {
      const { q, role, kyc, page, pageSize } = request.query;
      let query = app.supabase
        .from('profiles')
        .select('*', { count: 'exact' })
        .order('created_at', { ascending: false })
        .range((page - 1) * pageSize, page * pageSize - 1);

      if (q) query = query.or(`full_name.ilike.%${q}%,email.ilike.%${q}%`);
      if (role) query = query.eq('role', role);
      if (kyc) query = query.eq('kyc_status', kyc as never);

      const { data, count } = await query;
      return { users: data ?? [], total: count ?? 0, page, pageSize };
    },
  );

  r.patch(
    '/admin/users',
    { ...adminOnly, schema: { body: manageUserSchema } },
    async (request) => {
      const { user_id, ...changes } = request.body;

      if (user_id === request.auth!.userId && changes.role && changes.role !== 'admin') {
        throw badRequest('self_demote', 'No puede quitarse a sí mismo el rol de administrador.');
      }

      const { error } = await app.supabase
        .from('profiles')
        .update({
          ...changes,
          ...(changes.is_suspended === false ? { suspended_reason: null } : {}),
        } as never)
        .eq('id', user_id);

      if (error) throw badRequest('update_failed', 'No se pudo actualizar el usuario.');

      // Suspender implica cerrar sesiones abiertas: el acceso se corta ya.
      if (changes.is_suspended === true) {
        await app.supabase.auth.admin.signOut(user_id, 'global').catch(() => undefined);
        await app.supabase
          .from('user_sessions')
          .update({ revoked_at: new Date().toISOString() } as never)
          .eq('user_id', user_id)
          .is('revoked_at', null);
      }

      await app.audit(request, {
        action: 'user.updated',
        entityType: 'profile',
        entityId: user_id,
        metadata: changes,
      });

      return { ok: true };
    },
  );

  // ══════════════════════════════════════════════════════════════════════
  // Auditoría global (con exportación CSV)
  // ══════════════════════════════════════════════════════════════════════
  r.get(
    '/admin/audit',
    { ...adminOnly, schema: { querystring: auditQuerySchema } },
    async (request, reply) => {
      const q = request.query;
      let query = app.supabase
        .from('audit_logs')
        .select('*', { count: 'exact' })
        .order('created_at', { ascending: false })
        .range((q.page - 1) * q.pageSize, q.page * q.pageSize - 1);

      if (q.action) query = query.eq('action', q.action);
      if (q.actor_id) query = query.eq('actor_id', q.actor_id);
      if (q.deal_id) query = query.eq('deal_id', q.deal_id);
      if (q.asset_id) query = query.eq('asset_id', q.asset_id);
      if (q.document_id) query = query.eq('document_id', q.document_id);
      if (q.from) query = query.gte('created_at', q.from);
      if (q.to) query = query.lte('created_at', q.to);

      const { data, count } = await query;
      const rows = data ?? [];

      if (q.format === 'csv') {
        const csv = toCsv(
          rows.map((row) => ({
            fecha: row.created_at,
            accion: row.action,
            actor: row.actor_email,
            rol: row.actor_role,
            entidad: row.entity_type,
            entidad_id: row.entity_id,
            deal: row.deal_id,
            activo: row.asset_id,
            documento: row.document_id,
            version: row.document_version,
            ip: row.ip_address,
            user_agent: row.user_agent,
            metadata: row.metadata,
          })),
        );

        await app.audit(request, {
          action: 'audit.exported',
          metadata: { rows: rows.length, filters: q },
        });

        return reply
          .header('content-type', 'text/csv; charset=utf-8')
          .header(
            'content-disposition',
            `attachment; filename="luxus-audit-${new Date().toISOString().slice(0, 10)}.csv"`,
          )
          .send(csv);
      }

      return { entries: rows, total: count ?? 0, page: q.page, pageSize: q.pageSize };
    },
  );

  // ══════════════════════════════════════════════════════════════════════
  // Métricas
  // ══════════════════════════════════════════════════════════════════════
  r.get('/admin/metrics', adminOnly, async () => {
    const [
      publishedAssets, pendingAssets, verifiedUsers, totalUsers,
      pendingRequests, pendingKyc, deals, payments,
    ] = await Promise.all([
      app.supabase.from('assets').select('price_min, price_max', { count: 'exact' }).eq('status', 'published'),
      app.supabase.from('assets').select('id', { count: 'exact', head: true }).eq('status', 'pending_review'),
      app.supabase.from('profiles').select('id', { count: 'exact', head: true }).eq('kyc_status', 'approved'),
      app.supabase.from('profiles').select('id', { count: 'exact', head: true }),
      app.supabase.from('private_access_requests').select('id', { count: 'exact', head: true }).eq('status', 'pending'),
      app.supabase.from('kyc_cases').select('id', { count: 'exact', head: true }).in('status', ['submitted', 'in_review']),
      app.supabase.from('deals').select('stage'),
      app.supabase.from('payments').select('kind, amount_cents').eq('status', 'paid'),
    ]);

    // GMV listado: punto medio del rango público de cada activo publicado.
    const listedGmvUsd = (publishedAssets.data ?? []).reduce((sum, a) => {
      const min = a.price_min ?? 0;
      const max = a.price_max ?? min;
      return sum + (min && max ? (min + max) / 2 : 0);
    }, 0);

    const dealsByStage = Object.entries(
      (deals.data ?? []).reduce<Record<string, number>>((acc, d) => {
        acc[d.stage] = (acc[d.stage] ?? 0) + 1;
        return acc;
      }, {}),
    ).map(([stage, count]) => ({ stage, count }));

    const revenue = (payments.data ?? []).reduce(
      (acc, p) => {
        if (p.kind === 'listing_fee') acc.listingFeeRevenueCents += p.amount_cents;
        else acc.membershipRevenueCents += p.amount_cents;
        return acc;
      },
      { membershipRevenueCents: 0, brokerRevenueCents: 0, listingFeeRevenueCents: 0 },
    );

    return {
      listedGmvUsd,
      publishedAssets: publishedAssets.count ?? 0,
      pendingReviewAssets: pendingAssets.count ?? 0,
      verifiedUsers: verifiedUsers.count ?? 0,
      totalUsers: totalUsers.count ?? 0,
      pendingAccessRequests: pendingRequests.count ?? 0,
      pendingKycCases: pendingKyc.count ?? 0,
      dealsByStage,
      ...revenue,
    };
  });

  // ══════════════════════════════════════════════════════════════════════
  // CMS Intelligence
  // ══════════════════════════════════════════════════════════════════════
  r.get(
    '/admin/articles',
    {
      ...adminOnly,
      schema: { querystring: z.object({ status: z.string().optional() }) },
    },
    async (request) => {
      let query = app.supabase
        .from('articles')
        .select('*')
        .order('updated_at', { ascending: false });
      if (request.query.status) query = query.eq('status', request.query.status as never);
      const { data } = await query;
      return { articles: data ?? [] };
    },
  );

  r.post(
    '/admin/articles',
    { ...adminOnly, schema: { body: articleSchema } },
    async (request, reply) => {
      const body = request.body;
      const words = body.body_md.split(/\s+/).length;

      const { data, error } = await app.supabase
        .from('articles')
        .insert({
          ...body,
          slug: body.slug || slugify(body.title),
          reading_time: Math.max(1, Math.round(words / 220)),
          author_id: request.auth!.userId,
          author_name: request.auth!.profile.full_name,
          published_at: body.status === 'published' ? new Date().toISOString() : null,
        } as never)
        .select('*')
        .single();

      if (error) throw badRequest('article_failed', `No se pudo crear el artículo: ${error.message}`);

      await app.audit(request, {
        action: 'article.created',
        entityType: 'article',
        entityId: data.id,
        metadata: { status: body.status },
      });

      return reply.code(201).send({ article: data });
    },
  );

  r.patch(
    '/admin/articles/:id',
    {
      ...adminOnly,
      schema: {
        params: z.object({ id: z.string().uuid() }),
        body: articleSchema.partial(),
      },
    },
    async (request) => {
      const body = request.body;
      const patch: Record<string, unknown> = { ...body };

      if (body.body_md) {
        patch.reading_time = Math.max(1, Math.round(body.body_md.split(/\s+/).length / 220));
      }
      if (body.status === 'published') {
        const { data: current } = await app.supabase
          .from('articles')
          .select('published_at')
          .eq('id', request.params.id)
          .maybeSingle();
        patch.published_at = current?.published_at ?? new Date().toISOString();
      }

      const { data, error } = await app.supabase
        .from('articles')
        .update(patch as never)
        .eq('id', request.params.id)
        .select('*')
        .single();

      if (error) throw badRequest('article_update_failed', error.message);

      await app.audit(request, {
        action: 'article.updated',
        entityType: 'article',
        entityId: request.params.id,
        metadata: { status: body.status },
      });

      return { article: data };
    },
  );

  r.delete(
    '/admin/articles/:id',
    { ...adminOnly, schema: { params: z.object({ id: z.string().uuid() }) } },
    async (request) => {
      await app.supabase
        .from('articles')
        .update({ status: 'archived' } as never)
        .eq('id', request.params.id);

      await app.audit(request, {
        action: 'article.archived',
        entityType: 'article',
        entityId: request.params.id,
      });

      return { ok: true };
    },
  );
}
