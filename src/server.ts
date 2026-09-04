import Fastify, { type FastifyInstance } from 'fastify';
import sensible from '@fastify/sensible';
import { serializerCompiler, validatorCompiler } from 'fastify-type-provider-zod';
import type { AppConfig } from './config.js';

import supabasePlugin from './plugins/supabase.js';
import authPlugin from './plugins/auth.js';
import servicesPlugin from './plugins/services.js';
import securityPlugin from './plugins/security.js';
import auditPlugin from './plugins/audit.js';
import errorsPlugin from './plugins/errors.js';

import healthRoutes from './routes/health.js';
import publicRoutes from './routes/public.js';
import meRoutes from './routes/me.js';
import kycRoutes from './routes/kyc.js';
import assetRoutes from './routes/assets.js';
import dealRoutes from './routes/deals.js';
import documentRoutes from './routes/documents.js';
import ndaRoutes from './routes/nda.js';
import qaRoutes from './routes/qa.js';
import offerRoutes from './routes/offers.js';
import billingRoutes from './routes/billing.js';
import adminRoutes from './routes/admin.js';
import crmRoutes from './routes/crm.js';
import jobRoutes from './routes/jobs.js';

export async function buildServer(config: AppConfig): Promise<FastifyInstance> {
  const app = Fastify({
    logger: {
      level: config.LOG_LEVEL,
      ...(config.isProduction
        ? {}
        : { transport: { target: 'pino-pretty', options: { translateTime: 'HH:MM:ss', ignore: 'pid,hostname' } } }),
      // Nunca dejar caer credenciales ni cuerpos sensibles en el log.
      redact: {
        paths: [
          'req.headers.authorization',
          'req.headers.cookie',
          'req.headers["x-luxus-job-secret"]',
          'req.headers["stripe-signature"]',
          'req.body.password',
          'req.body.document_number',
          'req.body.identity.document_number',
        ],
        remove: true,
      },
    },
    // Detrás de un proxy (Fly, Railway, Vercel) la IP real llega en cabecera;
    // es la que se registra en el audit log.
    trustProxy: true,
    bodyLimit: 2 * 1024 * 1024,
  });

  // Cuerpo crudo: los webhooks (firma electrónica y Stripe) verifican HMAC
  // sobre los bytes exactos. Reserializar el JSON rompería la comprobación.
  app.addContentTypeParser(
    'application/json',
    { parseAs: 'buffer' },
    (request, body: Buffer, done) => {
      request.rawBodyBuffer = body;
      request.rawBodyString = body.toString('utf8');
      if (body.length === 0) return done(null, {});
      try {
        done(null, JSON.parse(request.rawBodyString));
      } catch (err) {
        done(err as Error, undefined);
      }
    },
  );

  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);

  await app.register(sensible);
  await app.register(errorsPlugin);
  await app.register(supabasePlugin, { config });
  await app.register(auditPlugin);
  await app.register(servicesPlugin, { config });
  await app.register(authPlugin, { config });
  await app.register(securityPlugin, { config });

  await app.register(healthRoutes);

  await app.register(
    async (v1) => {
      await v1.register(publicRoutes);
      await v1.register(meRoutes);
      await v1.register(kycRoutes);
      await v1.register(assetRoutes);
      await v1.register(dealRoutes);
      await v1.register(documentRoutes);
      await v1.register(ndaRoutes);
      await v1.register(qaRoutes);
      await v1.register(offerRoutes);
      await v1.register(billingRoutes);
      await v1.register(adminRoutes);
      await v1.register(crmRoutes);
      await v1.register(jobRoutes);
    },
    { prefix: '/v1' },
  );

  return app;
}
