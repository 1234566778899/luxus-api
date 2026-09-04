import { z } from 'zod';
import { ASSET_CATEGORIES } from '../constants/categories.js';
import { CATEGORY_SPECS } from '../constants/specs.js';
import { moneyUsd, richText, slug, uuid } from './common.js';

export const assetCategorySchema = z.enum(
  ASSET_CATEGORIES as unknown as [string, ...string[]],
) as z.ZodEnum<['real-estate', 'companies', 'vehicles', 'yachts', 'aircraft']>;
export const assetVisibilitySchema = z.enum(['verified', 'private', 'off_market']);
export const listingTierSchema = z.enum(['private', 'signature']);
export const assetStatusSchema = z.enum([
  'draft', 'pending_review', 'changes_requested', 'published', 'rejected', 'sold', 'archived',
]);

/**
 * Los schemas de specs se derivan de CATEGORY_SPECS para que el wizard, la
 * validación del endpoint y el Asset Passport nunca se desincronicen.
 */
function buildSpecSchema(category: (typeof ASSET_CATEGORIES)[number]) {
  const shape: Record<string, z.ZodTypeAny> = {};
  for (const field of CATEGORY_SPECS[category]) {
    let base: z.ZodTypeAny;
    switch (field.type) {
      case 'number':
        base = z.number().finite();
        break;
      case 'boolean':
        base = z.boolean();
        break;
      case 'tags':
        base = z.array(z.string().trim().min(1).max(80)).max(30);
        break;
      case 'select':
        base = field.options?.length
          ? z.enum(field.options as [string, ...string[]])
          : z.string().trim().max(200);
        break;
      default:
        base = z.string().trim().max(400);
    }
    shape[field.key] = field.required ? base : base.optional();
  }
  return z.object(shape).passthrough();
}

export const specSchemaByCategory = Object.fromEntries(
  ASSET_CATEGORIES.map((c) => [c, buildSpecSchema(c)]),
) as Record<(typeof ASSET_CATEGORIES)[number], ReturnType<typeof buildSpecSchema>>;

const assetBase = z.object({
  category: assetCategorySchema,
  title: z.string().trim().min(8).max(160),
  headline: z.string().trim().max(200).optional(),
  description_public: richText(6000),
  district: z.string().trim().max(120).optional(),
  province: z.string().trim().max(120).optional(),
  region: z.string().trim().max(120).optional(),
  country: z.string().trim().length(2).default('PE'),
  price_min: moneyUsd.optional(),
  price_max: moneyUsd.optional(),
  price_on_request: z.boolean().default(false),
  visibility: assetVisibilitySchema.default('verified'),
  tier: listingTierSchema.default('private'),
  broker_id: uuid.optional(),
  specs: z.record(z.unknown()).default({}),
});

/** Wizard de publicación: valida las specs contra la categoría elegida. */
export const createAssetSchema = assetBase
  .superRefine((value, ctx) => {
    if (
      value.price_min !== undefined &&
      value.price_max !== undefined &&
      value.price_min > value.price_max
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['price_max'],
        message: 'El máximo del rango no puede ser menor que el mínimo.',
      });
    }
    if (!value.price_on_request && value.price_min === undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['price_min'],
        message: 'Indique un rango de precio o marque «precio a consultar».',
      });
    }
    const specResult = specSchemaByCategory[value.category].safeParse(value.specs);
    if (!specResult.success) {
      for (const issue of specResult.error.issues) {
        ctx.addIssue({ ...issue, path: ['specs', ...issue.path] });
      }
    }
  });

export type CreateAssetInput = z.infer<typeof createAssetSchema>;

export const updateAssetSchema = assetBase.partial().extend({ id: uuid });

/** Datos Nivel II: solo se aceptan por la API, nunca desde el bundle público. */
export const assetPrivateDetailsSchema = z.object({
  price_exact: moneyUsd.optional(),
  price_negotiable: z.boolean().optional(),
  address_exact: z.string().trim().max(400).optional(),
  address_reference: z.string().trim().max(400).optional(),
  latitude: z.number().min(-90).max(90).optional(),
  longitude: z.number().min(-180).max(180).optional(),
  description_private: z.string().trim().max(8000).optional(),
  seller_notes: z.string().trim().max(4000).optional(),
  contact_name: z.string().trim().max(160).optional(),
  contact_phone: z.string().trim().max(40).optional(),
  contact_email: z.string().trim().email().optional(),
  registry_reference: z.string().trim().max(200).optional(),
  valuation_amount: moneyUsd.optional(),
  valuation_date: z.string().date().optional(),
  valuation_firm: z.string().trim().max(160).optional(),
});

/** Filtros de la colección pública. */
export const assetFilterSchema = z.object({
  category: assetCategorySchema.optional(),
  q: z.string().trim().max(120).optional(),
  region: z.string().trim().max(120).optional(),
  district: z.string().trim().max(120).optional(),
  visibility: assetVisibilitySchema.optional(),
  priceMin: z.coerce.number().nonnegative().optional(),
  priceMax: z.coerce.number().nonnegative().optional(),
  sort: z.enum(['recent', 'price_asc', 'price_desc', 'featured']).default('featured'),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(48).default(12),
});
export type AssetFilter = z.infer<typeof assetFilterSchema>;

export const assetSlugSchema = z.object({ slug });

export const enquirySchema = z.object({
  asset_id: uuid,
  name: z.string().trim().min(2).max(160),
  email: z.string().trim().email(),
  phone: z.string().trim().max(30).optional(),
  company: z.string().trim().max(160).optional(),
  message: z.string().trim().min(10).max(2000),
  /** Honeypot: debe llegar vacío. */
  website: z.string().max(0).optional(),
});
export type EnquiryInput = z.infer<typeof enquirySchema>;
