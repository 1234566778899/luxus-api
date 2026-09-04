import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import {
  assetPrivateDetailsSchema, createAssetSchema, slugify, updateAssetSchema,
} from '@luxus/shared';
import { badRequest, conflict, forbidden } from '../plugins/errors.js';
import { assertControlsAsset } from '../lib/guards.js';

/**
 * Publicación de activos (wizard del vendedor / bróker).
 *
 * Podría hacerse directo contra Supabase — RLS lo permitiría — pero pasa por
 * aquí porque la creación implica varias cosas atómicas de cara al usuario:
 * slug único, validación de specs según categoría, alta de los datos Nivel II
 * en su tabla aparte y comprobación de la cuota del plan del bróker.
 */
export default async function assetRoutes(app: FastifyInstance): Promise<void> {
  const r = app.withTypeProvider<ZodTypeProvider>();

  const sellerOnly = { preHandler: app.requireRole('seller', 'broker', 'admin') };

  // ── Crear ───────────────────────────────────────────────────────────────
  r.post(
    '/assets',
    {
      ...sellerOnly,
      schema: {
        body: createAssetSchema.and(
          z.object({ private_details: assetPrivateDetailsSchema.optional() }),
        ),
      },
    },
    async (request, reply) => {
      const profile = request.auth!.profile;
      const { private_details, ...body } = request.body;

      // Cuota del plan del bróker.
      if (body.broker_id) {
        const { data: broker } = await app.supabase
          .from('brokers')
          .select('id, user_id, listing_quota')
          .eq('id', body.broker_id)
          .maybeSingle();

        if (!broker || (broker.user_id !== profile.id && profile.role !== 'admin')) {
          throw forbidden('No puede publicar en nombre de ese bróker.');
        }

        const { count } = await app.supabase
          .from('assets')
          .select('id', { count: 'exact', head: true })
          .eq('broker_id', broker.id)
          .in('status', ['published', 'pending_review']);

        if (broker.listing_quota > 0 && (count ?? 0) >= broker.listing_quota) {
          throw conflict(
            'quota_exceeded',
            `Su plan permite ${broker.listing_quota} activos publicados. Amplíe su suscripción para añadir más.`,
          );
        }
      }

      const slug = await uniqueSlug(app, slugify(body.title));

      const { data: asset, error } = await app.supabase
        .from('assets')
        .insert({
          slug,
          owner_id: profile.id,
          broker_id: body.broker_id ?? null,
          category: body.category,
          title: body.title,
          headline: body.headline ?? null,
          description_public: body.description_public,
          district: body.district ?? null,
          province: body.province ?? null,
          region: body.region ?? null,
          country: body.country,
          price_min: body.price_min ?? null,
          price_max: body.price_max ?? null,
          price_on_request: body.price_on_request,
          visibility: body.visibility,
          tier: body.tier,
          specs: body.specs as never,
          status: 'draft',
        } as never)
        .select('*')
        .single();

      if (error || !asset) {
        request.log.error({ err: error }, 'No se pudo crear el activo');
        throw badRequest('asset_create_failed', 'No se pudo crear el activo.');
      }

      // El trigger de la base ya creó la fila de Nivel II y el checklist.
      if (private_details) {
        await app.supabase
          .from('asset_private_details')
          .update(private_details as never)
          .eq('asset_id', asset.id);
      }

      await app.audit(request, {
        action: 'asset.created',
        entityType: 'asset',
        entityId: asset.id,
        assetId: asset.id,
        metadata: { category: body.category, tier: body.tier },
      });

      return reply.code(201).send({ asset });
    },
  );

  // ── Actualizar ──────────────────────────────────────────────────────────
  r.patch(
    '/assets/:id',
    {
      preHandler: app.requireAuth,
      schema: {
        params: z.object({ id: z.string().uuid() }),
        body: updateAssetSchema.omit({ id: true }).and(
          z.object({ private_details: assetPrivateDetailsSchema.optional() }),
        ),
      },
    },
    async (request) => {
      const profile = request.auth!.profile;
      const asset = await assertControlsAsset(app, request.params.id, profile);
      const { private_details, ...body } = request.body;

      if (Object.keys(body).length > 0) {
        const { error } = await app.supabase
          .from('assets')
          .update({
            ...body,
            specs: (body.specs ?? asset.specs) as never,
            // Editar un activo publicado lo devuelve a revisión: la ficha
            // pública no puede cambiar sin pasar por verificación.
            ...(asset.status === 'published' && hasMaterialChange(body)
              ? { status: 'pending_review' }
              : {}),
          } as never)
          .eq('id', asset.id);

        if (error) throw badRequest('asset_update_failed', error.message);
      }

      if (private_details) {
        await app.supabase
          .from('asset_private_details')
          .update(private_details as never)
          .eq('asset_id', asset.id);
      }

      await app.audit(request, {
        action: 'asset.updated',
        entityType: 'asset',
        entityId: asset.id,
        assetId: asset.id,
        metadata: { fields: Object.keys(request.body) },
      });

      return { ok: true };
    },
  );

  // ── Enviar a verificación ───────────────────────────────────────────────
  r.post(
    '/assets/:id/submit',
    {
      preHandler: app.requireAuth,
      schema: { params: z.object({ id: z.string().uuid() }) },
    },
    async (request) => {
      const asset = await assertControlsAsset(app, request.params.id, request.auth!.profile);

      if (!['draft', 'changes_requested'].includes(asset.status)) {
        throw conflict('invalid_status', 'Este activo no está en estado editable.');
      }

      const { count: mediaCount } = await app.supabase
        .from('asset_media')
        .select('id', { count: 'exact', head: true })
        .eq('asset_id', asset.id)
        .eq('is_public', true);

      if ((mediaCount ?? 0) < 3) {
        throw badRequest(
          'insufficient_media',
          'Cargue al menos tres fotografías públicas antes de enviar a verificación.',
        );
      }

      await app.supabase
        .from('assets')
        .update({ status: 'pending_review' } as never)
        .eq('id', asset.id);

      const { data: admins } = await app.supabase
        .from('profiles')
        .select('id')
        .eq('role', 'admin');

      for (const admin of admins ?? []) {
        await app.notify({
          userId: admin.id,
          type: 'asset.pending_review',
          title: 'Activo pendiente de verificación',
          body: `«${asset.title}» entró en la cola de verificación.`,
          link: '/admin/assets',
          assetId: asset.id,
        });
      }

      await app.audit(request, {
        action: 'asset.submitted',
        entityType: 'asset',
        entityId: asset.id,
        assetId: asset.id,
      });

      return { ok: true, status: 'pending_review' };
    },
  );

  // ── Cartera del vendedor con estadísticas ───────────────────────────────
  r.get('/assets/mine', { preHandler: app.requireAuth }, async (request) => {
    const profile = request.auth!.profile;

    const { data: broker } = await app.supabase
      .from('brokers')
      .select('id')
      .eq('user_id', profile.id)
      .maybeSingle();

    let query = app.supabase
      .from('assets')
      .select('*, asset_media (id, storage_path, bucket, is_public, sort_order), listing_fees (*)')
      .order('created_at', { ascending: false });

    query = broker
      ? query.or(`owner_id.eq.${profile.id},broker_id.eq.${broker.id}`)
      : query.eq('owner_id', profile.id);

    const { data: assets } = await query;
    const assetIds = (assets ?? []).map((a) => a.id);

    if (assetIds.length === 0) return { assets: [], stats: [] };

    const since = new Date(Date.now() - 30 * 86_400_000).toISOString();

    const [views, deals] = await Promise.all([
      app.supabase.from('asset_views').select('asset_id, created_at').in('asset_id', assetIds),
      app.supabase.from('deals').select('asset_id, stage').in('asset_id', assetIds),
    ]);

    const stats = assetIds.map((id) => {
      const assetViews = (views.data ?? []).filter((v) => v.asset_id === id);
      const assetDeals = (deals.data ?? []).filter((d) => d.asset_id === id);
      const asset = (assets ?? []).find((a) => a.id === id)!;

      return {
        asset_id: id,
        title: asset.title,
        slug: asset.slug,
        status: asset.status,
        views30d: assetViews.filter((v) => v.created_at >= since).length,
        viewsTotal: asset.view_count,
        enquiries: asset.enquiry_count,
        openDeals: assetDeals.filter(
          (d) => !['declined', 'withdrawn', 'expired', 'closed'].includes(d.stage),
        ).length,
      };
    });

    return { assets: assets ?? [], stats };
  });

  // ── Media ───────────────────────────────────────────────────────────────
  r.post(
    '/assets/:id/media/upload-url',
    {
      preHandler: app.requireAuth,
      schema: {
        params: z.object({ id: z.string().uuid() }),
        body: z.object({
          file_name: z.string().trim().min(1).max(255),
          is_public: z.boolean().default(true),
        }),
      },
    },
    async (request) => {
      const asset = await assertControlsAsset(app, request.params.id, request.auth!.profile);
      const bucket = request.body.is_public ? 'public-media' : 'asset-private-media';
      const ext = request.body.file_name.split('.').pop()?.toLowerCase().slice(0, 8) ?? 'jpg';
      // El primer segmento debe ser el id del activo: así lo exige la política
      // de Storage que autoriza la subida.
      const path = `${asset.id}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;

      const { data, error } = await app.supabase.storage
        .from(bucket)
        .createSignedUploadUrl(path);

      if (error || !data) throw badRequest('upload_url_failed', 'No se pudo preparar la carga.');
      return { bucket, path, token: data.token, signedUrl: data.signedUrl };
    },
  );

  r.post(
    '/assets/:id/media',
    {
      preHandler: app.requireAuth,
      schema: {
        params: z.object({ id: z.string().uuid() }),
        body: z.object({
          bucket: z.enum(['public-media', 'asset-private-media']),
          storage_path: z.string().trim().min(3).max(500),
          is_public: z.boolean().default(true),
          alt_text: z.string().trim().max(200).optional(),
          caption: z.string().trim().max(300).optional(),
          sort_order: z.number().int().min(0).max(200).default(0),
        }),
      },
    },
    async (request, reply) => {
      const asset = await assertControlsAsset(app, request.params.id, request.auth!.profile);

      const { data, error } = await app.supabase
        .from('asset_media')
        .insert({
          asset_id: asset.id,
          kind: 'image',
          bucket: request.body.bucket,
          storage_path: request.body.storage_path,
          is_public: request.body.is_public,
          alt_text: request.body.alt_text ?? null,
          caption: request.body.caption ?? null,
          sort_order: request.body.sort_order,
        } as never)
        .select('*')
        .single();

      if (error) throw badRequest('media_failed', error.message);
      return reply.code(201).send({ media: data });
    },
  );

  // ── Media privada: URL firmada (Nivel II) ───────────────────────────────
  r.get(
    '/assets/:id/private-media',
    {
      preHandler: app.requireAuth,
      schema: { params: z.object({ id: z.string().uuid() }) },
    },
    async (request) => {
      // El acceso Nivel II se comprueba con RLS: se consulta con el token del
      // usuario, no con service role. Si no tiene derecho, no ve nada.
      const userClient = app.supabaseAs(request.auth!.accessToken);
      const { data: allowed } = await userClient
        .from('asset_private_details')
        .select('asset_id')
        .eq('asset_id', request.params.id)
        .maybeSingle();

      if (!allowed) throw forbidden('No tiene acceso a la información reservada de este activo.');

      const { data: media } = await app.supabase
        .from('asset_media')
        .select('*')
        .eq('asset_id', request.params.id)
        .eq('is_public', false)
        .order('sort_order');

      const ttl = app.config.SIGNED_URL_TTL;
      const items = await Promise.all(
        (media ?? []).map(async (m) => {
          // El seed usa URLs remotas de placeholder; se pasan tal cual.
          if (m.storage_path.startsWith('http')) {
            return { ...m, url: m.storage_path };
          }
          const { data } = await app.supabase.storage
            .from(m.bucket)
            .createSignedUrl(m.storage_path, ttl);
          return { ...m, url: data?.signedUrl ?? null };
        }),
      );

      await app.audit(request, {
        action: 'asset.private_media_viewed',
        entityType: 'asset',
        entityId: request.params.id,
        assetId: request.params.id,
        metadata: { count: items.length },
      });

      return { media: items, expiresIn: ttl };
    },
  );
}

/** Materialidad: cambiar precio, ubicación o descripción vuelve a revisión. */
function hasMaterialChange(body: Record<string, unknown>): boolean {
  const material = [
    'title', 'description_public', 'price_min', 'price_max',
    'price_on_request', 'district', 'region', 'category', 'specs',
  ];
  return material.some((key) => key in body);
}

async function uniqueSlug(app: FastifyInstance, base: string): Promise<string> {
  let candidate = base || 'activo';
  for (let i = 0; i < 20; i += 1) {
    const { data } = await app.supabase
      .from('assets')
      .select('id')
      .eq('slug', candidate)
      .maybeSingle();
    if (!data) return candidate;
    candidate = `${base}-${i + 2}`;
  }
  return `${base}-${Date.now().toString(36)}`;
}
