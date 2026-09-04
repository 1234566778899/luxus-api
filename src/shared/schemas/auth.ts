import { z } from 'zod';
import { email, phone } from './common.js';

/** Contraseña mínima para una plataforma con datos patrimoniales. */
export const password = z
  .string()
  .min(12, 'Mínimo 12 caracteres')
  .max(128)
  .regex(/[a-z]/, 'Debe incluir una minúscula')
  .regex(/[A-Z]/, 'Debe incluir una mayúscula')
  .regex(/[0-9]/, 'Debe incluir un número');

export const loginSchema = z.object({
  email,
  password: z.string().min(1, 'Introduzca su contraseña'),
});
export type LoginInput = z.infer<typeof loginSchema>;

export const mfaChallengeSchema = z.object({
  factorId: z.string().min(1),
  code: z.string().regex(/^[0-9]{6}$/, 'El código tiene 6 dígitos'),
});

export const registerSchema = z
  .object({
    email,
    password,
    confirmPassword: z.string(),
    full_name: z.string().trim().min(3).max(160),
    phone: phone.optional(),
    invitationToken: z.string().min(10),
    acceptTerms: z.literal(true, {
      errorMap: () => ({ message: 'Debe aceptar los términos y la política de privacidad.' }),
    }),
    acceptDataProcessing: z.literal(true, {
      errorMap: () => ({
        message: 'Debe autorizar el tratamiento de datos personales (Ley 29733).',
      }),
    }),
  })
  .refine((v) => v.password === v.confirmPassword, {
    path: ['confirmPassword'],
    message: 'Las contraseñas no coinciden.',
  });
export type RegisterInput = z.infer<typeof registerSchema>;

export const forgotPasswordSchema = z.object({ email });

export const resetPasswordSchema = z
  .object({ password, confirmPassword: z.string() })
  .refine((v) => v.password === v.confirmPassword, {
    path: ['confirmPassword'],
    message: 'Las contraseñas no coinciden.',
  });

export const privateAccessSchema = z.object({
  applicant_profile: z.enum(['buyer', 'family_office', 'seller', 'broker']),
  full_name: z.string().trim().min(3).max(160),
  email,
  phone: phone.optional(),
  company: z.string().trim().max(200).optional(),
  country: z.string().trim().max(80).default('PE'),
  city: z.string().trim().max(120).optional(),
  interest: z.string().trim().max(300).optional(),
  budget_range: z.string().trim().max(80).optional(),
  message: z.string().trim().max(2000).optional(),
  acceptPrivacy: z.literal(true, {
    errorMap: () => ({
      message: 'Debe autorizar el tratamiento de sus datos personales (Ley 29733).',
    }),
  }),
  /** Honeypot anti-bot: si viene con contenido, se descarta la solicitud. */
  website: z.string().max(0).optional(),
});
export type PrivateAccessInput = z.infer<typeof privateAccessSchema>;

export const updateProfileSchema = z.object({
  full_name: z.string().trim().min(3).max(160).optional(),
  phone: phone.optional(),
  city: z.string().trim().max(120).optional(),
  country: z.string().trim().max(80).optional(),
  language: z.enum(['es', 'en']).optional(),
});

export const notificationPreferencesSchema = z.object({
  email_deal_activity: z.boolean().optional(),
  email_qa: z.boolean().optional(),
  email_offers: z.boolean().optional(),
  email_kyc: z.boolean().optional(),
  email_billing: z.boolean().optional(),
  email_new_listings: z.boolean().optional(),
  email_expiry_alerts: z.boolean().optional(),
  in_app_enabled: z.boolean().optional(),
  digest_frequency: z.enum(['instant', 'daily', 'weekly', 'off']).optional(),
});
