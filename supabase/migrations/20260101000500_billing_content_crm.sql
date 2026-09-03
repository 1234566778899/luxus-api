-- ============================================================================
-- LUXUS PERÚ · 0500 — Monetización, contenido, CRM, notificaciones, auditoría
-- ============================================================================

-- ── Planes (catálogo en base de datos, referenciado por Stripe price ids) ──
create table public.plans (
  code            text primary key,       -- membership_private | broker_essential | ...
  kind            public.subscription_kind not null,
  name            text not null,
  tagline         text,
  amount_cents    integer not null,
  currency        char(3) not null default 'USD',
  interval        text not null check (interval in ('month','year')),
  listing_quota   integer,
  placement_rank  integer not null default 0,
  benefits        jsonb not null default '[]'::jsonb,
  stripe_price_id text,
  is_active       boolean not null default true,
  sort_order      integer not null default 0
);

create table public.subscriptions (
  id                     uuid primary key default extensions.gen_random_uuid(),
  user_id                uuid not null references public.profiles(id) on delete cascade,
  kind                   public.subscription_kind not null,
  plan_code              text not null references public.plans(code),
  status                 public.subscription_status not null default 'incomplete',
  provider               text not null default 'stripe',
  provider_customer_id   text,
  provider_subscription_id text unique,
  current_period_start   timestamptz,
  current_period_end     timestamptz,
  cancel_at_period_end   boolean not null default false,
  canceled_at            timestamptz,
  trial_end              timestamptz,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now()
);

create index subs_user_idx on public.subscriptions (user_id, status);
create unique index subs_one_active_per_kind
  on public.subscriptions (user_id, kind)
  where status in ('trialing','active','past_due');

create table public.payments (
  id                 uuid primary key default extensions.gen_random_uuid(),
  user_id            uuid not null references public.profiles(id) on delete cascade,
  kind               public.payment_kind not null,
  status             public.payment_status not null default 'pending',
  subscription_id    uuid references public.subscriptions(id) on delete set null,
  asset_id           uuid references public.assets(id) on delete set null,
  plan_code          text references public.plans(code),
  description        text,
  amount_cents       integer not null,
  currency           char(3) not null default 'USD',
  provider           text not null default 'stripe',
  provider_payment_id text unique,
  provider_invoice_id text,
  receipt_url        text,
  receipt_number     text,
  paid_at            timestamptz,
  refunded_at        timestamptz,
  metadata           jsonb not null default '{}'::jsonb,
  created_at         timestamptz not null default now()
);

create index payments_user_idx on public.payments (user_id, created_at desc);

-- Listing fee acordado por activo (se cobra al aprobar la publicación)
create table public.listing_fees (
  id          uuid primary key default extensions.gen_random_uuid(),
  asset_id    uuid not null references public.assets(id) on delete cascade,
  tier        public.listing_tier not null,
  amount_cents integer not null,
  currency    char(3) not null default 'USD',
  status      public.payment_status not null default 'pending',
  payment_id  uuid references public.payments(id) on delete set null,
  quoted_by   uuid references public.profiles(id),
  quoted_at   timestamptz not null default now(),
  due_at      timestamptz,
  notes       text
);

create index listing_fees_asset_idx on public.listing_fees (asset_id);

-- Idempotencia de webhooks (Stripe y firma electrónica)
create table public.webhook_events (
  id           uuid primary key default extensions.gen_random_uuid(),
  provider     text not null,
  event_id     text not null,
  event_type   text not null,
  payload      jsonb not null,
  processed_at timestamptz,
  error        text,
  received_at  timestamptz not null default now(),
  unique (provider, event_id)
);

