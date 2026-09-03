import fp from 'fastify-plugin';
import type { FastifyRequest } from 'fastify';
import type { Json, UserRole } from '@luxus/shared';

export interface AuditEntry {
  action: string;
  entityType?: string;
  entityId?: string;
  dealId?: string;
  assetId?: string;
  documentId?: string;
  documentVersion?: number;
  metadata?: Record<string, unknown>;
  /** Sobrescribe el actor cuando la acción la ejecuta un job o un webhook. */
  actor?: { id?: string | null; email?: string | null; role?: UserRole | null };
}

declare module 'fastify' {
  interface FastifyInstance {
    /**
     * Registra una entrada de auditoría. Nunca lanza: un fallo de auditoría no
     * debe tumbar la operación, pero sí queda en el log del proceso.
     */
    audit(request: FastifyRequest | null, entry: AuditEntry): Promise<void>;
  }
}

/** IP real detrás de proxy. Se confía en x-forwarded-for solo si trustProxy. */
export function clientIp(request: FastifyRequest): string | null {
  return request.ip ?? null;
}

export default fp(
  async (app) => {
    app.decorate('audit', async (request: FastifyRequest | null, entry: AuditEntry) => {
      try {
        const actorId = entry.actor?.id ?? request?.auth?.userId ?? null;
        const actorEmail = entry.actor?.email ?? request?.auth?.email ?? null;
        const actorRole = entry.actor?.role ?? request?.auth?.profile.role ?? null;

        const { error } = await app.supabase.from('audit_logs').insert({
          actor_id: actorId,
          actor_email: actorEmail,
          actor_role: actorRole,
          action: entry.action,
          entity_type: entry.entityType ?? null,
          entity_id: entry.entityId ?? null,
          deal_id: entry.dealId ?? null,
          asset_id: entry.assetId ?? null,
          document_id: entry.documentId ?? null,
          document_version: entry.documentVersion ?? null,
          ip_address: request ? clientIp(request) : null,
          user_agent: request ? (request.headers['user-agent'] ?? null) : null,
          metadata: (entry.metadata ?? {}) as Json,
        } as never);

        if (error) app.log.error({ err: error, entry }, 'No se pudo escribir el audit log');
      } catch (err) {
        app.log.error({ err, entry }, 'Fallo inesperado escribiendo audit log');
      }
    });
  },
  { name: 'luxus-audit', dependencies: ['luxus-supabase'] },
);
