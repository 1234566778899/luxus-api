import { z } from 'zod';
import { uuid } from './common.js';

export const checkoutSchema = z.object({
  plan_code: z.string().trim().min(3).max(60),
  success_url: z.string().url().optional(),
  cancel_url: z.string().url().optional(),
});

export const listingFeeCheckoutSchema = z.object({
  asset_id: uuid,
  success_url: z.string().url().optional(),
  cancel_url: z.string().url().optional(),
});

export const portalSchema = z.object({
  return_url: z.string().url().optional(),
});
