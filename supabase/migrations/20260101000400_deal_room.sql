-- ============================================================================
-- LUXUS PERÚ · 0400 — Deal Room
-- solicitud → KYC → aprobación seller → NDA → acceso → Q&A → oferta → LOI
--            → due diligence → cierre
-- ============================================================================

create table public.deals (
  id             uuid primary key default extensions.gen_random_uuid(),
  reference_code text not null unique,                 -- DR-2026-0001
  asset_id       uuid not null references public.assets(id) on delete cascade,
  buyer_id       uuid not null references public.profiles(id) on delete cascade,
  seller_id      uuid not null references public.profiles(id) on delete cascade,
  broker_id      uuid references public.brokers(id) on delete set null,

  stage          public.deal_stage not null default 'requested',
  stage_changed_at timestamptz not null default now(),

  -- Motivo declarado por el comprador al solicitar acceso
  request_message  text,
  intended_use     text,
  financing_type   text,                -- cash | financed | mixed
  proof_of_funds   boolean not null default false,

  decline_reason   text,
  declined_by      uuid references public.profiles(id),

  -- Fechas del flujo
  requested_at   timestamptz not null default now(),
  kyc_cleared_at timestamptz,
  approved_at    timestamptz,
  approved_by    uuid references public.profiles(id),
  nda_signed_at  timestamptz,
  opened_at      timestamptz,
  closed_at      timestamptz,
  expires_at     timestamptz,           -- caducidad global del acceso al deal

  -- Cierre (escrow/fiduciaria es EXTERNO: aquí solo se modela el estado)
  closing_checklist jsonb not null default '[]'::jsonb,
  closing_notes     text,
  final_amount      numeric(14,2),
  final_currency    char(3) default 'USD',
  -- Success fee: solo dato para facturación manual. La plataforma NO lo cobra.
  success_fee_pct   numeric(5,2),
  success_fee_amount numeric(14,2),
  success_fee_invoiced boolean not null default false,

  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),

  constraint deals_buyer_not_seller check (buyer_id <> seller_id),
  unique (asset_id, buyer_id)
);

create index deals_buyer_idx  on public.deals (buyer_id, stage);
create index deals_seller_idx on public.deals (seller_id, stage);
create index deals_asset_idx  on public.deals (asset_id);
create index deals_stage_idx  on public.deals (stage, stage_changed_at desc);

comment on column public.deals.success_fee_amount is
  'Solo registro. La plataforma no procesa ni retiene fondos de la transacción.';

-- Historial de estados del deal (visible para ambas partes)
create table public.deal_stage_history (
  id          bigint generated always as identity primary key,
  deal_id     uuid not null references public.deals(id) on delete cascade,
  from_stage  public.deal_stage,
  to_stage    public.deal_stage not null,
  actor_id    uuid references public.profiles(id),
  reason      text,
  created_at  timestamptz not null default now()
);

create index dsh_deal_idx on public.deal_stage_history (deal_id, created_at desc);

-- ── NDA ────────────────────────────────────────────────────────────────────
create table public.ndas (
  id                   uuid primary key default extensions.gen_random_uuid(),
  deal_id              uuid not null unique references public.deals(id) on delete cascade,
  status               public.nda_status not null default 'draft',
  provider             text not null default 'mock',
  provider_envelope_id text,
  template_version     text not null default 'nda-v1-es-PE',
  -- Documento generado (sin firmar) y documento firmado devuelto por el proveedor
  bucket               text not null default 'signed-documents',
  draft_path           text,
  signed_path          text,
  signed_sha256        text,            -- huella del PDF firmado
  signer_name          text,
  signer_email         extensions.citext,
  signer_ip            inet,
  sent_at              timestamptz,
  viewed_at            timestamptz,
  signed_at            timestamptz,
  expires_at           timestamptz,
  provider_audit       jsonb not null default '{}'::jsonb,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);

comment on table public.ndas is
  'Firma electrónica detrás de interfaz abstraída. Preparado para proveedor con validez legal en Perú (Ley 27269).';

-- ── Árbol documental del activo ────────────────────────────────────────────
create table public.documents (
  id             uuid primary key default extensions.gen_random_uuid(),
  asset_id       uuid not null references public.assets(id) on delete cascade,
  folder         public.document_folder not null,
  subfolder      text,                       -- ruta libre dentro de la carpeta raíz
  name           text not null,
  description    text,
  is_confidential boolean not null default true,
  -- Documento de verificación exigido por el checklist (SUNARP, DICAPI, …)
  verification_key text,
  current_version_id uuid,                   -- FK circular, añadida abajo
  version_count  integer not null default 0,
  created_by     uuid not null references public.profiles(id),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  deleted_at     timestamptz
);

create index documents_asset_idx  on public.documents (asset_id, folder, name);
create index documents_active_idx on public.documents (asset_id) where deleted_at is null;

