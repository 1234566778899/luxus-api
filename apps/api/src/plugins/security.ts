import fp from 'fastify-plugin';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import type { AppConfig } from '../config.js';

export default fp<{ config: AppConfig }>(
  async (app, opts) => {
    const { config } = opts;

    await app.register(helmet, {
      // La API sirve JSON y PDF; no necesita CSP de documento.
      contentSecurityPolicy: false,
      crossOriginResourcePolicy: { policy: 'same-site' },
      referrerPolicy: { policy: 'no-referrer' },
    });

    await app.register(cors, {
      origin(origin, cb) {
        // Peticiones servidor-a-servidor (sin Origin) se permiten: el JWT
        // sigue siendo obligatorio en las rutas protegidas.
        if (!origin) return cb(null, true);
        if (config.corsOrigins.includes(origin)) return cb(null, true);
        // Denegar sin lanzar: el navegador bloquea la respuesta por ausencia
        // de cabeceras CORS, y la API no responde 500 a un sondeo cualquiera.
        app.log.warn({ origin }, 'Origen rechazado por CORS');
        cb(null, false);
      },
      credentials: true,
      methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE', 'OPTIONS'],
      allowedHeaders: ['Content-Type', 'Authorization', 'x-luxus-job-secret', 'stripe-signature'],
      maxAge: 86_400,
    });

    await app.register(rateLimit, {
      global: true,
      max: 240,
      timeWindow: '1 minute',
      // Identidad antes que IP: evita castigar oficinas tras un mismo NAT.
      keyGenerator: (request) => request.auth?.userId ?? request.ip,
      errorResponseBuilder: () => ({
        error: {
          code: 'rate_limited',
          message: 'Demasiadas peticiones. Espere un momento e inténtelo de nuevo.',
        },
      }),
    });
  },
  { name: 'luxus-security', dependencies: ['luxus-auth'] },
);