-- ── Intelligence (CMS propio) ──────────────────────────────────────────────
create table public.articles (
  id            uuid primary key default extensions.gen_random_uuid(),
  slug          text not null unique,
  title         text not null,
  subtitle      text,
  excerpt       text,
  body_md       text not null default '',
  cover_bucket  text default 'intelligence',
  cover_path    text,
  cover_alt     text,
  category      text,                    -- Market Report | Regulation | Sector | Wealth
  tags          text[] not null default '{}',
  reading_time  integer,
  status        public.article_status not null default 'draft',
  is_members_only boolean not null default false,
  author_id     uuid references public.profiles(id) on delete set null,
  author_name   text,
  seo           jsonb not null default '{}'::jsonb,   -- title, description, og_image
  published_at  timestamptz,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create index articles_published_idx on public.articles (status, published_at desc);

-- ── CRM ligero ─────────────────────────────────────────────────────────────
create table public.leads (
  id            uuid primary key default extensions.gen_random_uuid(),
  kind          public.lead_kind not null,
  stage         public.lead_stage not null default 'contacted',
  name          text not null,
  email         extensions.citext,
  phone         text,
  company       text,
  category      public.asset_category,
  asset_id      uuid references public.assets(id) on delete set null,
  estimated_value numeric(14,2),
  source        text,                    -- referral | inbound | enquiry | outbound
  message       text,
  assigned_to   uuid references public.profiles(id) on delete set null,
  next_action   text,
  next_action_at timestamptz,
  converted_user_id uuid references public.profiles(id) on delete set null,
  lost_reason   text,
  created_by    uuid references public.profiles(id),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create index leads_stage_idx    on public.leads (kind, stage, updated_at desc);
create index leads_assigned_idx on public.leads (assigned_to);

create table public.lead_notes (
  id         uuid primary key default extensions.gen_random_uuid(),
  lead_id    uuid not null references public.leads(id) on delete cascade,
  author_id  uuid not null references public.profiles(id) on delete cascade,
  body       text not null,
  created_at timestamptz not null default now()
);

create index lead_notes_lead_idx on public.lead_notes (lead_id, created_at desc);

-- ── Notificaciones (realtime) ──────────────────────────────────────────────
create table public.notifications (
  id         uuid primary key default extensions.gen_random_uuid(),
  user_id    uuid not null references public.profiles(id) on delete cascade,
  type       text not null,
  title      text not null,
  body       text,
  link       text,
  deal_id    uuid references public.deals(id) on delete cascade,
  asset_id   uuid references public.assets(id) on delete cascade,
  severity   text not null default 'info' check (severity in ('info','success','warning','critical')),
  read_at    timestamptz,
  created_at timestamptz not null default now()
);

create index notifications_user_idx on public.notifications (user_id, created_at desc);
create index notifications_unread_idx on public.notifications (user_id) where read_at is null;

create table public.email_log (
  id           uuid primary key default extensions.gen_random_uuid(),
  user_id      uuid references public.profiles(id) on delete set null,
  to_email     extensions.citext not null,
  template     text not null,
  subject      text not null,
  provider     text not null default 'mock',
  provider_ref text,
  status       text not null default 'queued',
  error        text,
  payload      jsonb not null default '{}'::jsonb,
  created_at   timestamptz not null default now()
);

-- ── Audit log ──────────────────────────────────────────────────────────────
-- Escrito EXCLUSIVAMENTE por la API con service role. Nadie lo modifica.
create table public.audit_logs (
  id          bigint generated always as identity primary key,
  actor_id    uuid references public.profiles(id) on delete set null,
  actor_email extensions.citext,
  actor_role  public.user_role,
  action      text not null,             -- document.view, document.download, nda.sign…
  entity_type text,                      -- document | deal | asset | profile | permission
  entity_id   uuid,
  deal_id     uuid references public.deals(id) on delete set null,
  asset_id    uuid references public.assets(id) on delete set null,
  document_id uuid references public.documents(id) on delete set null,
  document_version integer,
  ip_address  inet,
  user_agent  text,
  metadata    jsonb not null default '{}'::jsonb,
  created_at  timestamptz not null default now()
);

create index audit_deal_idx    on public.audit_logs (deal_id, created_at desc);
create index audit_actor_idx   on public.audit_logs (actor_id, created_at desc);
create index audit_action_idx  on public.audit_logs (action, created_at desc);
create index audit_document_idx on public.audit_logs (document_id, created_at desc);

comment on table public.audit_logs is
  'Append-only. Escrito por la API (service role). RLS solo concede lectura al seller del deal y al admin.';
