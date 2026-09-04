import { z } from 'zod';

export const uuid = z.string().uuid();
export const email = z.string().trim().toLowerCase().email().max(254);
export const isoDate = z.string().datetime({ offset: true });

/** Teléfono internacional laxo; el formato peruano se normaliza en la API. */
export const phone = z
  .string()
  .trim()
  .min(7)
  .max(24)
  .regex(/^[+0-9 ()\-.]+$/, 'Formato de teléfono no válido');

export const ruc = z.string().regex(/^[0-9]{11}$/, 'El RUC debe tener 11 dígitos');

export const dni = z.string().regex(/^[0-9]{8}$/, 'El DNI debe tener 8 dígitos');

export const slug = z
  .string()
  .min(3)
  .max(120)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'Slug no válido');

export const currency = z.enum(['USD', 'PEN']);

export const moneyUsd = z.number().finite().nonnegative().max(1_000_000_000);

export const pagination = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(24),
});
export type Pagination = z.infer<typeof pagination>;

/** Texto libre saneado: recorta y limita longitud para evitar payloads absurdos. */
export const richText = (max = 5000) => z.string().trim().min(1).max(max);

export const okResponse = z.object({ ok: z.literal(true) });

export const errorResponse = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
    details: z.unknown().optional(),
  }),
});
