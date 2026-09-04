import { z } from 'zod';
import { moneyUsd, richText, uuid } from './common.js';
import { DOCUMENT_FOLDERS } from '../constants/deal.js';

export const dealStageSchema = z.enum([
  'requested', 'kyc_review', 'seller_review', 'nda_pending', 'nda_signed',
  'qa', 'offer', 'loi', 'due_diligence', 'closing', 'closed',
  'declined', 'withdrawn', 'expired',
]);

export const documentFolderSchema = z.enum(
  DOCUMENT_FOLDERS as unknown as [string, ...string[]],
) as z.ZodEnum<['corporate', 'financial', 'legal', 'tax', 'technical', 'commercial']>;

export const requestDealAccessSchema = z.object({
  asset_id: uuid,
  request_message: richText(2000),
  intended_use: z.string().trim().max(300).optional(),
  financing_type: z.enum(['cash', 'financed', 'mixed']).default('cash'),
  proof_of_funds: z.boolean().default(false),
});
export type RequestDealAccessInput = z.infer<typeof requestDealAccessSchema>;

export const dealDecisionSchema = z.object({
  deal_id: uuid,
  decision: z.enum(['approve', 'decline']),
  decline_reason: z.string().trim().max(1000).optional(),
  /** Días de vigencia del acceso al Deal Room, 0 = sin vencimiento. */
  access_days: z.number().int().min(0).max(365).default(90),
}).superRefine((v, ctx) => {
  if (v.decision === 'decline' && !v.decline_reason) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['decline_reason'],
      message: 'Indique el motivo para el comprador.',
    });
  }
});

export const advanceStageSchema = z.object({
  deal_id: uuid,
  to_stage: dealStageSchema,
  reason: z.string().trim().max(500).optional(),
});

export const closingChecklistSchema = z.object({
  deal_id: uuid,
  items: z.array(
    z.object({
      key: z.string().trim().min(1).max(60),
      label: z.string().trim().min(1).max(200),
      status: z.enum(['pending', 'in_progress', 'done', 'not_applicable']),
      owner: z.enum(['buyer', 'seller', 'both']),
      note: z.string().trim().max(500).optional(),
    }),
  ).max(30),
  closing_notes: z.string().trim().max(3000).optional(),
  final_amount: moneyUsd.optional(),
  success_fee_pct: z.number().min(0).max(20).optional(),
});

// ── Documentos ─────────────────────────────────────────────────────────────
export const createDocumentSchema = z.object({
  asset_id: uuid,
  folder: documentFolderSchema,
  subfolder: z.string().trim().max(120).optional(),
  name: z.string().trim().min(3).max(255),
  description: z.string().trim().max(1000).optional(),
  verification_key: z.string().trim().max(60).optional(),
});

export const uploadVersionSchema = z.object({
  document_id: uuid,
  storage_path: z.string().trim().min(3).max(500),
  file_name: z.string().trim().min(1).max(255),
  mime_type: z.string().trim().max(120).default('application/pdf'),
  size_bytes: z.number().int().positive().max(100 * 1024 * 1024).optional(),
  sha256: z.string().regex(/^[a-f0-9]{64}$/).optional(),
  change_note: z.string().trim().max(500).optional(),
});

export const restoreVersionSchema = z.object({
  document_id: uuid,
  version: z.number().int().min(1),
  change_note: z.string().trim().max(500).optional(),
});

export const grantPermissionSchema = z.object({
  deal_id: uuid,
  user_id: uuid,
  document_ids: z.array(uuid).min(1).max(200),
  level: z.enum(['view', 'download']).default('view'),
  /** 0 = sin vencimiento. */
  expires_in_days: z.number().int().min(0).max(365).default(30),
});

export const revokePermissionSchema = z.object({
  permission_id: uuid,
  reason: z.string().trim().max(300).optional(),
});

export const documentAccessSchema = z.object({
  document_id: uuid,
  version: z.coerce.number().int().min(1).optional(),
  intent: z.enum(['view', 'download']).default('view'),
});

// ── Q&A ────────────────────────────────────────────────────────────────────
export const createThreadSchema = z.object({
  deal_id: uuid,
  subject: z.string().trim().min(5).max(200),
  body: richText(4000),
  document_id: uuid.optional(),
  folder: documentFolderSchema.optional(),
});

export const postMessageSchema = z.object({
  thread_id: uuid,
  body: richText(4000),
  attachment_document_id: uuid.optional(),
});

// ── Ofertas y LOI ──────────────────────────────────────────────────────────
export const createOfferSchema = z.object({
  deal_id: uuid,
  amount: moneyUsd.refine((v) => v > 0, 'El importe debe ser mayor que cero.'),
  currency: z.enum(['USD', 'PEN']).default('USD'),
  payment_structure: z.enum(['cash', 'escrow', 'earn-out', 'mixed', 'financed']).default('cash'),
  deposit_amount: moneyUsd.optional(),
  conditions: z.string().trim().max(4000).optional(),
  dd_period_days: z.number().int().min(0).max(365).optional(),
  exclusivity_days: z.number().int().min(0).max(365).optional(),
  valid_until: z.string().datetime({ offset: true }).optional(),
  parent_offer_id: uuid.optional(),
});
export type CreateOfferInput = z.infer<typeof createOfferSchema>;

export const respondOfferSchema = z.object({
  offer_id: uuid,
  action: z.enum(['accept', 'reject', 'counter']),
  response_note: z.string().trim().max(2000).optional(),
  counter: createOfferSchema.omit({ deal_id: true, parent_offer_id: true }).optional(),
}).superRefine((v, ctx) => {
  if (v.action === 'counter' && !v.counter) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['counter'],
      message: 'Indique los términos de la contraoferta.',
    });
  }
});

export const generateLoiSchema = z.object({
  offer_id: uuid,
  terms: z.object({
    purchase_price: moneyUsd,
    currency: z.enum(['USD', 'PEN']).default('USD'),
    structure: z.string().trim().max(500),
    deposit_amount: moneyUsd.optional(),
    dd_period_days: z.number().int().min(0).max(365),
    exclusivity_days: z.number().int().min(0).max(365),
    conditions_precedent: z.array(z.string().trim().max(300)).max(20).default([]),
    governing_law: z.string().trim().max(120).default('República del Perú'),
    dispute_resolution: z.string().trim().max(300).default(
      'Arbitraje de derecho ante el Centro de Arbitraje de la Cámara de Comercio de Lima',
    ),
    expiry_days: z.number().int().min(1).max(120).default(30),
  }),
});
