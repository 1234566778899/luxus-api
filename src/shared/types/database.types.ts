/**
 * Tipos del esquema de Supabase.
 *
 * En un entorno con Supabase CLI este archivo se REGENERA con:
 *   npm run db:types
 * (supabase gen types typescript --local > packages/shared/src/types/database.types.ts)
 *
 * Se versiona escrito a mano para que el monorepo compile sin depender de que
 * la base de datos esté levantada. Debe mantenerse sincronizado con
 * supabase/migrations/*.sql — el script anterior es la fuente de verdad.
 */

export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

/** Azúcar para no repetir Row/Insert/Update en cada tabla. */
type Table<Row, Insert = Partial<Row>, Update = Partial<Row>> = {
  Row: Row;
  Insert: Insert;
  Update: Update;
  Relationships: [];
};

type Timestamps = { created_at: string; updated_at: string };

// ── Enums ───────────────────────────────────────────────────────────────────
export type UserRole = 'buyer' | 'seller' | 'broker' | 'admin';
export type MembershipTier = 'none' | 'private' | 'black' | 'family_office';
export type BrokerPlan = 'none' | 'essential' | 'professional' | 'private_desk';
export type ApplicantProfile = 'buyer' | 'family_office' | 'seller' | 'broker';
export type RequestStatus = 'pending' | 'approved' | 'rejected';

export type KycStatus =
  | 'not_started' | 'in_progress' | 'submitted' | 'in_review' | 'approved' | 'rejected' | 'expired';
export type ScreeningStatus = 'not_run' | 'pending' | 'clear' | 'flagged' | 'blocked';
export type KycDocumentType =
  | 'identity_front' | 'identity_back' | 'passport' | 'proof_of_address'
  | 'source_of_funds' | 'source_of_wealth' | 'corporate_deed' | 'ubo_declaration' | 'other';

export type AssetCategory = 'real-estate' | 'companies' | 'vehicles' | 'yachts' | 'aircraft';
export type AssetVisibility = 'verified' | 'private' | 'off_market';
export type AssetStatus =
  | 'draft' | 'pending_review' | 'changes_requested' | 'published' | 'rejected' | 'sold' | 'archived';
export type ListingTier = 'private' | 'signature';
export type MediaKind = 'image' | 'video' | 'floorplan' | 'document_preview';
export type VerificationItemStatus = 'pending' | 'received' | 'verified' | 'rejected' | 'not_applicable';

export type DealStage =
  | 'requested' | 'kyc_review' | 'seller_review' | 'nda_pending' | 'nda_signed'
  | 'qa' | 'offer' | 'loi' | 'due_diligence' | 'closing' | 'closed'
  | 'declined' | 'withdrawn' | 'expired';
export type NdaStatus = 'draft' | 'sent' | 'viewed' | 'signed' | 'declined' | 'expired' | 'voided';
export type DocumentFolder = 'corporate' | 'financial' | 'legal' | 'tax' | 'technical' | 'commercial';
export type PermissionLevel = 'view' | 'download';
export type OfferStatus = 'submitted' | 'countered' | 'accepted' | 'rejected' | 'withdrawn' | 'expired';
export type LoiStatus = 'draft' | 'sent' | 'signed' | 'declined' | 'expired';

export type SubscriptionKind = 'membership' | 'broker';
export type SubscriptionStatus =
  | 'incomplete' | 'trialing' | 'active' | 'past_due' | 'canceled' | 'unpaid' | 'paused';
export type PaymentKind = 'subscription' | 'listing_fee' | 'other';
export type PaymentStatus = 'pending' | 'paid' | 'failed' | 'refunded' | 'canceled';

export type ArticleStatus = 'draft' | 'review' | 'published' | 'archived';
export type LeadKind = 'seller_pipeline' | 'buyer_enquiry';
export type LeadStage = 'contacted' | 'interested' | 'documentation' | 'approved' | 'listed' | 'lost';

export type ComplaintKind = 'reclamo' | 'queja';
export type ComplaintStatus = 'received' | 'in_review' | 'responded' | 'closed';

// ── Rows ────────────────────────────────────────────────────────────────────
export type ProfileRow = Timestamps & {
  id: string;
  email: string;
  full_name: string | null;
  phone: string | null;
  role: UserRole;
  membership_tier: MembershipTier;
  broker_plan: BrokerPlan;
  kyc_status: KycStatus;
  screening_status: ScreeningStatus;
  country: string | null;
  city: string | null;
  language: string;
  access_level: 1 | 2 | 3;
  is_suspended: boolean;
  suspended_reason: string | null;
  mfa_enrolled: boolean;
  concierge_enabled: boolean;
  last_seen_at: string | null;
}

