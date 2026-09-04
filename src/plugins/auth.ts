import fp from 'fastify-plugin';
import { createRemoteJWKSet, jwtVerify } from 'jose';
import type { FastifyReply, FastifyRequest } from 'fastify';
import type { ProfileRow, UserRole } from '@luxus/shared';
import type { AppConfig } from '../config.js';

export interface AuthContext {
  userId: string;
  email: string;
  accessToken: string;
  profile: ProfileRow;
}

declare module 'fastify' {
  interface FastifyRequest {
    auth: AuthContext | null;
  }
  interface FastifyInstance {
    requireAuth(request: FastifyRequest, reply: FastifyReply): Promise<void>;
    requireRole(...roles: UserRole[]): (req: FastifyRequest, reply: FastifyReply) => Promise<void>;
    /** Nivel II: KYC aprobado y no bloqueado por screening. */
    requireVerifiedMember(request: FastifyRequest, reply: FastifyReply): Promise<void>;
    requireInternalJob(request: FastifyRequest, reply: FastifyReply): Promise<void>;
  }
}

function bearer(request: FastifyRequest): string | null {
  const header = request.headers.authorization;
  if (!header?.startsWith('Bearer ')) return null;
  const token = header.slice(7).trim();
  return token.length > 0 ? token : null;
}

export default fp<{ config: AppConfig }>(
  async (app, opts) => {
    const { config } = opts;

    // Proyectos con claves asimétricas exponen el JWKS; los legacy usan el
    // secreto compartido HS256. Se soportan ambos.
    const jwks = createRemoteJWKSet(new URL(`${config.SUPABASE_URL}/auth/v1/.well-known/jwks.json`));
    const hsSecret = config.SUPABASE_JWT_SECRET
      ? new TextEncoder().encode(config.SUPABASE_JWT_SECRET)
      : null;

    /** Devuelve el `sub` del token o null si no es válido. */
    async function verifyToken(token: string): Promise<{ sub: string; email: string } | null> {
      try {
        const { payload } = hsSecret
          ? await jwtVerify(token, hsSecret, { algorithms: ['HS256'] })
          : await jwtVerify(token, jwks, { issuer: `${config.SUPABASE_URL}/auth/v1` });

        if (typeof payload.sub !== 'string') return null;
        return { sub: payload.sub, email: String(payload.email ?? '') };
      } catch {
        // Último recurso: preguntar a GoTrue. Cubre rotaciones de clave y
        // configuraciones donde el JWKS aún no está disponible.
        const { data, error } = await app.supabase.auth.getUser(token);
        if (error || !data.user) return null;
        return { sub: data.user.id, email: data.user.email ?? '' };
      }
    }

    app.decorateRequest('auth', null);

    // Hook global: si viene token, se resuelve el contexto. No bloquea:
    // las rutas públicas siguen funcionando sin cabecera.
    app.addHook('onRequest', async (request) => {
      const token = bearer(request);
      if (!token) return;

      const claims = await verifyToken(token);
      if (!claims) return;

      const { data: profile } = await app.supabase
        .from('profiles')
        .select('*')
        .eq('id', claims.sub)
        .maybeSingle();

      if (!profile) return;

      request.auth = {
        userId: claims.sub,
        email: profile.email ?? claims.email,
        accessToken: token,
        profile: profile as ProfileRow,
      };
    });

    app.decorate('requireAuth', async (request: FastifyRequest, reply: FastifyReply) => {
      if (!request.auth) {
        return reply.code(401).send({
          error: { code: 'unauthorized', message: 'Autenticación requerida.' },
        });
      }
      if (request.auth.profile.is_suspended) {
        return reply.code(403).send({
          error: {
            code: 'account_suspended',
            message: 'Su cuenta está suspendida. Contacte con el equipo de LUXUS.',
          },
        });
      }
    });

    app.decorate(
      'requireRole',
      (...roles: UserRole[]) =>
        async (request: FastifyRequest, reply: FastifyReply) => {
          await app.requireAuth(request, reply);
          if (reply.sent) return;
          if (!roles.includes(request.auth!.profile.role)) {
            return reply.code(403).send({
              error: { code: 'forbidden', message: 'No tiene permisos para esta operación.' },
            });
          }
        },
    );

    app.decorate('requireVerifiedMember', async (request: FastifyRequest, reply: FastifyReply) => {
      await app.requireAuth(request, reply);
      if (reply.sent) return;
      const p = request.auth!.profile;
      if (p.role === 'admin') return;
      if (p.kyc_status !== 'approved' || p.screening_status === 'blocked') {
        return reply.code(403).send({
          error: {
            code: 'kyc_required',
            message: 'Debe completar la verificación KYC para acceder a esta información.',
          },
        });
      }
    });

    app.decorate('requireInternalJob', async (request: FastifyRequest, reply: FastifyReply) => {
      const secret = request.headers['x-luxus-job-secret'];
      if (secret !== config.INTERNAL_JOB_SECRET) {
        return reply.code(401).send({
          error: { code: 'unauthorized', message: 'Secreto de job no válido.' },
        });
      }
    });
  },
  { name: 'luxus-auth', dependencies: ['luxus-supabase'] },
);
