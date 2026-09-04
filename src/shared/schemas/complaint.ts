import { z } from 'zod';
import { email, phone, uuid } from './common.js';

/**
 * Hoja de reclamación virtual (Libro de Reclamaciones, D.S. N.º 011-2011-PCM
 * y modificatorias). `is_minor` exige los datos del padre/madre o apoderado
 * en `guardian_name`, tal como pide el formato oficial para reclamantes
 * menores de edad.
 */
export const complaintSchema = z
  .object({
    kind: z.enum(['reclamo', 'queja']),
    full_name: z.string().trim().min(3).max(160),
    document_type: z.enum(['DNI', 'CE', 'PASSPORT']).default('DNI'),
    document_number: z.string().trim().min(6).max(20),
    email,
    phone: phone.optional(),
    address: z.string().trim().max(240).optional(),
    is_minor: z.boolean().default(false),
    guardian_name: z.string().trim().min(3).max(160).optional(),
    product_or_service: z.string().trim().min(3).max(200),
    asset_id: uuid.optional(),
    amount: z.number().finite().nonnegative().max(1_000_000_000).optional(),
    detail: z.string().trim().min(20).max(4000),
    requested_action: z.string().trim().max(1000).optional(),
    /** Honeypot anti-bot: si viene con contenido, se descarta el envío. */
    website: z.string().max(0).optional(),
  })
  .refine((data) => !data.is_minor || !!data.guardian_name, {
    message: 'Indique el nombre del padre, madre o apoderado del menor.',
    path: ['guardian_name'],
  });

export type ComplaintInput = z.infer<typeof complaintSchema>;

export const respondComplaintSchema = z.object({
  entry_id: uuid,
  status: z.enum(['in_review', 'responded', 'closed']),
  response_text: z.string().trim().min(10).max(4000).optional(),
});

export type RespondComplaintInput = z.infer<typeof respondComplaintSchema>;
