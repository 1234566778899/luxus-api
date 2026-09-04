import 'fastify';

declare module 'fastify' {
  interface FastifyRequest {
    /** Cuerpo crudo, necesario para verificar firmas HMAC de webhooks. */
    rawBodyString?: string;
    rawBodyBuffer?: Buffer;
  }
}