export type NotificationPreferencesRow = {
  user_id: string;
  email_deal_activity: boolean;
  email_qa: boolean;
  email_offers: boolean;
  email_kyc: boolean;
  email_billing: boolean;
  email_new_listings: boolean;
  email_expiry_alerts: boolean;
  in_app_enabled: boolean;
  digest_frequency: 'instant' | 'daily' | 'weekly' | 'off';
  updated_at: string;
}

export type BrokerRow = Timestamps & {
  id: string;
  user_id: string;
  slug: string;
  company_name: string;
  ruc: string | null;
  legal_rep: string | null;
  website: string | null;
  phone: string | null;
  office_address: string | null;
  bio: string | null;
  logo_path: string | null;
  is_verified: boolean;
  verified_at: string | null;
  verified_by: string | null;
  listing_quota: number;
}

export type PrivateAccessRequestRow = {
  id: string;
  applicant_profile: ApplicantProfile;
  full_name: string;
  email: string;
  phone: string | null;
  company: string | null;
  country: string | null;
  city: string | null;
  interest: string | null;
  budget_range: string | null;
  message: string | null;
  source: string | null;
  status: RequestStatus;
  reviewed_by: string | null;
  reviewed_at: string | null;
  review_notes: string | null;
  invited_at: string | null;
  invited_user_id: string | null;
  ip_address: string | null;
  user_agent: string | null;
  created_at: string;
}

export type UserSessionRow = {
  id: string;
  user_id: string;
  session_id: string | null;
  ip_address: string | null;
  user_agent: string | null;
  device_label: string | null;
  created_at: string;
  last_seen_at: string;
  revoked_at: string | null;
}

/** Nivel I — todo lo que puede leer un visitante anónimo. */
export type AssetRow = Timestamps & {
  id: string;
  slug: string;
  reference_code: string;
  owner_id: string;
  broker_id: string | null;
  category: AssetCategory;
  title: string;
  headline: string | null;
  description_public: string;
  district: string | null;
  province: string | null;
  region: string | null;
  country: string;
  price_currency: string;
  price_min: number | null;
  price_max: number | null;
  price_on_request: boolean;
  visibility: AssetVisibility;
  status: AssetStatus;
  tier: ListingTier;
  specs: Json;
  ownership_verified: boolean;
  registry_reviewed: boolean;
  documentation_reviewed: boolean;
  valuation_available: boolean;
  verification_notes: string | null;
  verified_at: string | null;
  verified_by: string | null;
  is_featured: boolean;
  featured_rank: number | null;
  view_count: number;
  enquiry_count: number;
  published_at: string | null;
  sold_at: string | null;
  archived_at: string | null;
}

/** Nivel II/III — nunca alcanzable por `anon`. */
export type AssetPrivateDetailsRow = {
  asset_id: string;
  price_exact: number | null;
  price_currency: string;
  price_negotiable: boolean;
  address_exact: string | null;
  address_reference: string | null;
  latitude: number | null;
  longitude: number | null;
  description_private: string | null;
  seller_notes: string | null;
  contact_name: string | null;
  contact_phone: string | null;
  contact_email: string | null;
  registry_reference: string | null;
  tax_reference: string | null;
  annual_costs: number | null;
  valuation_amount: number | null;
  valuation_date: string | null;
  valuation_firm: string | null;
  updated_at: string;
}

export type AssetMediaRow = {
  id: string;
  asset_id: string;
  kind: MediaKind;
  bucket: string;
  storage_path: string;
  is_public: boolean;
  caption: string | null;
  alt_text: string | null;
  width: number | null;
  height: number | null;
  sort_order: number;
  created_at: string;
}

export type AssetVerificationItemRow = {
  id: string;
  asset_id: string;
  item_key: string;
  label: string;
  authority: string | null;
  required: boolean;
  status: VerificationItemStatus;
  notes: string | null;
  document_id: string | null;
  checked_by: string | null;
  checked_at: string | null;
  created_at: string;
}

export type WatchlistRow = {
  user_id: string;
  asset_id: string;
  note: string | null;
  created_at: string;
}

export type AssetViewRow = {
  id: number;
  asset_id: string;
  viewer_id: string | null;
  is_member: boolean;
  referrer: string | null;
  created_at: string;
}

