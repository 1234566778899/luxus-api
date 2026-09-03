-- ============================================================================
-- LUXUS PERÚ · 0100 — Identity, membership, brokers, access requests
-- ============================================================================

create table public.profiles (
  id                  uuid primary key references auth.users(id) on delete cascade,
  email               extensions.citext not null unique,
  full_name           text,
  phone               text,
  role                public.user_role not null default 'buyer',
  membership_tier     public.membership_tier not null default 'none',
  broker_plan         public.broker_plan not null default 'none',
  kyc_status          public.kyc_status not null default 'not_started',
  screening_status    public.screening_status not null default 'not_run',
  country             text default 'PE',
  city                text,
  language            text not null default 'es',
  -- Nivel de información al que el usuario tiene derecho por defecto.
  -- 1 público · 2 miembro verificado · 3 deal room (por deal, no global)
  access_level        smallint not null default 1 check (access_level between 1 and 3),
  is_suspended        boolean not null default false,
  suspended_reason    text,
  mfa_enrolled        boolean not null default false,
  concierge_enabled   boolean not null default false,
  last_seen_at        timestamptz,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

comment on table public.profiles is
  'Perfil de plataforma 1:1 con auth.users. access_level 2 requiere KYC aprobado.';

create index profiles_role_idx on public.profiles (role);
create index profiles_kyc_idx  on public.profiles (kyc_status);

-- Notification preferences (one row per user, created with the profile).
create table public.notification_preferences (
  user_id             uuid primary key references public.profiles(id) on delete cascade,
  email_deal_activity boolean not null default true,
  email_qa            boolean not null default true,
  email_offers        boolean not null default true,
  email_kyc           boolean not null default true,
  email_billing       boolean not null default true,
  email_new_listings  boolean not null default true,
  email_expiry_alerts boolean not null default true,
  in_app_enabled      boolean not null default true,
  digest_frequency    text not null default 'instant'
                        check (digest_frequency in ('instant', 'daily', 'weekly', 'off')),
  updated_at          timestamptz not null default now()
);

-- ── Broker / agency profile ────────────────────────────────────────────────
create table public.brokers (
  id              uuid primary key default extensions.gen_random_uuid(),
  user_id         uuid not null unique references public.profiles(id) on delete cascade,
  slug            text not null unique,
  company_name    text not null,
  ruc             text,                       -- Registro Único de Contribuyentes (PE)
  legal_rep       text,
  website         text,
  phone           text,
  office_address  text,
  bio             text,
  logo_path       text,
  is_verified     boolean not null default false,   -- badge "LUXUS VERIFIED"
  verified_at     timestamptz,
  verified_by     uuid references public.profiles(id),
  listing_quota   integer not null default 3,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  constraint brokers_ruc_format check (ruc is null or ruc ~ '^[0-9]{11}$')
);

create index brokers_verified_idx on public.brokers (is_verified) where is_verified;

-- ── Private Access requests (Nivel I → invitación) ─────────────────────────
create table public.private_access_requests (
  id                uuid primary key default extensions.gen_random_uuid(),
  applicant_profile public.applicant_profile not null,
  full_name         text not null,
  email             extensions.citext not null,
  phone             text,
  company           text,
  country           text default 'PE',
  city              text,
  interest          text,           -- categorías de interés, texto libre
  budget_range      text,
  message           text,
  source            text,
  status            public.request_status not null default 'pending',
  reviewed_by       uuid references public.profiles(id),
  reviewed_at       timestamptz,
  review_notes      text,
  invited_at        timestamptz,
  invited_user_id   uuid references public.profiles(id),
  ip_address        inet,
  user_agent        text,
  created_at        timestamptz not null default now()
);

create index par_status_idx  on public.private_access_requests (status, created_at desc);
create index par_email_idx   on public.private_access_requests (email);

-- ── Session registry (para cierre de sesión remoto) ────────────────────────
create table public.user_sessions (
  id            uuid primary key default extensions.gen_random_uuid(),
  user_id       uuid not null references public.profiles(id) on delete cascade,
  session_id    text,                -- id de sesión de GoTrue cuando está disponible
  ip_address    inet,
  user_agent    text,
  device_label  text,
  created_at    timestamptz not null default now(),
  last_seen_at  timestamptz not null default now(),
  revoked_at    timestamptz
);

create index user_sessions_user_idx on public.user_sessions (user_id, last_seen_at desc);