create table public.document_versions (
  id           uuid primary key default extensions.gen_random_uuid(),
  document_id  uuid not null references public.documents(id) on delete cascade,
  version      integer not null,
  bucket       text not null default 'deal-documents',
  storage_path text not null,
  file_name    text not null,
  mime_type    text not null default 'application/pdf',
  size_bytes   bigint,
  sha256       text,
  page_count   integer,
  change_note  text,
  uploaded_by  uuid not null references public.profiles(id),
  created_at   timestamptz not null default now(),
  unique (document_id, version)
);

create index dv_document_idx on public.document_versions (document_id, version desc);

alter table public.documents
  add constraint documents_current_version_fk
  foreign key (current_version_id) references public.document_versions(id) on delete set null;

alter table public.asset_verification_items
  add constraint avi_document_fk
  foreign key (document_id) references public.documents(id) on delete set null;

-- ── Permisos por documento y por usuario, con expiración ───────────────────
create table public.document_permissions (
  id           uuid primary key default extensions.gen_random_uuid(),
  document_id  uuid not null references public.documents(id) on delete cascade,
  deal_id      uuid not null references public.deals(id) on delete cascade,
  user_id      uuid not null references public.profiles(id) on delete cascade,
  level        public.permission_level not null default 'view',
  granted_by   uuid not null references public.profiles(id),
  granted_at   timestamptz not null default now(),
  -- Vencimiento configurable por el seller. Al vencer, el acceso se revoca solo.
  expires_at   timestamptz,
  revoked_at   timestamptz,
  revoked_by   uuid references public.profiles(id),
  revoke_reason text,
  -- Aviso previo de expiración enviado (evita duplicados en el barrido)
  expiry_notified_at timestamptz,
  view_count   integer not null default 0,
  download_count integer not null default 0,
  last_accessed_at timestamptz,
  unique (document_id, user_id, deal_id)
);

create index docperm_user_idx  on public.document_permissions (user_id, deal_id);
create index docperm_doc_idx   on public.document_permissions (document_id);
create index docperm_expiry_idx on public.document_permissions (expires_at)
  where revoked_at is null and expires_at is not null;

-- ── Q&A privado por deal ───────────────────────────────────────────────────
create table public.qa_threads (
  id           uuid primary key default extensions.gen_random_uuid(),
  deal_id      uuid not null references public.deals(id) on delete cascade,
  subject      text not null,
  document_id  uuid references public.documents(id) on delete set null,
  folder       public.document_folder,
  created_by   uuid not null references public.profiles(id),
  is_resolved  boolean not null default false,
  resolved_at  timestamptz,
  last_message_at timestamptz not null default now(),
  message_count integer not null default 0,
  created_at   timestamptz not null default now()
);

create index qa_threads_deal_idx on public.qa_threads (deal_id, last_message_at desc);

create table public.qa_messages (
  id          uuid primary key default extensions.gen_random_uuid(),
  thread_id   uuid not null references public.qa_threads(id) on delete cascade,
  deal_id     uuid not null references public.deals(id) on delete cascade,
  author_id   uuid not null references public.profiles(id) on delete cascade,
  body        text not null,
  attachment_document_id uuid references public.documents(id) on delete set null,
  read_by     uuid[] not null default '{}',
  created_at  timestamptz not null default now(),
  edited_at   timestamptz
);

create index qa_messages_thread_idx on public.qa_messages (thread_id, created_at);

-- ── Ofertas y LOI ──────────────────────────────────────────────────────────
create table public.offers (
  id              uuid primary key default extensions.gen_random_uuid(),
  deal_id         uuid not null references public.deals(id) on delete cascade,
  author_id       uuid not null references public.profiles(id),
  -- Contraofertas: cadena enlazada
  parent_offer_id uuid references public.offers(id) on delete set null,
  round           integer not null default 1,
  amount          numeric(14,2) not null check (amount > 0),
  currency        char(3) not null default 'USD',
  payment_structure text,               -- cash | escrow | earn-out | mixed
  deposit_amount  numeric(14,2),
  conditions      text,
  dd_period_days  integer,
  exclusivity_days integer,
  valid_until     timestamptz,
  status          public.offer_status not null default 'submitted',
  responded_by    uuid references public.profiles(id),
  responded_at    timestamptz,
  response_note   text,
  created_at      timestamptz not null default now()
);

create index offers_deal_idx on public.offers (deal_id, created_at desc);

create table public.lois (
  id            uuid primary key default extensions.gen_random_uuid(),
  deal_id       uuid not null references public.deals(id) on delete cascade,
  offer_id      uuid not null references public.offers(id) on delete cascade,
  status        public.loi_status not null default 'draft',
  template_version text not null default 'loi-v1-es-PE',
  terms         jsonb not null default '{}'::jsonb,
  bucket        text not null default 'signed-documents',
  draft_path    text,
  signed_path   text,
  signed_sha256 text,
  provider      text not null default 'mock',
  provider_envelope_id text,
  sent_at       timestamptz,
  signed_at     timestamptz,
  expires_at    timestamptz,
  created_by    uuid not null references public.profiles(id),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create index lois_deal_idx on public.lois (deal_id, created_at desc);
