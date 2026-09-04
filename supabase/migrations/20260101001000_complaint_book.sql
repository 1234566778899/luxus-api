-- ============================================================================
-- LUXUS PERÚ · 1000 — Libro de Reclamaciones
--
-- Hoja de reclamación virtual (D.S. N.º 011-2011-PCM y modificatorias): todo
-- reclamo o queja de un consumidor debe quedar registrado con un número
-- correlativo único, conservarse, y recibir respuesta del proveedor en el
-- plazo que exige la norma. Se escribe SOLO desde la API (rate limit +
-- honeypot en el endpoint público): un anónimo nunca inserta directo contra
-- Supabase, igual que private_access_requests.
-- ============================================================================

create type public.complaint_kind as enum ('reclamo', 'queja');

create type public.complaint_status as enum (
  'received', 'in_review', 'responded', 'closed'
);

create table public.complaint_entries (
  id                uuid primary key default extensions.gen_random_uuid(),
  -- Correlativo legal: entero autoincremental, expuesto al consumidor y al
  -- equipo como "LX-000123" (ver formatComplaintReference en @luxus/shared).
  entry_number      bigint generated always as identity,
  kind              public.complaint_kind not null,

  -- Datos del consumidor reclamante.
  full_name         text not null,
  document_type     text not null default 'DNI',    -- DNI | CE | PASSPORT
  document_number   text not null,
  email             extensions.citext not null,
  phone             text,
  address           text,
  -- Si el reclamante es menor de edad, la norma exige los datos de su
  -- padre/madre o apoderado en su lugar.
  is_minor          boolean not null default false,
  guardian_name     text,

  -- Datos del bien o servicio contratado.
  product_or_service text not null,
  asset_id          uuid references public.assets(id) on delete set null,
  amount            numeric(14, 2),

  -- Detalle de la reclamación/queja y lo que pide el consumidor.
  detail            text not null,
  requested_action  text,

  status            public.complaint_status not null default 'received',
  response_text     text,
  responded_by      uuid references public.profiles(id),
  responded_at      timestamptz,

  source            text not null default 'website',
  ip_address        inet,
  user_agent        text,

  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

create unique index complaint_entries_number_idx on public.complaint_entries (entry_number);
create index complaint_entries_status_idx on public.complaint_entries (status, created_at desc);

alter table public.complaint_entries enable row level security;

-- Igual que private_access_requests: solo el equipo (vía API con service
-- role) lee y escribe. El endpoint público inserta con la service key,
-- fuera de RLS, después de validar el esquema y el honeypot.
create policy "complaint entries: admin"
  on public.complaint_entries for all to authenticated
  using (luxus.is_admin()) with check (luxus.is_admin());
