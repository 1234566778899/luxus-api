import type { FastifyInstance } from 'fastify';

export default async function healthRoutes(app: FastifyInstance): Promise<void> {
  app.get('/health', { config: { rateLimit: false } }, async () => ({
    status: 'ok',
    service: 'luxus-api',
    time: new Date().toISOString(),
  }));

  app.get('/health/deep', { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } }, async () => {
    const started = Date.now();
    const { error } = await app.supabase.from('plans').select('code').limit(1);
    return {
      status: error ? 'degraded' : 'ok',
      database: error ? 'unreachable' : 'ok',
      latencyMs: Date.now() - started,
      providers: {
        kyc: app.config.KYC_PROVIDER,
        screening: app.config.SCREENING_PROVIDER,
        esign: app.config.ESIGN_PROVIDER,
        email: app.config.EMAIL_PROVIDER,
        payments: app.config.PAYMENTS_PROVIDER,
      },
    };
  });
}
