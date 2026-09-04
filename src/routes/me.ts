import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { notificationPreferencesSchema, updateProfileSchema } from '@luxus/shared';
import { badRequest } from '../plugins/errors.js';

export default async function meRoutes(app: FastifyInstance): Promise<void> {
  const r = app.withTypeProvider<ZodTypeProvider>();

  r.get('/me', { preHandler: app.requireAuth }, async (request) => {
    const profile = request.auth!.profile;

    const [prefs, broker, subscription] = await Promise.all([
      app.supabase.from('notification_preferences').select('*').eq('user_id', profile.id).maybeSingle(),
      app.supabase.from('brokers').select('*').eq('user_id', profile.id).maybeSingle(),
      app.supabase
        .from('subscriptions')
        .select('*, plans!subscriptions_plan_code_fkey (name, benefits)')
        .eq('user_id', profile.id)
        .in('status', ['active', 'trialing', 'past_due'])
        .maybeSingle(),
    ]);

    return {
      profile,
      preferences: prefs.data,
      broker: broker.data,
      subscription: subscription.data,
    };
  });

  r.patch(
    '/me',
    { preHandler: app.requireAuth, schema: { body: updateProfileSchema } },
    async (request) => {
      // El rol, el nivel de acceso y el estado de compliance no son editables
      // por el titular: los gobierna la plataforma.
      const { error } = await app.supabase
        .from('profiles')
        .update(request.body as never)
        .eq('id', request.auth!.userId);

      if (error) throw badRequest('profile_update_failed', error.message);
      return { ok: true };
    },
  );

  r.patch(
    '/me/notification-preferences',
    { preHandler: app.requireAuth, schema: { body: notificationPreferencesSchema } },
    async (request) => {
      const { error } = await app.supabase
        .from('notification_preferences')
        .upsert(
          { user_id: request.auth!.userId, ...request.body, updated_at: new Date().toISOString() } as never,
          { onConflict: 'user_id' },
        );

      if (error) throw badRequest('prefs_failed', error.message);
      return { ok: true };
    },
  );

  // ── Notificaciones ──────────────────────────────────────────────────────
  r.get(
    '/me/notifications',
    {
      preHandler: app.requireAuth,
      schema: {
        querystring: z.object({
          unreadOnly: z.coerce.boolean().default(false),
          limit: z.coerce.number().int().min(1).max(100).default(30),
        }),
      },
    },
    async (request) => {
      let query = app.supabase
        .from('notifications')
        .select('*', { count: 'exact' })
        .eq('user_id', request.auth!.userId)
        .order('created_at', { ascending: false })
        .limit(request.query.limit);

      if (request.query.unreadOnly) query = query.is('read_at', null);

      const { data, count } = await query;

      const { count: unread } = await app.supabase
        .from('notifications')
        .select('id', { count: 'exact', head: true })
        .eq('user_id', request.auth!.userId)
        .is('read_at', null);

      return { notifications: data ?? [], total: count ?? 0, unread: unread ?? 0 };
    },
  );

  r.post(
    '/me/notifications/read',
    {
      preHandler: app.requireAuth,
      schema: {
        body: z.object({
          ids: z.array(z.string().uuid()).max(200).optional(),
          all: z.boolean().default(false),
        }),
      },
    },
    async (request) => {
      let query = app.supabase
        .from('notifications')
        .update({ read_at: new Date().toISOString() } as never)
        .eq('user_id', request.auth!.userId)
        .is('read_at', null);

      if (!request.body.all && request.body.ids?.length) {
        query = query.in('id', request.body.ids);
      } else if (!request.body.all) {
        return { ok: true, updated: 0 };
      }

      await query;
      return { ok: true };
    },
  );

  // ── Sesiones y cierre remoto ────────────────────────────────────────────
  r.get('/me/sessions', { preHandler: app.requireAuth }, async (request) => {
    const { data } = await app.supabase
      .from('user_sessions')
      .select('*')
      .eq('user_id', request.auth!.userId)
      .is('revoked_at', null)
      .order('last_seen_at', { ascending: false });

    return { sessions: data ?? [] };
  });

  /** Registra o refresca la sesión actual (lo llama el frontend tras el login). */
  r.post(
    '/me/sessions/heartbeat',
    {
      preHandler: app.requireAuth,
      config: { rateLimit: { max: 60, timeWindow: '1 hour' } },
      schema: { body: z.object({ device_label: z.string().trim().max(120).optional() }) },
    },
    async (request) => {
      const userId = request.auth!.userId;
      const userAgent = request.headers['user-agent'] ?? null;

      const { data: existing } = await app.supabase
        .from('user_sessions')
        .select('id')
        .eq('user_id', userId)
        .eq('user_agent', userAgent ?? '')
        .is('revoked_at', null)
        .maybeSingle();

      if (existing) {
        await app.supabase
          .from('user_sessions')
          .update({ last_seen_at: new Date().toISOString(), ip_address: request.ip } as never)
          .eq('id', existing.id);
      } else {
        await app.supabase.from('user_sessions').insert({
          user_id: userId,
          ip_address: request.ip,
          user_agent: userAgent,
          device_label: request.body.device_label ?? null,
        } as never);
      }

      await app.supabase
        .from('profiles')
        .update({ last_seen_at: new Date().toISOString() } as never)
        .eq('id', userId);

      return { ok: true };
    },
  );

  /**
   * Cierre de sesión remoto. Revoca *todas* las sesiones del usuario en GoTrue:
   * es la respuesta correcta ante un dispositivo perdido, y no hay forma fiable
   * de invalidar un único refresh token de terceros desde aquí.
   */
  r.post('/me/sessions/revoke-all', { preHandler: app.requireAuth }, async (request) => {
    const userId = request.auth!.userId;

    const { error } = await app.supabase.auth.admin.signOut(userId, 'global');
    if (error) throw badRequest('signout_failed', error.message);

    await app.supabase
      .from('user_sessions')
      .update({ revoked_at: new Date().toISOString() } as never)
      .eq('user_id', userId)
      .is('revoked_at', null);

    await app.audit(request, {
      action: 'session.revoked_all',
      entityType: 'profile',
      entityId: userId,
    });

    return { ok: true };
  });

  // ── Watchlist ───────────────────────────────────────────────────────────
  r.get('/me/watchlist', { preHandler: app.requireAuth }, async (request) => {
    const { data } = await app.supabase
      .from('watchlist')
      .select(`
        *,
        assets!watchlist_asset_id_fkey (
          id, slug, title, category, district, region,
          price_min, price_max, price_on_request, visibility, status
        )
      `)
      .eq('user_id', request.auth!.userId)
      .order('created_at', { ascending: false });

    return { items: data ?? [] };
  });

  r.post(
    '/me/watchlist',
    {
      preHandler: app.requireAuth,
      schema: {
        body: z.object({
          asset_id: z.string().uuid(),
          note: z.string().trim().max(500).optional(),
        }),
      },
    },
    async (request) => {
      await app.supabase.from('watchlist').upsert(
        {
          user_id: request.auth!.userId,
          asset_id: request.body.asset_id,
          note: request.body.note ?? null,
        } as never,
        { onConflict: 'user_id,asset_id' },
      );
      return { ok: true };
    },
  );

  r.delete(
    '/me/watchlist/:assetId',
    {
      preHandler: app.requireAuth,
      schema: { params: z.object({ assetId: z.string().uuid() }) },
    },
    async (request) => {
      await app.supabase
        .from('watchlist')
        .delete()
        .eq('user_id', request.auth!.userId)
        .eq('asset_id', request.params.assetId);
      return { ok: true };
    },
  );

  // ── Historial de NDAs firmados ──────────────────────────────────────────
  r.get('/me/ndas', { preHandler: app.requireAuth }, async (request) => {
    const { data } = await app.supabase
      .from('ndas')
      .select(`
        id, status, signed_at, signed_sha256, template_version,
        deals!ndas_deal_id_fkey (
          id, reference_code, stage,
          assets!deals_asset_id_fkey (title, slug, category)
        )
      `)
      .eq('signer_email', request.auth!.email)
      .eq('status', 'signed')
      .order('signed_at', { ascending: false });

    return { ndas: data ?? [] };
  });
}
