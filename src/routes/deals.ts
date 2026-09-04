import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import {
  FOLDER_META, canTransition, closingChecklistSchema, dealDecisionSchema,
  DOCUMENT_FOLDERS, isDealRoomOpen, requestDealAccessSchema,
} from '@luxus/shared';
import type { DocumentFolder, DocumentVersionRow, FolderNode } from '@luxus/shared';
import { badRequest, conflict, forbidden, notFound } from '../plugins/errors.js';
import { assertVerifiedMember, loadDealContext } from '../lib/guards.js';
import { embedded, requireRow } from '../lib/db.js';

export default async function dealRoutes(app: FastifyInstance): Promise<void> {
  const r = app.withTypeProvider<ZodTypeProvider>();

  // ── Solicitud de acceso (comprador) ─────────────────────────────────────
  r.post(
    '/deals',
    {
      preHandler: app.requireAuth,
      config: { rateLimit: { max: 10, timeWindow: '1 hour' } },
      schema: { body: requestDealAccessSchema },
    },
    async (request, reply) => {
      const profile = request.auth!.profile;

      const { data: asset } = await app.supabase
        .from('assets')
        .select('id, title, slug, owner_id, broker_id, status, visibility')
        .eq('id', request.body.asset_id)
        .maybeSingle();

      if (!asset || asset.status !== 'published') {
        throw notFound('El activo no está disponible.');
      }
      if (asset.owner_id === profile.id) {
        throw badRequest('own_asset', 'No puede solicitar acceso a su propio activo.');
      }

      // Los activos off-market solo son solicitables por miembros verificados.
      if (asset.visibility === 'off_market') assertVerifiedMember(profile);

      const { data: existing } = await app.supabase
        .from('deals')
        .select('id, stage')
        .eq('asset_id', asset.id)
        .eq('buyer_id', profile.id)
        .maybeSingle();

      if (existing) {
        throw conflict('deal_exists', 'Ya existe una solicitud para este activo.');
      }

      // El KYC decide si la solicitud llega al vendedor o se queda en cola.
      const kycCleared = profile.kyc_status === 'approved' && profile.screening_status !== 'blocked';
      const stage = kycCleared ? 'seller_review' : 'kyc_review';

      const { data: deal, error } = await app.supabase
        .from('deals')
        .insert({
          asset_id: asset.id,
          buyer_id: profile.id,
          seller_id: asset.owner_id,
          broker_id: asset.broker_id,
          stage,
          request_message: request.body.request_message,
          intended_use: request.body.intended_use ?? null,
          financing_type: request.body.financing_type,
          proof_of_funds: request.body.proof_of_funds,
          kyc_cleared_at: kycCleared ? new Date().toISOString() : null,
        } as never)
        .select('*')
        .single();

      if (error || !deal) {
        request.log.error({ err: error }, 'No se pudo crear el deal');
        throw badRequest('deal_create_failed', 'No pudimos registrar su solicitud.');
      }

      if (kycCleared) {
        const { data: seller } = await app.supabase
          .from('profiles')
          .select('email, full_name')
          .eq('id', asset.owner_id)
          .maybeSingle();

        if (seller) {
          await app.sendMail({
            to: seller.email,
            userId: asset.owner_id,
            template: 'deal_access_requested',
            subject: '',
            data: {
              assetTitle: asset.title,
              buyerName: profile.full_name ?? profile.email,
              kycStatus: 'aprobada',
              message: request.body.request_message,
            },
          });
        }

        await app.notify({
          userId: asset.owner_id,
          type: 'deal.access_requested',
          title: 'Nueva solicitud de Deal Room',
          body: `${profile.full_name ?? profile.email} solicitó acceso a «${asset.title}».`,
          link: '/dashboard/seller/requests',
          dealId: deal.id,
          assetId: asset.id,
        });
      }

      await app.audit(request, {
        action: 'deal.access_requested',
        entityType: 'deal',
        entityId: deal.id,
        dealId: deal.id,
        assetId: asset.id,
        metadata: { stage },
      });

      return reply.code(201).send({ deal_id: deal.id, stage, reference: deal.reference_code });
    },
  );

  // ── Bandeja del vendedor ────────────────────────────────────────────────
  r.get('/deals/inbox', { preHandler: app.requireAuth }, async (request) => {
    const profile = request.auth!.profile;

    const { data } = await app.supabase
      .from('deals')
      .select(`
        *,
        assets!deals_asset_id_fkey (id, title, slug, category, reference_code),
        buyer:profiles!deals_buyer_id_fkey (id, full_name, email, kyc_status, screening_status, membership_tier)
      `)
      .eq('seller_id', profile.id)
      .order('requested_at', { ascending: false });

    return { deals: data ?? [] };
  });

  // ── Deals del comprador ─────────────────────────────────────────────────
  r.get('/deals/mine', { preHandler: app.requireAuth }, async (request) => {
    const { data } = await app.supabase
      .from('deals')
      .select(`
        *,
        assets!deals_asset_id_fkey (id, title, slug, category, district, region, reference_code),
        ndas (id, status, signed_at)
      `)
      .eq('buyer_id', request.auth!.userId)
      .order('requested_at', { ascending: false });

    return { deals: data ?? [] };
  });

  // ── Detalle completo del Deal Room ──────────────────────────────────────
  r.get(
    '/deals/:id',
    {
      preHandler: app.requireAuth,
      schema: { params: z.object({ id: z.string().uuid() }) },
    },
    async (request) => {
      const profile = request.auth!.profile;
      const { deal, asset, side } = await loadDealContext(app, request.params.id, profile);

      const [buyerRes, sellerRes, ndaRes, offersRes, threadsRes, historyRes] = await Promise.all([
        app.supabase.from('profiles').select('id, full_name, email, role, kyc_status').eq('id', deal.buyer_id).single(),
        app.supabase.from('profiles').select('id, full_name, email, role, kyc_status').eq('id', deal.seller_id).single(),
        app.supabase.from('ndas').select('*').eq('deal_id', deal.id).maybeSingle(),
        app.supabase.from('offers').select('*').eq('deal_id', deal.id).order('created_at', { ascending: false }),
        app.supabase
          .from('qa_threads')
          .select('*, qa_messages (id, author_id, body, created_at, attachment_document_id)')
          .eq('deal_id', deal.id)
          .order('last_message_at', { ascending: false }),
        app.supabase.from('deal_stage_history').select('*').eq('deal_id', deal.id).order('created_at'),
      ]);

      const roomOpen = isDealRoomOpen(deal.stage) &&
        (!deal.expires_at || new Date(deal.expires_at) > new Date());

      // ── Árbol documental ──────────────────────────────────────────────
      // `documents` tiene dos FK hacia `document_versions` (todas sus
      // versiones vía document_id, y la versión vigente vía
      // current_version_id), así que un embed sin desambiguar es
      // ambiguo para PostgREST: falla con PGRST201 y, como aquí solo se
      // desestructura `data` (no `error`), el fallo quedaba en silencio y
      // el árbol documental se veía vacío en TODO Deal Room, con
      // cualquier activo. El sufijo `!document_versions_document_id_fkey`
      // fija cuál de las dos usar: todas las versiones del documento.
      const { data: documents, error: documentsError } = await app.supabase
        .from('documents')
        .select('*, document_versions!document_versions_document_id_fkey (*)')
        .eq('asset_id', deal.asset_id)
        .is('deleted_at', null)
        .order('folder')
        .order('name');

      if (documentsError) {
        request.log.error({ err: documentsError, dealId: deal.id }, 'No se pudo leer el árbol documental');
      }

      const { data: permissions } = await app.supabase
        .from('document_permissions')
        .select('*')
        .eq('deal_id', deal.id);

      const permissionByDoc = new Map(
        (permissions ?? []).map((p) => [p.document_id, p] as const),
      );

      const isSellerSide = side === 'seller' || side === 'broker' || side === 'admin';

      const tree: FolderNode[] = DOCUMENT_FOLDERS.map((folder: DocumentFolder) => {
        const folderDocs = (documents ?? []).filter((d) => d.folder === folder);

        const nodes = folderDocs
          .map((doc) => {
            const versions = [
              ...(embedded<DocumentVersionRow[] | undefined>(
                (doc as Record<string, unknown>).document_versions,
              ) ?? []),
            ];
            versions.sort((a, b) => b.version - a.version);

            const permission = permissionByDoc.get(doc.id) ?? null;
            const notExpired =
              !permission?.expires_at || new Date(permission.expires_at) > new Date();
            const active = Boolean(permission && !permission.revoked_at && notExpired);

            const canView = isSellerSide || (roomOpen && active);
            const canDownload = isSellerSide || (roomOpen && active && permission!.level === 'download');

            return {
              document: { ...doc, document_versions: undefined },
              currentVersion: versions[0] ?? null,
              // El comprador solo ve el historial si tiene permiso vigente.
              versions: canView ? versions : [],
              permission: isSellerSide ? permission : permission && { ...permission, granted_by: '' },
              canView,
              canDownload,
              expiresAt: permission?.expires_at ?? null,
            };
          })
          // Un comprador no debe deducir siquiera qué documentos existen sin permiso.
          .filter((node) => isSellerSide || node.canView);

        return {
          folder,
          label: FOLDER_META[folder].label,
          description: FOLDER_META[folder].description,
          documents: nodes as unknown as FolderNode['documents'],
          accessibleCount: nodes.filter((n) => n.canView).length,
          totalCount: isSellerSide ? folderDocs.length : nodes.length,
        };
      });

      return {
        deal,
        asset,
        side,
        roomOpen,
        buyer: buyerRes.data,
        seller: sellerRes.data,
        nda: ndaRes.data,
        offers: offersRes.data ?? [],
        threads: threadsRes.data ?? [],
        history: historyRes.data ?? [],
        tree,
        ...(isSellerSide ? { permissions: permissions ?? [] } : {}),
      };
    },
  );

  // ── Decisión del vendedor ───────────────────────────────────────────────
  r.post(
    '/deals/decision',
    {
      preHandler: app.requireAuth,
      schema: { body: dealDecisionSchema },
    },
    async (request) => {
      const profile = request.auth!.profile;
      const { deal, asset, side } = await loadDealContext(app, request.body.deal_id, profile);

      if (side === 'buyer') throw forbidden('Solo el vendedor decide sobre la solicitud.');
      if (!['requested', 'kyc_review', 'seller_review'].includes(deal.stage)) {
        throw conflict('invalid_stage', 'Esta solicitud ya fue resuelta.');
      }

      const buyer = requireRow(
        await app.supabase
          .from('profiles')
          .select('id, email, full_name, kyc_status, screening_status')
          .eq('id', deal.buyer_id)
          .single(),
        'El comprador ya no existe.',
      );

      if (request.body.decision === 'decline') {
        await app.supabase
          .from('deals')
          .update({
            stage: 'declined',
            decline_reason: request.body.decline_reason,
            declined_by: profile.id,
          } as never)
          .eq('id', deal.id);

        await app.sendMail({
          to: buyer.email,
          userId: buyer.id,
          template: 'deal_access_declined',
          subject: '',
          data: {
            name: buyer.full_name ?? '',
            assetTitle: asset.title,
            reason: request.body.decline_reason ?? '',
          },
        });

        await app.notify({
          userId: buyer.id,
          type: 'deal.declined',
          title: 'Solicitud no concedida',
          body: `El vendedor no concedió el acceso a «${asset.title}».`,
          link: '/dashboard',
          dealId: deal.id,
          severity: 'warning',
        });

        await app.audit(request, {
          action: 'deal.declined',
          entityType: 'deal',
          entityId: deal.id,
          dealId: deal.id,
          assetId: asset.id,
          metadata: { reason: request.body.decline_reason },
        });

        return { ok: true, stage: 'declined' };
      }

      // Aprobar exige KYC del comprador: el vendedor no puede saltárselo.
      if (buyer.kyc_status !== 'approved' || buyer.screening_status === 'blocked') {
        throw badRequest(
          'buyer_not_verified',
          'El comprador aún no ha superado la verificación. La solicitud queda en cola.',
        );
      }

      const expiresAt =
        request.body.access_days > 0
          ? new Date(Date.now() + request.body.access_days * 86_400_000).toISOString()
          : null;

      await app.supabase
        .from('deals')
        .update({
          stage: 'nda_pending',
          approved_at: new Date().toISOString(),
          approved_by: profile.id,
          kyc_cleared_at: deal.kyc_cleared_at ?? new Date().toISOString(),
          expires_at: expiresAt,
        } as never)
        .eq('id', deal.id);

      await app.sendMail({
        to: buyer.email,
        userId: buyer.id,
        template: 'deal_access_approved',
        subject: '',
        data: { name: buyer.full_name ?? '', assetTitle: asset.title, dealId: deal.id },
      });

      await app.notify({
        userId: buyer.id,
        type: 'deal.approved',
        title: 'Acceso concedido',
        body: `El siguiente paso es firmar el NDA de «${asset.title}».`,
        link: `/deal/${deal.id}`,
        dealId: deal.id,
        severity: 'success',
      });

      await app.audit(request, {
        action: 'deal.approved',
        entityType: 'deal',
        entityId: deal.id,
        dealId: deal.id,
        assetId: asset.id,
        metadata: { access_days: request.body.access_days },
      });

      return { ok: true, stage: 'nda_pending', expires_at: expiresAt };
    },
  );

  // ── Avance manual de etapa ──────────────────────────────────────────────
  r.post(
    '/deals/:id/stage',
    {
      preHandler: app.requireAuth,
      schema: {
        params: z.object({ id: z.string().uuid() }),
        body: z.object({
          to_stage: z.enum([
            'qa', 'offer', 'loi', 'due_diligence', 'closing', 'closed', 'withdrawn',
          ]),
          reason: z.string().trim().max(500).optional(),
        }),
      },
    },
    async (request) => {
      const profile = request.auth!.profile;
      const { deal, asset, side } = await loadDealContext(app, request.params.id, profile);
      const to = request.body.to_stage;

      if (!canTransition(deal.stage, to)) {
        throw conflict(
          'invalid_transition',
          `No se puede pasar de «${deal.stage}» a «${to}».`,
        );
      }
      if (to === 'withdrawn' && side !== 'buyer' && side !== 'admin') {
        throw forbidden('Solo el comprador puede retirar su solicitud.');
      }
      if (to === 'closed' && side === 'buyer') {
        throw forbidden('El cierre lo confirma el vendedor.');
      }

      await app.supabase
        .from('deals')
        .update({
          stage: to,
          ...(to === 'closed' ? { closed_at: new Date().toISOString() } : {}),
        } as never)
        .eq('id', deal.id);

      const counterpartId = side === 'buyer' ? deal.seller_id : deal.buyer_id;
      await app.notify({
        userId: counterpartId,
        type: 'deal.stage_changed',
        title: 'El Deal Room cambió de etapa',
        body: `«${asset.title}» pasó a la etapa ${to}.`,
        link: `/deal/${deal.id}`,
        dealId: deal.id,
      });

      await app.audit(request, {
        action: 'deal.stage_changed',
        entityType: 'deal',
        entityId: deal.id,
        dealId: deal.id,
        assetId: asset.id,
        metadata: { from: deal.stage, to, reason: request.body.reason },
      });

      return { ok: true, stage: to };
    },
  );

  // ── Checklist de cierre ─────────────────────────────────────────────────
  r.post(
    '/deals/closing',
    {
      preHandler: app.requireAuth,
      schema: { body: closingChecklistSchema },
    },
    async (request) => {
      const profile = request.auth!.profile;
      const { deal, asset, side } = await loadDealContext(app, request.body.deal_id, profile);

      if (side === 'buyer') {
        throw forbidden('El checklist de cierre lo mantiene el vendedor.');
      }

      const successFeeAmount =
        request.body.final_amount && request.body.success_fee_pct
          ? Number(((request.body.final_amount * request.body.success_fee_pct) / 100).toFixed(2))
          : null;

      await app.supabase
        .from('deals')
        .update({
          closing_checklist: request.body.items,
          closing_notes: request.body.closing_notes ?? null,
          final_amount: request.body.final_amount ?? null,
          success_fee_pct: request.body.success_fee_pct ?? null,
          // Registro para facturación manual: la plataforma no cobra el fee.
          success_fee_amount: successFeeAmount,
        } as never)
        .eq('id', deal.id);

      await app.audit(request, {
        action: 'deal.closing_updated',
        entityType: 'deal',
        entityId: deal.id,
        dealId: deal.id,
        assetId: asset.id,
        metadata: { items: request.body.items.length },
      });

      return { ok: true, success_fee_amount: successFeeAmount };
    },
  );
}
