import { z } from 'zod';
import { email, richText, slug, uuid } from './common.js';

export const reviewAccessRequestSchema = z.object({
  request_id: uuid,
  decision: z.enum(['approve', 'reject']),
  role: z.enum(['buyer', 'seller', 'broker']).default('buyer'),
  review_notes: z.string().trim().max(1000).optional(),
});

export const verifyAssetSchema = z.object({
  asset_id: uuid,
  decision: z.enum(['publish', 'request_changes', 'reject']),
  checklist: z.array(
    z.object({
      item_key: z.string().trim().min(1).max(60),
      status: z.enum(['pending', 'received', 'verified', 'rejected', 'not_applicable']),
      notes: z.string().trim().max(500).optional(),
    }),
  ).max(60).default([]),
  ownership_verified: z.boolean().optional(),
  registry_reviewed: z.boolean().optional(),
  documentation_reviewed: z.boolean().optional(),
  valuation_available: z.boolean().optional(),
  reason: z.string().trim().max(1000).optional(),
  listing_fee_cents: z.number().int().min(0).max(2_000_000).optional(),
}).superRefine((v, ctx) => {
  if (v.decision !== 'publish' && !v.reason) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['reason'],
      message: 'Indique el motivo que verá el vendedor.',
    });
  }
});

export const manageUserSchema = z.object({
  user_id: uuid,
  role: z.enum(['buyer', 'seller', 'broker', 'admin']).optional(),
  membership_tier: z.enum(['none', 'private', 'black', 'family_office']).optional(),
  is_suspended: z.boolean().optional(),
  suspended_reason: z.string().trim().max(500).optional(),
});

export const auditQuerySchema = z.object({
  action: z.string().trim().max(60).optional(),
  actor_id: uuid.optional(),
  deal_id: uuid.optional(),
  asset_id: uuid.optional(),
  document_id: uuid.optional(),
  from: z.string().datetime({ offset: true }).optional(),
  to: z.string().datetime({ offset: true }).optional(),
  format: z.enum(['json', 'csv']).default('json'),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(500).default(100),
});

// ── CMS Intelligence ───────────────────────────────────────────────────────
export const articleSchema = z.object({
  slug,
  title: z.string().trim().min(8).max(200),
  subtitle: z.string().trim().max(300).optional(),
  excerpt: z.string().trim().max(600).optional(),
  body_md: richText(60_000),
  cover_path: z.string().trim().max(500).optional(),
  cover_alt: z.string().trim().max(200).optional(),
  category: z.enum(['Market Report', 'Regulation', 'Sector', 'Wealth']).optional(),
  tags: z.array(z.string().trim().max(40)).max(12).default([]),
  status: z.enum(['draft', 'review', 'published', 'archived']).default('draft'),
  is_members_only: z.boolean().default(false),
  seo: z.object({
    title: z.string().trim().max(200).optional(),
    description: z.string().trim().max(400).optional(),
    og_image: z.string().trim().max(500).optional(),
  }).default({}),
});
export type ArticleInput = z.infer<typeof articleSchema>;

// ── CRM ────────────────────────────────────────────────────────────────────
export const leadSchema = z.object({
  kind: z.enum(['seller_pipeline', 'buyer_enquiry']),
  stage: z.enum(['contacted', 'interested', 'documentation', 'approved', 'listed', 'lost']).default('contacted'),
  name: z.string().trim().min(2).max(200),
  email: email.optional(),
  phone: z.string().trim().max(30).optional(),
  company: z.string().trim().max(200).optional(),
  category: z.enum(['real-estate', 'companies', 'vehicles', 'yachts', 'aircraft']).optional(),
  asset_id: uuid.optional(),
  estimated_value: z.number().nonnegative().max(1_000_000_000).optional(),
  source: z.string().trim().max(80).optional(),
  message: z.string().trim().max(4000).optional(),
  assigned_to: uuid.optional(),
  next_action: z.string().trim().max(300).optional(),
  next_action_at: z.string().datetime({ offset: true }).optional(),
  lost_reason: z.string().trim().max(500).optional(),
});

export const leadNoteSchema = z.object({
  lead_id: uuid,
  body: richText(3000),
});
