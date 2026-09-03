import { z } from 'zod';

/**
 * Configuración del proceso. Se valida al arrancar: si falta algo crítico el
 * servidor no levanta, en lugar de fallar en la primera petición.
 */
const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().min(1).max(65535).default(4000),
  HOST: z.string().default('0.0.0.0'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),

  SUPABASE_URL: z.string().url(),
  SUPABASE_PUBLISHABLE_KEY: z.string().min(20),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(20, 'Pegue la service_role key en apps/api/.env'),
  SUPABASE_JWT_SECRET: z.string().optional().default(''),

  CORS_ORIGINS: z.string().default('http://localhost:4321'),
  PUBLIC_SITE_URL: z.string().url().default('http://localhost:4321'),

  SIGNED_URL_TTL: z.coerce.number().int().min(30).max(3600).default(300),
  INTERNAL_JOB_SECRET: z.string().min(8).default('dev-internal-job-secret'),

  KYC_PROVIDER: z.enum(['mock', 'reniec_partner']).default('mock'),
  SCREENING_PROVIDER: z.enum(['mock', 'acuant', 'dowjones']).default('mock'),
  ESIGN_PROVIDER: z.enum(['mock', 'llama_firma', 'docusign']).default('mock'),
  EMAIL_PROVIDER: z.enum(['mock', 'resend', 'sendgrid']).default('mock'),
  PAYMENTS_PROVIDER: z.enum(['mock', 'stripe', 'culqi']).default('mock'),

  RESEND_API_KEY: z.string().optional().default(''),
  EMAIL_FROM: z.string().default('LUXUS PERU <private@luxusperu.com>'),

  STRIPE_SECRET_KEY: z.string().optional().default(''),
  STRIPE_WEBHOOK_SECRET: z.string().optional().default(''),
  ESIGN_WEBHOOK_SECRET: z.string().optional().default('dev-esign-webhook-secret'),
});

export type AppConfig = z.infer<typeof schema> & {
  corsOrigins: string[];
  isProduction: boolean;
};

let cached: AppConfig | null = null;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  if (cached) return cached;

  const parsed = schema.safeParse(env);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `  · ${i.path.join('.')}: ${i.message}`)
      .join('\n');
    throw new Error(`[luxus:api] Configuración inválida.\n${issues}\n\n` +
      'Revise apps/api/.env (plantilla en apps/api/.env.example).');
  }

  const value = parsed.data;
  cached = {
    ...value,
    corsOrigins: value.CORS_ORIGINS.split(',').map((o) => o.trim()).filter(Boolean),
    isProduction: value.NODE_ENV === 'production',
  };

  if (value.PAYMENTS_PROVIDER === 'stripe' && !value.STRIPE_SECRET_KEY) {
    throw new Error('[luxus:api] PAYMENTS_PROVIDER=stripe requiere STRIPE_SECRET_KEY.');
  }
  if (value.EMAIL_PROVIDER === 'resend' && !value.RESEND_API_KEY) {
    throw new Error('[luxus:api] EMAIL_PROVIDER=resend requiere RESEND_API_KEY.');
  }

  return cached;
}

/** Solo para tests. */
export function resetConfig(): void {
  cached = null;
}
