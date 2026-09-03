-- ============================================================================
-- LUXUS PERÚ · 0900 — Catálogo de planes (dato de referencia)
-- Los importes están en centavos USD. `stripe_price_id` se completa tras
-- crear los precios en Stripe (script npm run stripe:sync).
-- ============================================================================

insert into public.plans
  (code, kind, name, tagline, amount_cents, currency, interval, listing_quota, placement_rank, benefits, sort_order)
values
  ('membership_private', 'membership', 'LUXUS PRIVATE',
   'Acceso al mercado privado curado.',
   150000, 'USD', 'year', null, 1,
   '["Acceso a activos verificados","Solicitud de Deal Room (hasta 3 simultáneos)","Reportes Intelligence","Alertas de nuevos activos"]'::jsonb, 1),

  ('membership_black', 'membership', 'LUXUS BLACK',
   'Acceso anticipado y mercado off-market.',
   500000, 'USD', 'year', null, 2,
   '["Todo LUXUS PRIVATE","Acceso anticipado 72 h antes de la publicación","Activos off-market","Deal Rooms ilimitados","Analista asignado"]'::jsonb, 2),

  ('membership_family_office', 'membership', 'LUXUS FAMILY OFFICE',
   'Mandato de búsqueda y concierge dedicado.',
   1500000, 'USD', 'year', null, 3,
   '["Todo LUXUS BLACK","Concierge de transacción dedicado","Mandatos de búsqueda a medida","Originación off-market bajo pedido","Hasta 5 usuarios de la oficina"]'::jsonb, 3),

  ('broker_essential', 'broker', 'Essential',
   'Para brókers independientes.',
   25000, 'USD', 'month', 3, 1,
   '["Hasta 3 activos publicados","Perfil de bróker","Deal Room estándar"]'::jsonb, 4),

  ('broker_professional', 'broker', 'Professional',
   'Para equipos con cartera activa.',
   75000, 'USD', 'month', 12, 2,
   '["Hasta 12 activos publicados","Badge LUXUS VERIFIED","Posicionamiento destacado en colecciones","Estadísticas avanzadas"]'::jsonb, 5),

  ('broker_private_desk', 'broker', 'Private Desk',
   'Mesa privada con originación conjunta.',
   200000, 'USD', 'month', null, 3,
   '["Activos ilimitados","Prioridad máxima de posicionamiento","Originación conjunta off-market","Soporte de verificación acelerado"]'::jsonb, 6)
on conflict (code) do nothing;

-- Rangos de listing fee por tier (referencia para el Admin al cotizar)
create table if not exists public.listing_fee_bands (
  tier         public.listing_tier primary key,
  min_cents    integer not null,
  max_cents    integer not null,
  currency     char(3) not null default 'USD',
  description  text
);

insert into public.listing_fee_bands (tier, min_cents, max_cents, description) values
  ('private',    50000,  200000, 'Publicación Private: verificación estándar y ficha curada.'),
  ('signature', 200000, 1000000, 'Publicación Signature: producción fotográfica, dossier y difusión dirigida.')
on conflict (tier) do nothing;

alter table public.listing_fee_bands enable row level security;

create policy "fee bands: public read"
  on public.listing_fee_bands for select to anon, authenticated using (true);
