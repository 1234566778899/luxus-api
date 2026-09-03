import { createHash, randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import {
  createDocumentSchema, documentAccessSchema, grantPermissionSchema,
  isDealRoomOpen, restoreVersionSchema, revokePermissionSchema, uploadVersionSchema,
} from '@luxus/shared';
import { badRequest, forbidden, notFound } from '../plugins/errors.js';
import { assertControlsAsset, loadDealContext, loadDocument } from '../lib/guards.js';
import { createSignedUrl, downloadObject, uploadObject } from '../lib/storage.js';
import { embedded } from '../lib/db.js';
import { isPdf, watermarkPdf } from '../services/pdf/watermark.js';

const DEAL_BUCKET = 'deal-documents';
/** Carpeta de entregas efímeras: copias marcadas al agua, con URL de 5 min. */
const DELIVERY_PREFIX = '_delivery';

export default async function documentRoutes(app: FastifyInstance): Promise<void> {
  const r = app.withTypeProvider<ZodTypeProvider>();

  // ── Alta de documento (vendedor) ────────────────────────────────────────
  r.post(
    '/documents',
    { preHandler: app.requireAuth, schema: { body: createDocumentSchema } },
    async (request, reply) => {
      const profile = request.auth!.profile;
      await assertControlsAsset(app, request.body.asset_id, profile);

      const { data, error } = await app.supabase
        .from('documents')
        .insert({
          asset_id: request.body.asset_id,
          folder: request.body.folder,
          subfolder: request.body.subfolder ?? null,
          name: request.body.name,
          description: request.body.description ?? null,
          verification_key: request.body.verification_key ?? null,
          created_by: profile.id,
        } as never)
        .select('*')
        .single();

      if (error || !data) throw badRequest('document_create_failed', 'No se pudo crear el documento.');

      await app.audit(request, {
        action: 'document.created',
        entityType: 'document',
        entityId: data.id,
        assetId: request.body.asset_id,
        documentId: data.id,
        metadata: { folder: request.body.folder, name: request.body.name },
      });

      return reply.code(201).send({ document: data });
    },
  );

  // ── URL firmada de subida ───────────────────────────────────────────────
  r.post(
    '/documents/upload-url',
    {
      preHandler: app.requireAuth,
      schema: {
        body: z.object({
          asset_id: z.string().uuid(),
          document_id: z.string().uuid(),
          file_name: z.string().trim().min(1).max(255),
        }),
      },
    },
    async (request) => {
      await assertControlsAsset(app, request.body.asset_id, request.auth!.profile);

      const ext = request.body.file_name.split('.').pop()?.toLowerCase().slice(0, 8) ?? 'pdf';
      const path = `assets/${request.body.asset_id}/${request.body.document_id}/${randomUUID()}.${ext}`;

      const { data, error } = await app.supabase.storage
        .from(DEAL_BUCKET)
        .createSignedUploadUrl(path);

      if (error || !data) throw badRequest('upload_url_failed', 'No se pudo preparar la carga.');
      return { bucket: DEAL_BUCKET, path, token: data.token, signedUrl: data.signedUrl };
    },
  );

  // ── Nueva versión ───────────────────────────────────────────────────────
  r.post(
    '/documents/versions',
    { preHandler: app.requireAuth, schema: { body: uploadVersionSchema } },
    async (request, reply) => {
      const profile = request.auth!.profile;
      const document = await loadDocument(app, request.body.document_id);
      await assertControlsAsset(app, document.asset_id, profile);

      // Hash del contenido: sirve para detectar recargas idénticas y para el
      // registro de integridad que se muestra en el historial.
      let sha256 = request.body.sha256 ?? null;
      if (!sha256) {
        const bytes = await downloadObject(app, DEAL_BUCKET, request.body.storage_path);
        if (bytes) sha256 = createHash('sha256').update(bytes).digest('hex');
      }

      const { data, error } = await app.supabase
        .from('document_versions')
        .insert({
          document_id: document.id,
          bucket: DEAL_BUCKET,
          storage_path: request.body.storage_path,
          file_name: request.body.file_name,
          mime_type: request.body.mime_type,
          size_bytes: request.body.size_bytes ?? null,
          sha256,
          change_note: request.body.change_note ?? null,
          uploaded_by: profile.id,
        } as never)
        .select('*')
        .single();

      if (error || !data) {
        request.log.error({ err: error }, 'No se pudo registrar la versión');
        throw badRequest('version_failed', 'No se pudo registrar la nueva versión.');
      }

      await app.audit(request, {
        action: 'document.version_uploaded',
        entityType: 'document',
        entityId: document.id,
        assetId: document.asset_id,
        documentId: document.id,
        documentVersion: data.version,
        metadata: { change_note: request.body.change_note, sha256 },
      });

      // Avisar a quienes tienen permiso vigente de que hay versión nueva.
      const { data: perms } = await app.supabase
        .from('document_permissions')
        .select('user_id, deal_id')
        .eq('document_id', document.id)
        .is('revoked_at', null);

      for (const perm of perms ?? []) {
        await app.notify({
          userId: perm.user_id,
          type: 'document.new_version',
          title: 'Documento actualizado',
          body: `«${document.name}» tiene una nueva versión (v${data.version}).`,
          link: `/deal/${perm.deal_id}#documents`,
          dealId: perm.deal_id,
        });
      }

      return reply.code(201).send({ version: data });
    },
  );

  // ── Historial y restauración ────────────────────────────────────────────
  r.get(
    '/documents/:id/versions',
    {
      preHandler: app.requireAuth,
      schema: { params: z.object({ id: z.string().uuid() }) },
    },
    async (request) => {
      const document = await loadDocument(app, request.params.id);
      const profile = request.auth!.profile;

      // Un comprador ve el historial solo si tiene permiso vigente.
      let allowed = false;
      try {
        await assertControlsAsset(app, document.asset_id, profile);
        allowed = true;
      } catch {
        const { data: perm } = await app.supabase
          .from('document_permissions')
          .select('id, revoked_at, expires_at')
          .eq('document_id', document.id)
          .eq('user_id', profile.id)
          .is('revoked_at', null)
          .maybeSingle();
        allowed = Boolean(perm && (!perm.expires_at || new Date(perm.expires_at) > new Date()));
      }

      if (!allowed) throw forbidden('No tiene acceso a este documento.');

      const { data } = await app.supabase
        .from('document_versions')
        .select('*, profiles!document_versions_uploaded_by_fkey (full_name, email)')
        .eq('document_id', document.id)
        .order('version', { ascending: false });

      return { versions: data ?? [], currentVersionId: document.current_version_id };
    },
  );

  r.post(
    '/documents/restore',
    { preHandler: app.requireAuth, schema: { body: restoreVersionSchema } },
    async (request) => {
      const profile = request.auth!.profile;
      const document = await loadDocument(app, request.body.document_id);
      await assertControlsAsset(app, document.asset_id, profile);

      const { data: target } = await app.supabase
        .from('document_versions')
        .select('*')
        .eq('document_id', document.id)
        .eq('version', request.body.version)
        .maybeSingle();

      if (!target) throw notFound('La versión indicada no existe.');

      // Restaurar no borra historial: crea una versión nueva que apunta al
      // mismo objeto. El árbol de versiones queda íntegro y auditable.
      const { data: restored, error } = await app.supabase
        .from('document_versions')
        .insert({
          document_id: document.id,
          bucket: target.bucket,
          storage_path: target.storage_path,
          file_name: target.file_name,
          mime_type: target.mime_type,
          size_bytes: target.size_bytes,
          sha256: target.sha256,
          change_note:
            request.body.change_note ?? `Restauración de la versión ${target.version}`,
          uploaded_by: profile.id,
        } as never)
        .select('*')
        .single();

      if (error || !restored) throw badRequest('restore_failed', 'No se pudo restaurar la versión.');

      await app.audit(request, {
        action: 'document.version_restored',
        entityType: 'document',
        entityId: document.id,
        assetId: document.asset_id,
        documentId: document.id,
        documentVersion: restored.version,
        metadata: { restored_from: target.version },
      });

      return { version: restored };
    },
  );

  r.delete(
    '/documents/:id',
    {
      preHandler: app.requireAuth,
      schema: { params: z.object({ id: z.string().uuid() }) },
    },
    async (request) => {
      const document = await loadDocument(app, request.params.id);
      await assertControlsAsset(app, document.asset_id, request.auth!.profile);

      await app.supabase
        .from('documents')
        .update({ deleted_at: new Date().toISOString() } as never)
        .eq('id', document.id);

      await app.supabase
        .from('document_permissions')
        .update({ revoked_at: new Date().toISOString(), revoke_reason: 'document_deleted' } as never)
        .eq('document_id', document.id)
        .is('revoked_at', null);

      await app.audit(request, {
        action: 'document.deleted',
        entityType: 'document',
        entityId: document.id,
        assetId: document.asset_id,
        documentId: document.id,
      });

      return { ok: true };
    },
  );

  // ── Permisos ────────────────────────────────────────────────────────────
  r.post(
    '/permissions/grant',
    { preHandler: app.requireAuth, schema: { body: grantPermissionSchema } },
    async (request) => {
      const profile = request.auth!.profile;
      const { deal, asset, side } = await loadDealContext(app, request.body.deal_id, profile);

      if (side === 'buyer') throw forbidden('Solo el vendedor concede permisos.');
      if (request.body.user_id !== deal.buyer_id) {
        throw badRequest('invalid_grantee', 'Solo puede conceder permisos al comprador del deal.');
      }

      const { data: documents } = await app.supabase
        .from('documents')
        .select('id, asset_id, name')
        .in('id', request.body.document_ids)
        .is('deleted_at', null);

      const valid = (documents ?? []).filter((d) => d.asset_id === deal.asset_id);
      if (valid.length === 0) throw badRequest('no_documents', 'No hay documentos válidos.');

      const expiresAt =
        request.body.expires_in_days > 0
          ? new Date(Date.now() + request.body.expires_in_days * 86_400_000).toISOString()
          : null;

      const { error } = await app.supabase.from('document_permissions').upsert(
        valid.map((doc) => ({
          document_id: doc.id,
          deal_id: deal.id,
          user_id: request.body.user_id,
          level: request.body.level,
          granted_by: profile.id,
          granted_at: new Date().toISOString(),
          expires_at: expiresAt,
          revoked_at: null,
          revoked_by: null,
          revoke_reason: null,
          expiry_notified_at: null,
        })) as never,
        { onConflict: 'document_id,user_id,deal_id' },
      );

      if (error) {
        request.log.error({ err: error }, 'No se pudieron conceder permisos');
        throw badRequest('grant_failed', 'No se pudieron conceder los permisos.');
      }

      for (const doc of valid) {
        await app.audit(request, {
          action: 'permission.granted',
          entityType: 'permission',
          entityId: doc.id,
          dealId: deal.id,
          assetId: asset.id,
          documentId: doc.id,
          metadata: { level: request.body.level, expires_at: expiresAt, grantee: request.body.user_id },
        });
      }

      await app.notify({
        userId: request.body.user_id,
        type: 'permission.granted',
        title: 'Nuevos documentos disponibles',
        body: `Se le concedió acceso a ${valid.length} documento(s) de «${asset.title}».`,
        link: `/deal/${deal.id}#documents`,
        dealId: deal.id,
        severity: 'success',
      });

      return { granted: valid.length, expires_at: expiresAt };
    },
  );

  r.post(
    '/permissions/revoke',
    { preHandler: app.requireAuth, schema: { body: revokePermissionSchema } },
    async (request) => {
      const profile = request.auth!.profile;

      const { data: permission } = await app.supabase
        .from('document_permissions')
        .select('*, documents!document_permissions_document_id_fkey (asset_id, name)')
        .eq('id', request.body.permission_id)
        .maybeSingle();

      if (!permission) throw notFound('Permiso no encontrado.');

      const doc = embedded<{ asset_id: string; name: string } | undefined>(
        (permission as Record<string, unknown>).documents,
      );
      if (!doc) throw notFound('Documento no encontrado.');
      await assertControlsAsset(app, doc.asset_id, profile);

      await app.supabase
        .from('document_permissions')
        .update({
          revoked_at: new Date().toISOString(),
          revoked_by: profile.id,
          revoke_reason: request.body.reason ?? 'manual',
        } as never)
        .eq('id', permission.id);

      await app.audit(request, {
        action: 'permission.revoked',
        entityType: 'permission',
        entityId: permission.id,
        dealId: permission.deal_id,
        assetId: doc.asset_id,
        documentId: permission.document_id,
        metadata: { reason: request.body.reason },
      });

      return { ok: true };
    },
  );

  // ══════════════════════════════════════════════════════════════════════
  // Entrega de documento — el punto más sensible de la plataforma.
  //
  //   KYC aprobado → NDA firmado → permiso vigente → marca de agua → URL
  //   firmada de 5 minutos. Cada paso se comprueba aquí, no en el cliente.
  // ══════════════════════════════════════════════════════════════════════
  r.get(
    '/documents/:id/access',
    {
      preHandler: app.requireAuth,
      config: { rateLimit: { max: 60, timeWindow: '5 minutes' } },
      schema: {
        params: z.object({ id: z.string().uuid() }),
        querystring: documentAccessSchema.omit({ document_id: true }),
      },
    },
    async (request) => {
      const profile = request.auth!.profile;
      const { intent, version } = request.query;
      const document = await loadDocument(app, request.params.id);

      let dealId: string | null = null;
      let isOwnerSide = false;

      try {
        await assertControlsAsset(app, document.asset_id, profile);
        isOwnerSide = true;
      } catch {
        // Comprador: hay que recorrer toda la cadena de control.
        const { data: permission } = await app.supabase
          .from('document_permissions')
          .select('*')
          .eq('document_id', document.id)
          .eq('user_id', profile.id)
          .maybeSingle();

        if (!permission || permission.revoked_at) {
          await app.audit(request, {
            action: 'document.access_denied',
            entityType: 'document',
            entityId: document.id,
            documentId: document.id,
            assetId: document.asset_id,
            metadata: { reason: 'no_permission' },
          });
          throw forbidden('No tiene permiso sobre este documento.', 'no_permission');
        }

        if (permission.expires_at && new Date(permission.expires_at) <= new Date()) {
          // Vencido: se revoca en el acto, sin esperar al barrido nocturno.
          await app.supabase
            .from('document_permissions')
            .update({ revoked_at: new Date().toISOString(), revoke_reason: 'auto:expired' } as never)
            .eq('id', permission.id);

          await app.audit(request, {
            action: 'document.access_denied',
            entityType: 'document',
            entityId: document.id,
            documentId: document.id,
            dealId: permission.deal_id,
            metadata: { reason: 'permission_expired' },
          });
          throw forbidden('Su acceso a este documento ha vencido.', 'permission_expired');
        }

        if (intent === 'download' && permission.level !== 'download') {
          throw forbidden('Su permiso es solo de visualización.', 'view_only');
        }

        if (profile.kyc_status !== 'approved' || profile.screening_status === 'blocked') {
          throw forbidden('Debe completar la verificación KYC.', 'kyc_required');
        }

        const { deal } = await loadDealContext(app, permission.deal_id, profile);

        if (!isDealRoomOpen(deal.stage)) {
          throw forbidden('El Deal Room no está abierto.', 'deal_closed');
        }
        if (deal.expires_at && new Date(deal.expires_at) <= new Date()) {
          throw forbidden('El acceso al Deal Room ha vencido.', 'deal_expired');
        }

        const { data: nda } = await app.supabase
          .from('ndas')
          .select('status, signed_at')
          .eq('deal_id', deal.id)
          .maybeSingle();

        if (!nda || nda.status !== 'signed') {
          throw forbidden('Debe firmar el acuerdo de confidencialidad.', 'nda_required');
        }

        dealId = deal.id;

        await app.supabase
          .from('document_permissions')
          .update({
            [intent === 'download' ? 'download_count' : 'view_count']:
              (intent === 'download' ? permission.download_count : permission.view_count) + 1,
            last_accessed_at: new Date().toISOString(),
          } as never)
          .eq('id', permission.id);
      }

      // ── Resolver la versión a entregar ──────────────────────────────────
      const versionQuery = app.supabase
        .from('document_versions')
        .select('*')
        .eq('document_id', document.id);

      const { data: targetVersion } = version
        ? await versionQuery.eq('version', version).maybeSingle()
        : await versionQuery.order('version', { ascending: false }).limit(1).maybeSingle();

      if (!targetVersion) throw notFound('El documento no tiene contenido cargado.');

      const original = await downloadObject(app, targetVersion.bucket, targetVersion.storage_path);
      if (!original) throw notFound('No se pudo recuperar el archivo.');

      const ttl = app.config.SIGNED_URL_TTL;
      let deliveryPath = targetVersion.storage_path;
      let watermarked = false;

      if (isPdf(targetVersion.mime_type)) {
        const stamped = await watermarkPdf(original, {
          email: profile.email,
          timestamp: new Date(),
          dealReference: dealId ?? undefined,
          documentName: document.name,
        });

        // Copia efímera y personal. La limpia el job de mantenimiento.
        deliveryPath = `${DELIVERY_PREFIX}/${profile.id}/${document.id}-v${targetVersion.version}-${randomUUID()}.pdf`;
        const uploaded = await uploadObject(app, DEAL_BUCKET, deliveryPath, stamped, 'application/pdf');
        if (!uploaded) throw badRequest('delivery_failed', 'No se pudo preparar el documento.');
        watermarked = true;
      }

      const signedUrl = await createSignedUrl(
        app,
        DEAL_BUCKET,
        deliveryPath,
        ttl,
        intent === 'download' ? targetVersion.file_name : undefined,
      );

      if (!signedUrl) throw badRequest('sign_failed', 'No se pudo generar el enlace.');

      await app.audit(request, {
        action: intent === 'download' ? 'document.download' : 'document.view',
        entityType: 'document',
        entityId: document.id,
        documentId: document.id,
        documentVersion: targetVersion.version,
        assetId: document.asset_id,
        dealId: dealId ?? undefined,
        metadata: {
          watermarked,
          signed_url_ttl: ttl,
          owner_side: isOwnerSide,
          file_name: targetVersion.file_name,
        },
      });

      return {
        url: signedUrl,
        expiresIn: ttl,
        expiresAt: new Date(Date.now() + ttl * 1000).toISOString(),
        watermarked,
        fileName: targetVersion.file_name,
        version: targetVersion.version,
        mimeType: targetVersion.mime_type,
      };
    },
  );

  // ── Vista de auditoría del vendedor ─────────────────────────────────────
  r.get(
    '/deals/:id/audit',
    {
      preHandler: app.requireAuth,
      schema: {
        params: z.object({ id: z.string().uuid() }),
        querystring: z.object({ limit: z.coerce.number().int().min(1).max(500).default(100) }),
      },
    },
    async (request) => {
      const profile = request.auth!.profile;
      const { deal, side } = await loadDealContext(app, request.params.id, profile);

      if (side === 'buyer') {
        throw forbidden('El registro de auditoría es visible para el vendedor.');
      }

      const { data } = await app.supabase
        .from('audit_logs')
        .select('*')
        .eq('deal_id', deal.id)
        .order('created_at', { ascending: false })
        .limit(request.query.limit);

      return { entries: data ?? [] };
    },
  );
}
