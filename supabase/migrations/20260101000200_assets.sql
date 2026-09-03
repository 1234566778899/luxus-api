-- ============================================================================
-- LUXUS PERÚ · 0200 — Assets
--
-- Separación deliberada en dos tablas para que los tres niveles de información
-- sean *estructurales*, no cosméticos:
--
--   public.assets                → Nivel I  (categoría, distrito, RANGO de precio,
--                                            fotos seleccionadas, descripción general)
--   public.asset_private_details → Nivel II/III (precio exacto, dirección exacta,
--                                            geolocalización, notas del vendedor)
--
-- RLS es row-level, no column-level: si el precio exacto viviera en la misma
-- fila que los datos públicos, cualquier SELECT anónimo lo devolvería.
-- ============================================================================

create table public.assets (
  id                 uuid primary key default extensions.gen_random_uuid(),
  slug               text not null unique,
  reference_code     text not null unique,            -- LX-RE-0001
  owner_id           uuid not null references public.profiles(id) on delete restrict,
  broker_id          uuid references public.brokers(id) on delete set null,

  category           public.asset_category not null,
  title              text not null,
  headline           text,
  description_public text not null,                   -- Nivel I: descripción general

  -- Ubicación aproximada — NUNCA la dirección
  district           text,
  province           text,
  region             text,
  country            text not null default 'PE',

  -- Rango de precio público (Nivel I). El exacto vive en asset_private_details.
  price_currency     char(3) not null default 'USD',
  price_min          numeric(14,2),
  price_max          numeric(14,2),
  price_on_request   boolean not null default false,

  visibility         public.asset_visibility not null default 'verified',
  status             public.asset_status not null default 'draft',
  tier               public.listing_tier not null default 'private',

  -- Specs tipadas por categoría (validadas con Zod en API y wizard)
  specs              jsonb not null default '{}'::jsonb,

  -- Bloque de verificación mostrado en la ficha pública
  ownership_verified      boolean not null default false,
  registry_reviewed       boolean not null default false,
  documentation_reviewed  boolean not null default false,
  valuation_available     boolean not null default false,
  verification_notes      text,
  verified_at             timestamptz,
  verified_by             uuid references public.profiles(id),

  is_featured        boolean not null default false,
  featured_rank      integer,
  view_count         integer not null default 0,
  enquiry_count      integer not null default 0,

  published_at       timestamptz,
  sold_at            timestamptz,
  archived_at        timestamptz,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),

  constraint assets_price_range_ordered
    check (price_min is null or price_max is null or price_min <= price_max),
  constraint assets_published_needs_date
    check (status <> 'published' or published_at is not null)
);

create index assets_public_browse_idx
  on public.assets (category, status, visibility, published_at desc);
create index assets_owner_idx    on public.assets (owner_id);
create index assets_broker_idx   on public.assets (broker_id);
create index assets_featured_idx on public.assets (featured_rank) where is_featured;
create index assets_price_idx    on public.assets (price_min, price_max);
create index assets_specs_gin    on public.assets using gin (specs jsonb_path_ops);
create index assets_title_trgm   on public.assets using gin (title extensions.gin_trgm_ops);

comment on column public.assets.price_min is 'Extremo inferior del RANGO público. El precio exacto no pertenece a esta tabla.';

-- ── Nivel II / III: datos reservados ───────────────────────────────────────
create table public.asset_private_details (
  asset_id            uuid primary key references public.assets(id) on delete cascade,
  price_exact         numeric(14,2),
  price_currency      char(3) not null default 'USD',
  price_negotiable    boolean not null default true,
  address_exact       text,
  address_reference   text,
  latitude            numeric(9,6),
  longitude           numeric(9,6),
  description_private text,
  seller_notes        text,
  contact_name        text,
  contact_phone       text,
  contact_email       extensions.citext,
  -- Datos registrales sensibles (partida SUNARP, matrícula DICAPI/DGAC, RUC…)
  registry_reference  text,
  tax_reference       text,
  annual_costs        numeric(14,2),
  valuation_amount    numeric(14,2),
  valuation_date      date,
  valuation_firm      text,
  updated_at          timestamptz not null default now()
);

comment on table public.asset_private_details is
  'Nivel II+. Solo propietario, bróker asignado, admin, o comprador con deal y NDA firmado.';

-- ── Media ──────────────────────────────────────────────────────────────────
create table public.asset_media (
  id           uuid primary key default extensions.gen_random_uuid(),
  asset_id     uuid not null references public.assets(id) on delete cascade,
  kind         public.media_kind not null default 'image',
  bucket       text not null,                 -- 'public-media' | 'asset-private-media'
  storage_path text not null,
  is_public    boolean not null default false, -- true → visible en Nivel I
  caption      text,
  alt_text     text,
  width        integer,
  height       integer,
  sort_order   integer not null default 0,
  created_at   timestamptz not null default now()
);

create index asset_media_asset_idx on public.asset_media (asset_id, is_public, sort_order);

-- ── Checklist de verificación (cola del Admin) ─────────────────────────────
create table public.asset_verification_items (
  id          uuid primary key default extensions.gen_random_uuid(),
  asset_id    uuid not null references public.assets(id) on delete cascade,
  item_key    text not null,
  label       text not null,
  authority   text,                    -- SUNARP, SUNAT, SAT, DICAPI, DGAC, MTC
  required    boolean not null default true,
  status      public.verification_item_status not null default 'pending',
  notes       text,
  document_id uuid,                    -- FK añadida en 0300 (documents)
  checked_by  uuid references public.profiles(id),
  checked_at  timestamptz,
  created_at  timestamptz not null default now(),
  unique (asset_id, item_key)
);

create index avi_asset_idx on public.asset_verification_items (asset_id, status);

-- ── Watchlist / favoritos ──────────────────────────────────────────────────
create table public.watchlist (
  user_id    uuid not null references public.profiles(id) on delete cascade,
  asset_id   uuid not null references public.assets(id) on delete cascade,
  note       text,
  created_at timestamptz not null default now(),
  primary key (user_id, asset_id)
);

-- ── Vistas de activo (estadísticas del seller) ─────────────────────────────
create table public.asset_views (
  id         bigint generated always as identity primary key,
  asset_id   uuid not null references public.assets(id) on delete cascade,
  viewer_id  uuid references public.profiles(id) on delete set null,
  is_member  boolean not null default false,
  referrer   text,
  created_at timestamptz not null default now()
);

create index asset_views_asset_idx on public.asset_views (asset_id, created_at desc);
