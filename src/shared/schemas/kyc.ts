import { z } from 'zod';
import { uuid } from './common.js';

export const kycDocumentTypeSchema = z.enum([
  'identity_front', 'identity_back', 'passport', 'proof_of_address',
  'source_of_funds', 'source_of_wealth', 'corporate_deed', 'ubo_declaration', 'other',
]);

/** Paso 1 — identidad declarada. */
export const kycIdentitySchema = z.object({
  legal_name: z.string().trim().min(4).max(200),
  document_type: z.enum(['DNI', 'CE', 'PASSPORT']),
  document_number: z.string().trim().min(6).max(30),
  nationality: z.string().trim().min(2).max(80),
  birth_date: z.string().date(),
  tax_residence: z.string().trim().min(2).max(80),
  occupation: z.string().trim().min(3).max(200),
});

/** Paso 2 — exposición política. */
export const kycPepSchema = z.object({
  is_pep: z.boolean(),
  pep_details: z.string().trim().max(2000).optional(),
}).superRefine((v, ctx) => {
  if (v.is_pep && !v.pep_details) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['pep_details'],
      message: 'Describa el cargo, la entidad y el periodo.',
    });
  }
});

export const NET_WORTH_BANDS = ['1-5M', '5-25M', '25-100M', '100M+'] as const;

/** Paso 3 — origen de fondos y patrimonio. */
export const kycFundsSchema = z.object({
  source_of_funds: z.string().trim().min(30, 'Detalle el origen de los fondos.').max(3000),
  source_of_wealth: z.string().trim().min(30, 'Detalle el origen del patrimonio.').max(3000),
  estimated_net_worth_band: z.enum(NET_WORTH_BANDS),
  funds_declaration: z
    .object({
      primary_source: z.string().trim().max(200).optional(),
      jurisdictions: z.array(z.string().trim().max(80)).max(20).optional(),
      expects_financing: z.boolean().optional(),
    })
    .default({}),
});

/** Paso 4 — documentos cargados. */
export const kycDocumentRefSchema = z.object({
  doc_type: kycDocumentTypeSchema,
  storage_path: z.string().trim().min(3).max(500),
  file_name: z.string().trim().max(255).optional(),
  mime_type: z.string().trim().max(120).optional(),
  size_bytes: z.number().int().positive().max(15 * 1024 * 1024).optional(),
});

export const kycSubmitSchema = z.object({
  case_id: uuid.optional(),
  identity: kycIdentitySchema,
  pep: kycPepSchema,
  funds: kycFundsSchema,
  documents: z.array(kycDocumentRefSchema).min(2, 'Cargue al menos identidad y origen de fondos.'),
  declarationAccepted: z.literal(true, {
    errorMap: () => ({ message: 'Debe declarar que la información es veraz.' }),
  }),
});
export type KycSubmitInput = z.infer<typeof kycSubmitSchema>;

export const kycDecisionSchema = z.object({
  case_id: uuid,
  decision: z.enum(['approved', 'rejected']),
  reviewer_notes: z.string().trim().max(2000).optional(),
  rejection_reason: z.string().trim().max(1000).optional(),
}).superRefine((v, ctx) => {
  if (v.decision === 'rejected' && !v.rejection_reason) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['rejection_reason'],
      message: 'Indique el motivo del rechazo.',
    });
  }
});