export type KycCaseRow = Timestamps & {
  id: string;
  user_id: string;
  status: KycStatus;
  provider: string;
  provider_ref: string | null;
  provider_payload: Json;
  legal_name: string | null;
  document_type: string | null;
  document_number: string | null;
  nationality: string | null;
  birth_date: string | null;
  is_pep: boolean | null;
  pep_details: string | null;
  tax_residence: string | null;
  occupation: string | null;
  source_of_funds: string | null;
  source_of_wealth: string | null;
  estimated_net_worth_band: string | null;
  funds_declaration: Json;
  reviewer_id: string | null;
  reviewer_notes: string | null;
  rejection_reason: string | null;
  requires_manual_review: boolean;
  submitted_at: string | null;
  decided_at: string | null;
  expires_at: string | null;
}

export type KycDocumentRow = {
  id: string;
  case_id: string;
  user_id: string;
  doc_type: KycDocumentType;
  bucket: string;
  storage_path: string;
  file_name: string | null;
  mime_type: string | null;
  size_bytes: number | null;
  sha256: string | null;
  uploaded_at: string;
}

export type ScreeningCheckRow = {
  id: string;
  user_id: string;
  kyc_case_id: string | null;
  provider: string;
  provider_ref: string | null;
  status: ScreeningStatus;
  lists_checked: string[];
  match_count: number;
  matches: Json;
  risk_score: number | null;
  reviewer_id: string | null;
  reviewer_notes: string | null;
  ran_at: string;
  reviewed_at: string | null;
}

export type DealRow = Timestamps & {
  id: string;
  reference_code: string;
  asset_id: string;
  buyer_id: string;
  seller_id: string;
  broker_id: string | null;
  stage: DealStage;
  stage_changed_at: string;
  request_message: string | null;
  intended_use: string | null;
  financing_type: string | null;
  proof_of_funds: boolean;
  decline_reason: string | null;
  declined_by: string | null;
  requested_at: string;
  kyc_cleared_at: string | null;
  approved_at: string | null;
  approved_by: string | null;
  nda_signed_at: string | null;
  opened_at: string | null;
  closed_at: string | null;
  expires_at: string | null;
  closing_checklist: Json;
  closing_notes: string | null;
  final_amount: number | null;
  final_currency: string | null;
  success_fee_pct: number | null;
  success_fee_amount: number | null;
  success_fee_invoiced: boolean;
}

export type DealStageHistoryRow = {
  id: number;
  deal_id: string;
  from_stage: DealStage | null;
  to_stage: DealStage;
  actor_id: string | null;
  reason: string | null;
  created_at: string;
}

export type NdaRow = Timestamps & {
  id: string;
  deal_id: string;
  status: NdaStatus;
  provider: string;
  provider_envelope_id: string | null;
  template_version: string;
  bucket: string;
  draft_path: string | null;
  signed_path: string | null;
  signed_sha256: string | null;
  signer_name: string | null;
  signer_email: string | null;
  signer_ip: string | null;
  sent_at: string | null;
  viewed_at: string | null;
  signed_at: string | null;
  expires_at: string | null;
  provider_audit: Json;
}

export type DocumentRow = Timestamps & {
  id: string;
  asset_id: string;
  folder: DocumentFolder;
  subfolder: string | null;
  name: string;
  description: string | null;
  is_confidential: boolean;
  verification_key: string | null;
  current_version_id: string | null;
  version_count: number;
  created_by: string;
  deleted_at: string | null;
}

export type DocumentVersionRow = {
  id: string;
  document_id: string;
  version: number;
  bucket: string;
  storage_path: string;
  file_name: string;
  mime_type: string;
  size_bytes: number | null;
  sha256: string | null;
  page_count: number | null;
  change_note: string | null;
  uploaded_by: string;
  created_at: string;
}

export type DocumentPermissionRow = {
  id: string;
  document_id: string;
  deal_id: string;
  user_id: string;
  level: PermissionLevel;
  granted_by: string;
  granted_at: string;
  expires_at: string | null;
  revoked_at: string | null;
  revoked_by: string | null;
  revoke_reason: string | null;
  expiry_notified_at: string | null;
  view_count: number;
  download_count: number;
  last_accessed_at: string | null;
}

export type QaThreadRow = {
  id: string;
  deal_id: string;
  subject: string;
  document_id: string | null;
  folder: DocumentFolder | null;
  created_by: string;
  is_resolved: boolean;
  resolved_at: string | null;
  last_message_at: string;
  message_count: number;
  created_at: string;
}

