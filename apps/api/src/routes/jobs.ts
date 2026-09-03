import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';

const DEAL_BUCKET = 'deal-documents';
const DELIVERY_PREFIX = '_delivery';
/** Las copias marcadas al agua sobreviven una hora; la URL firmada, cinco minutos. */
const DELIVERY_TTL_MS = 60 * 60 * 1000;

/**
 * Tareas de mantenimiento. Se invocan con el secreto interno desde cron
 * (o desde pg_cron si el proyecto lo tiene habilitado).
 *
 *   curl -X POST $API/v1/jobs/expire-access -H "x-luxus-job-secret: ..."
 */
export default async function jobRoutes(app: FastifyInstance): Promise<void> {
  const r = app.withTypeProvider<ZodTypeProvider>();

  // ── Expiración de accesos ───────────────────────────────────────────────
  r.post(
    '/jobs/expire-access',
    { preHandler: app.requireInternalJob, config: { rateLimit: false } },
    async (request) => {
      // 1 · Aviso previo (3 días antes) a quien aún puede pedir prórroga.
      const soon = new Date(Date.now() + 3 * 86_400_000).toISOString();

      const { data: expiring } = await app.supabase
        .from('document_permissions')
        .select('id, user_id, deal_id, expires_at, documents!document_permissions_document_id_fkey (name, asset_id)')
        .is('revoked_at', null)
        .is('expiry_notified_at', null)
        .not('expires_at', 'is', null)
        .lte('expires_at', soon)
        .gt('expires_at', new Date().toISOString());

      const byUserDeal = new Map<string, { userId: string; dealId: string; count: number; expiresAt: string }>();

      for (const perm of expiring ?? []) {
        const key = `${perm.user_id}:${perm.deal_id}`;
        const entry = byUserDeal.get(key);
        if (entry) entry.count += 1;
        else {
          byUserDeal.set(key, {
            userId: perm.user_id,
            dealId: perm.deal_id,
            count: 1,
            expiresAt: perm.expires_at!,
          });
        }
      }

      for (const entry of byUserDeal.values()) {
        const { data: deal } = await app.supabase
          .from('deals')
          .select('assets!deals_asset_id_fkey (title)')
          .eq('id', entry.dealId)
          .maybeSingle();

        const assetTitle =
          (deal as { assets?: { title: string } } | null)?.assets?.title ?? 'un activo';

        const { data: user } = await app.supabase
          .from('profiles')
          .select('email, full_name')
          .eq('id', entry.userId)
          .maybeSingle();

        if (user) {
          await app.sendMail({
            to: user.email,
            userId: entry.userId,
            template: 'permission_expiring',
            subject: '',
            data: {
              name: user.full_name ?? '',
              assetTitle,
              documentCount: entry.count,
              expiresAt: new Date(entry.expiresAt).toLocaleDateString('es-PE'),
              dealId: entry.dealId,
            },
          });
        }

        await app.notify({
          userId: entry.userId,
          type: 'permission.expiring',
          title: 'Accesos próximos a vencer',
          body: `${entry.count} documento(s) de «${assetTitle}» vencen el ${new Date(entry.expiresAt).toLocaleDateString('es-PE')}.`,
          link: `/deal/${entry.dealId}#documents`,
          dealId: entry.dealId,
          severity: 'warning',
        });
      }

      if ((expiring ?? []).length > 0) {
        await app.supabase
          .from('document_permissions')
          .update({ expiry_notified_at: new Date().toISOString() } as never)
          .in('id', (expiring ?? []).map((p) => p.id));
      }

      // 2 · Barrido de expiración (revoca permisos y cierra deals vencidos).
      const { data: swept, error } = await app.supabase.rpc(
        'expire_document_permissions' as never,
        {} as never,
      );

      if (error) request.log.error({ err: error }, 'Fallo en el barrido de expiración');

      const result = (Array.isArray(swept) ? swept[0] : swept) as unknown as
        | { expired_permissions: number; expired_deals: number }
        | undefined;

      await app.audit(null, {
        action: 'job.expire_access',
        metadata: {
          notified: byUserDeal.size,
          expired_permissions: result?.expired_permissions ?? 0,
          expired_deals: result?.expired_deals ?? 0,
        },
        actor: { email: 'system@luxusperu.com', role: 'admin' },
      });

      return {
        notified: byUserDeal.size,
        expiredPermissions: result?.expired_permissions ?? 0,
        expiredDeals: result?.expired_deals ?? 0,
      };
    },
  );

  // ── Limpieza de copias efímeras con marca de agua ───────────────────────
  r.post(
    '/jobs/cleanup-deliveries',
    { preHandler: app.requireInternalJob, config: { rateLimit: false } },
    async (request) => {
      const { data: folders } = await app.supabase.storage
        .from(DEAL_BUCKET)
        .list(DELIVERY_PREFIX, { limit: 1000 });

      let removed = 0;
      const cutoff = Date.now() - DELIVERY_TTL_MS;

      for (const folder of folders ?? []) {
        const { data: files } = await app.supabase.storage
          .from(DEAL_BUCKET)
          .list(`${DELIVERY_PREFIX}/${folder.name}`, { limit: 1000 });

        const stale = (files ?? [])
          .filter((f) => new Date(f.created_at ?? 0).getTime() < cutoff)
          .map((f) => `${DELIVERY_PREFIX}/${folder.name}/${f.name}`);

        if (stale.length > 0) {
          await app.supabase.storage.from(DEAL_BUCKET).remove(stale);
          removed += stale.length;
        }
      }

      request.log.info({ removed }, 'Limpieza de entregas efímeras');
      return { removed };
    },
  );

  // ── Reintento de KYC asíncrono (proveedores que responden por polling) ──
  r.post(
    '/jobs/poll-kyc',
    {
      preHandler: app.requireInternalJob,
      config: { rateLimit: false },
      schema: { body: z.object({ limit: z.number().int().min(1).max(100).default(25) }).optional() },
    },
    async (request) => {
      const limit = request.body?.limit ?? 25;

      const { data: pending } = await app.supabase
        .from('kyc_cases')
        .select('id, user_id, provider_ref')
        .eq('status', 'submitted')
        .not('provider_ref', 'is', null)
        .limit(limit);

      let resolved = 0;
      for (const kycCase of pending ?? []) {
        const result = await app.kyc.fetchStatus(kycCase.provider_ref!);
        if (!result || result.verdict === 'manual_review') continue;

        const status = result.verdict === 'approved' ? 'approved' : 'rejected';
        await app.supabase
          .from('kyc_cases')
          .update({ status, decided_at: new Date().toISOString() } as never)
          .eq('id', kycCase.id);
        await app.supabase
          .from('profiles')
          .update({ kyc_status: status } as never)
          .eq('id', kycCase.user_id);
        resolved += 1;
      }

      return { checked: (pending ?? []).length, resolved };
    },
  );
}
