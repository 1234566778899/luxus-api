-- ============================================================================
-- LUXUS PERÚ · 0000 — Extensions, schemas and enumerated domains
-- ============================================================================

create extension if not exists "pgcrypto"  with schema extensions;
create extension if not exists "citext"    with schema extensions;
create extension if not exists "pg_trgm"   with schema extensions;

-- Private schema for SECURITY DEFINER helpers used by RLS policies.
-- Nothing in here is exposed through PostgREST.
create schema if not exists luxus;
revoke all on schema luxus from public, anon, authenticated;
grant usage on schema luxus to authenticated, anon, service_role;

-- ── Identity & access ───────────────────────────────────────────────────────
create type public.user_role as enum ('buyer', 'seller', 'broker', 'admin');

create type public.membership_tier as enum ('none', 'private', 'black', 'family_office');

create type public.broker_plan as enum ('none', 'essential', 'professional', 'private_desk');

create type public.applicant_profile as enum ('buyer', 'family_office', 'seller', 'broker');

create type public.request_status as enum ('pending', 'approved', 'rejected');

-- ── Compliance ──────────────────────────────────────────────────────────────
create type public.kyc_status as enum (
  'not_started', 'in_progress', 'submitted', 'in_review', 'approved', 'rejected', 'expired'
);

create type public.screening_status as enum ('not_run', 'pending', 'clear', 'flagged', 'blocked');

create type public.kyc_document_type as enum (
  'identity_front', 'identity_back', 'passport', 'proof_of_address',
  'source_of_funds', 'source_of_wealth', 'corporate_deed', 'ubo_declaration', 'other'
);

-- ── Assets ──────────────────────────────────────────────────────────────────
create type public.asset_category as enum (
  'real-estate', 'companies', 'vehicles', 'yachts', 'aircraft'
);

-- Visibility posture chosen by the seller, orthogonal to review state.
create type public.asset_visibility as enum ('verified', 'private', 'off_market');

create type public.asset_status as enum (
  'draft', 'pending_review', 'changes_requested', 'published', 'rejected', 'sold', 'archived'
);

create type public.listing_tier as enum ('private', 'signature');

create type public.media_kind as enum ('image', 'video', 'floorplan', 'document_preview');

create type public.verification_item_status as enum ('pending', 'received', 'verified', 'rejected', 'not_applicable');

-- ── Deals ───────────────────────────────────────────────────────────────────
create type public.deal_stage as enum (
  'requested',      -- buyer asked for Deal Room access
  'kyc_review',     -- platform validates buyer KYC/screening
  'seller_review',  -- seller approves or denies
  'nda_pending',    -- NDA issued, awaiting signature
  'nda_signed',     -- NDA executed — Deal Room unlocked
  'qa',             -- active due-diligence Q&A
  'offer',          -- formal offer on the table
  'loi',            -- LOI issued / signed
  'due_diligence',  -- confirmatory DD
  'closing',        -- closing checklist / external escrow
  'closed',
  'declined',
  'withdrawn',
  'expired'
);

create type public.nda_status as enum ('draft', 'sent', 'viewed', 'signed', 'declined', 'expired', 'voided');

create type public.document_folder as enum (
  'corporate', 'financial', 'legal', 'tax', 'technical', 'commercial'
);

create type public.permission_level as enum ('view', 'download');

create type public.offer_status as enum ('submitted', 'countered', 'accepted', 'rejected', 'withdrawn', 'expired');

create type public.loi_status as enum ('draft', 'sent', 'signed', 'declined', 'expired');

-- ── Money ───────────────────────────────────────────────────────────────────
create type public.subscription_kind as enum ('membership', 'broker');

create type public.subscription_status as enum (
  'incomplete', 'trialing', 'active', 'past_due', 'canceled', 'unpaid', 'paused'
);

create type public.payment_kind as enum ('subscription', 'listing_fee', 'other');

create type public.payment_status as enum ('pending', 'paid', 'failed', 'refunded', 'canceled');

-- ── Content, CRM, comms ─────────────────────────────────────────────────────
create type public.article_status as enum ('draft', 'review', 'published', 'archived');

create type public.lead_kind as enum ('seller_pipeline', 'buyer_enquiry');

create type public.lead_stage as enum (
  'contacted', 'interested', 'documentation', 'approved', 'listed', 'lost'
);

create type public.notification_channel as enum ('in_app', 'email');
