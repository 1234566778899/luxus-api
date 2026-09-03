-- ============================================================================
-- LUXUS PERÚ · 0300 — KYC y screening
-- Los proveedores reales se conectan detrás de interfaces abstraídas en la API.
-- La base de datos solo guarda el estado y la referencia del proveedor.
-- ============================================================================

create table public.kyc_cases (
  id                uuid primary key default extensions.gen_random_uuid(),
  user_id           uuid not null references public.profiles(id) on delete cascade,
  status            public.kyc_status not null default 'in_progress',
  provider          text not null default 'mock',
  provider_ref      text,
  provider_payload  jsonb not null default '{}'::jsonb,

  -- Datos declarados en el wizard
  legal_name        text,
  document_type     text,               -- DNI | CE | PASSPORT
  document_number   text,
  nationality       text,
  birth_date        date,
  is_pep            boolean,
  pep_details       text,
  tax_residence     text,
  occupation        text,

  -- Origen de fondos / patrimonio
  source_of_funds   text,
  source_of_wealth  text,
  estimated_net_worth_band text,        -- '1-5M' | '5-25M' | '25-100M' | '100M+'
  funds_declaration jsonb not null default '{}'::jsonb,

  reviewer_id       uuid references public.profiles(id),
  reviewer_notes    text,
  rejection_reason  text,
  requires_manual_review boolean not null default false,
  submitted_at      timestamptz,
  decided_at        timestamptz,
  expires_at        timestamptz,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

create index kyc_cases_user_idx   on public.kyc_cases (user_id, created_at desc);
create index kyc_cases_status_idx on public.kyc_cases (status) where status in ('submitted','in_review');

create table public.kyc_documents (
  id            uuid primary key default extensions.gen_random_uuid(),
  case_id       uuid not null references public.kyc_cases(id) on delete cascade,
  user_id       uuid not null references public.profiles(id) on delete cascade,
  doc_type      public.kyc_document_type not null,
  bucket        text not null default 'kyc-documents',
  storage_path  text not null,
  file_name     text,
  mime_type     text,
  size_bytes    bigint,
  sha256        text,
  uploaded_at   timestamptz not null default now()
);

create index kyc_documents_case_idx on public.kyc_documents (case_id);

create table public.screening_checks (
  id            uuid primary key default extensions.gen_random_uuid(),
  user_id       uuid not null references public.profiles(id) on delete cascade,
  kyc_case_id   uuid references public.kyc_cases(id) on delete set null,
  provider      text not null default 'mock',
  provider_ref  text,
  status        public.screening_status not null default 'pending',
  -- Listas consultadas: PEP, OFAC/SDN, ONU, UE, adverse media
  lists_checked text[] not null default '{}',
  match_count   integer not null default 0,
  matches       jsonb not null default '[]'::jsonb,
  risk_score    smallint,
  reviewer_id   uuid references public.profiles(id),
  reviewer_notes text,
  ran_at        timestamptz not null default now(),
  reviewed_at   timestamptz
);

create index screening_user_idx on public.screening_checks (user_id, ran_at desc);