export type QaMessageRow = {
  id: string;
  thread_id: string;
  deal_id: string;
  author_id: string;
  body: string;
  attachment_document_id: string | null;
  read_by: string[];
  created_at: string;
  edited_at: string | null;
}

export type OfferRow = {
  id: string;
  deal_id: string;
  author_id: string;
  parent_offer_id: string | null;
  round: number;
  amount: number;
  currency: string;
  payment_structure: string | null;
  deposit_amount: number | null;
  conditions: string | null;
  dd_period_days: number | null;
  exclusivity_days: number | null;
  valid_until: string | null;
  status: OfferStatus;
  responded_by: string | null;
  responded_at: string | null;
  response_note: string | null;
  created_at: string;
}

export type LoiRow = Timestamps & {
  id: string;
  deal_id: string;
  offer_id: string;
  status: LoiStatus;
  template_version: string;
  terms: Json;
  bucket: string;
  draft_path: string | null;
  signed_path: string | null;
  signed_sha256: string | null;
  provider: string;
  provider_envelope_id: string | null;
  sent_at: string | null;
  signed_at: string | null;
  expires_at: string | null;
  created_by: string;
}

export type AuditLogRow = {
  id: number;
  actor_id: string | null;
  actor_email: string | null;
  actor_role: UserRole | null;
  action: string;
  entity_type: string | null;
  entity_id: string | null;
  deal_id: string | null;
  asset_id: string | null;
  document_id: string | null;
  document_version: number | null;
  ip_address: string | null;
  user_agent: string | null;
  metadata: Json;
  created_at: string;
}

export type PlanRow = {
  code: string;
  kind: SubscriptionKind;
  name: string;
  tagline: string | null;
  amount_cents: number;
  currency: string;
  interval: 'month' | 'year';
  listing_quota: number | null;
  placement_rank: number;
  benefits: Json;
  stripe_price_id: string | null;
  is_active: boolean;
  sort_order: number;
}

export type SubscriptionRow = Timestamps & {
  id: string;
  user_id: string;
  kind: SubscriptionKind;
  plan_code: string;
  status: SubscriptionStatus;
  provider: string;
  provider_customer_id: string | null;
  provider_subscription_id: string | null;
  current_period_start: string | null;
  current_period_end: string | null;
  cancel_at_period_end: boolean;
  canceled_at: string | null;
  trial_end: string | null;
}

export type PaymentRow = {
  id: string;
  user_id: string;
  kind: PaymentKind;
  status: PaymentStatus;
  subscription_id: string | null;
  asset_id: string | null;
  plan_code: string | null;
  description: string | null;
  amount_cents: number;
  currency: string;
  provider: string;
  provider_payment_id: string | null;
  provider_invoice_id: string | null;
  receipt_url: string | null;
  receipt_number: string | null;
  paid_at: string | null;
  refunded_at: string | null;
  metadata: Json;
  created_at: string;
}

export type ListingFeeRow = {
  id: string;
  asset_id: string;
  tier: ListingTier;
  amount_cents: number;
  currency: string;
  status: PaymentStatus;
  payment_id: string | null;
  quoted_by: string | null;
  quoted_at: string;
  due_at: string | null;
  notes: string | null;
}

export type ArticleRow = Timestamps & {
  id: string;
  slug: string;
  title: string;
  subtitle: string | null;
  excerpt: string | null;
  body_md: string;
  cover_bucket: string | null;
  cover_path: string | null;
  cover_alt: string | null;
  category: string | null;
  tags: string[];
  reading_time: number | null;
  status: ArticleStatus;
  is_members_only: boolean;
  author_id: string | null;
  author_name: string | null;
  seo: Json;
  published_at: string | null;
}

export type LeadRow = Timestamps & {
  id: string;
  kind: LeadKind;
  stage: LeadStage;
  name: string;
  email: string | null;
  phone: string | null;
  company: string | null;
  category: AssetCategory | null;
  asset_id: string | null;
  estimated_value: number | null;
  source: string | null;
  message: string | null;
  assigned_to: string | null;
  next_action: string | null;
  next_action_at: string | null;
  converted_user_id: string | null;
  lost_reason: string | null;
  created_by: string | null;
}

export type LeadNoteRow = {
  id: string;
  lead_id: string;
  author_id: string;
  body: string;
  created_at: string;
}

export type NotificationRow = {
  id: string;
  user_id: string;
  type: string;
  title: string;
  body: string | null;
  link: string | null;
  deal_id: string | null;
  asset_id: string | null;
  severity: 'info' | 'success' | 'warning' | 'critical';
  read_at: string | null;
  created_at: string;
}

export type EmailLogRow = {
  id: string;
  user_id: string | null;
  to_email: string;
  template: string;
  subject: string;
  provider: string;
  provider_ref: string | null;
  status: string;
  error: string | null;
  payload: Json;
  created_at: string;
}

export type WebhookEventRow = {
  id: string;
  provider: string;
  event_id: string;
  event_type: string;
  payload: Json;
  processed_at: string | null;
  error: string | null;
  received_at: string;
}

export type ComplaintEntryRow = {
  id: string;
  entry_number: number;
  kind: ComplaintKind;
  full_name: string;
  document_type: string;
  document_number: string;
  email: string;
  phone: string | null;
  address: string | null;
  is_minor: boolean;
  guardian_name: string | null;
  product_or_service: string;
  asset_id: string | null;
  amount: number | null;
  detail: string;
  requested_action: string | null;
  status: ComplaintStatus;
  response_text: string | null;
  responded_by: string | null;
  responded_at: string | null;
  source: string;
  ip_address: string | null;
  user_agent: string | null;
  created_at: string;
  updated_at: string;
}

export type ListingFeeBandRow = {
  tier: ListingTier;
  min_cents: number;
  max_cents: number;
  currency: string;
  description: string | null;
}

// ── Database ────────────────────────────────────────────────────────────────
export type Database = {
  public: {
    Tables: {
      profiles: Table<ProfileRow, Partial<ProfileRow> & { id: string; email: string }>;
      notification_preferences: Table<NotificationPreferencesRow>;
      brokers: Table<BrokerRow>;
      private_access_requests: Table<PrivateAccessRequestRow>;
      user_sessions: Table<UserSessionRow>;
      assets: Table<AssetRow>;
      asset_private_details: Table<AssetPrivateDetailsRow>;
      asset_media: Table<AssetMediaRow>;
      asset_verification_items: Table<AssetVerificationItemRow>;
      watchlist: Table<WatchlistRow>;
      asset_views: Table<AssetViewRow>;
      kyc_cases: Table<KycCaseRow>;
      kyc_documents: Table<KycDocumentRow>;
      screening_checks: Table<ScreeningCheckRow>;
      deals: Table<DealRow>;
      deal_stage_history: Table<DealStageHistoryRow>;
      ndas: Table<NdaRow>;
      documents: Table<DocumentRow>;
      document_versions: Table<DocumentVersionRow>;
      document_permissions: Table<DocumentPermissionRow>;
      qa_threads: Table<QaThreadRow>;
      qa_messages: Table<QaMessageRow>;
      offers: Table<OfferRow>;
      lois: Table<LoiRow>;
      audit_logs: Table<AuditLogRow>;
      plans: Table<PlanRow>;
      subscriptions: Table<SubscriptionRow>;
      payments: Table<PaymentRow>;
      listing_fees: Table<ListingFeeRow>;
      listing_fee_bands: Table<ListingFeeBandRow>;
      articles: Table<ArticleRow>;
      leads: Table<LeadRow>;
      lead_notes: Table<LeadNoteRow>;
      notifications: Table<NotificationRow>;
      email_log: Table<EmailLogRow>;
      webhook_events: Table<WebhookEventRow>;
      complaint_entries: Table<ComplaintEntryRow>;
    };
    Views: Record<string, never>;
    Functions: {
      expire_document_permissions: {
        Args: Record<string, never>;
        Returns: { expired_permissions: number; expired_deals: number }[];
      };
      seed_verification_checklist: { Args: { p_asset_id: string }; Returns: undefined };
    };
    Enums: {
      user_role: UserRole;
      asset_category: AssetCategory;
      deal_stage: DealStage;
      document_folder: DocumentFolder;
    };
    CompositeTypes: Record<string, never>;
  };
}

export type Tables<T extends keyof Database['public']['Tables']> =
  Database['public']['Tables'][T]['Row'];
export type TablesInsert<T extends keyof Database['public']['Tables']> =
  Database['public']['Tables'][T]['Insert'];
export type TablesUpdate<T extends keyof Database['public']['Tables']> =
  Database['public']['Tables'][T]['Update'];
