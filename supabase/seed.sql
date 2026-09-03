-- ============================================================================
-- LUXUS PERÚ · seed de desarrollo
--
-- Crea usuarios de cada rol, 11 activos repartidos en las 5 categorías, un
-- comprador con KYC aprobado y un Deal Room completo (NDA firmado, árbol
-- documental con versiones, permisos con vencimiento, Q&A y oferta viva).
--
-- Contraseña de todos los usuarios: Luxus2026!
-- ============================================================================

set search_path = public, extensions;

-- ── Usuarios ───────────────────────────────────────────────────────────────
do $$
declare
  u record;
begin
  for u in
    select * from (values
      ('00000000-0000-4000-a000-000000000001'::uuid, 'admin@luxusperu.com',            'Adriana Málaga',        'admin'),
      ('00000000-0000-4000-a000-000000000002'::uuid, 'analista@luxusperu.com',         'Sebastián Rioja',       'admin'),
      ('00000000-0000-4000-a000-000000000003'::uuid, 'vendedor@patrimonioandino.pe',   'Familia Barrantes SAC', 'seller'),
      ('00000000-0000-4000-a000-000000000004'::uuid, 'broker@casanovaluxury.pe',       'Marcela Casanova',      'broker'),
      ('00000000-0000-4000-a000-000000000005'::uuid, 'comprador@vialtafamily.com',     'Alonso Vialta',         'buyer'),
      ('00000000-0000-4000-a000-000000000006'::uuid, 'pendiente@nuevocliente.com',     'Renzo Ítalo',           'buyer'),
      ('00000000-0000-4000-a000-000000000007'::uuid, 'familyoffice@quintanilla.pe',    'Quintanilla Family Office', 'buyer')
    ) as t(id, email, full_name, role)
  loop
    insert into auth.users (
      instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
      raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
      confirmation_token, email_change, email_change_token_new, recovery_token
    ) values (
      '00000000-0000-0000-0000-000000000000', u.id, 'authenticated', 'authenticated',
      u.email, extensions.crypt('Luxus2026!', extensions.gen_salt('bf')), now(),
      '{"provider":"email","providers":["email"]}'::jsonb,
      jsonb_build_object('full_name', u.full_name, 'role', u.role),
      now() - interval '90 days', now(), '', '', '', ''
    ) on conflict (id) do nothing;

    insert into auth.identities (
      id, user_id, provider_id, identity_data, provider, last_sign_in_at, created_at, updated_at
    ) values (
      extensions.gen_random_uuid(), u.id, u.id::text,
      jsonb_build_object('sub', u.id::text, 'email', u.email, 'email_verified', true),
      'email', now(), now(), now()
    ) on conflict do nothing;
  end loop;
end $$;

update public.profiles set
  phone = '+51 999 111 222', city = 'Lima', country = 'PE'
where id in (
  '00000000-0000-4000-a000-000000000001',
  '00000000-0000-4000-a000-000000000002'
);

-- Comprador verificado (Nivel II): KYC aprobado, screening limpio, LUXUS BLACK
update public.profiles set
  kyc_status = 'approved',
  screening_status = 'clear',
  membership_tier = 'black',
  mfa_enrolled = true,
  phone = '+51 987 654 321',
  city = 'Lima'
where id = '00000000-0000-4000-a000-000000000005';

-- Comprador SIN verificar: sirve para probar que Nivel II queda cerrado
update public.profiles set kyc_status = 'not_started', screening_status = 'not_run'
where id = '00000000-0000-4000-a000-000000000006';

update public.profiles set
  kyc_status = 'approved', screening_status = 'clear',
  membership_tier = 'family_office', concierge_enabled = true
where id = '00000000-0000-4000-a000-000000000007';

update public.profiles set
  kyc_status = 'approved', screening_status = 'clear', city = 'Lima'
where id in (
  '00000000-0000-4000-a000-000000000003',
  '00000000-0000-4000-a000-000000000004'
);

update public.profiles set broker_plan = 'professional'
where id = '00000000-0000-4000-a000-000000000004';

-- ── Bróker verificado ──────────────────────────────────────────────────────
insert into public.brokers (
  id, user_id, slug, company_name, ruc, legal_rep, website, phone, office_address,
  bio, is_verified, verified_at, verified_by, listing_quota
) values (
  '11111111-0000-4000-a000-000000000001',
  '00000000-0000-4000-a000-000000000004',
  'casanova-luxury-advisory',
  'Casanova Luxury Advisory S.A.C.',
  '20601234567',
  'Marcela Casanova Ruiz',
  'https://casanovaluxury.pe',
  '+51 987 200 100',
  'Av. Santa Cruz 1250, San Isidro, Lima',
  'Asesoría independiente para transacciones privadas de patrimonio en Perú. Diecisiete años intermediando activos residenciales prime, participaciones societarias y activos de colección. Cada mandato se trabaja bajo confidencialidad y con verificación registral previa.',
  true, now() - interval '200 days',
  '00000000-0000-4000-a000-000000000001', 12
) on conflict (id) do nothing;

-- ── KYC aprobado del comprador verificado ──────────────────────────────────
insert into public.kyc_cases (
  id, user_id, status, provider, provider_ref, legal_name, document_type,
  document_number, nationality, birth_date, is_pep, tax_residence, occupation,
  source_of_funds, source_of_wealth, estimated_net_worth_band,
  reviewer_id, submitted_at, decided_at, expires_at
) values (
  '22222222-0000-4000-a000-000000000001',
  '00000000-0000-4000-a000-000000000005',
  'approved', 'mock', 'mock_kyc_9f3a21',
  'Alonso Vialta Echecopar', 'DNI', '09XXXXXX', 'PE', '1974-03-18', false, 'PE',
  'Inversionista privado / director de empresas',
  'Venta de participación en operador logístico (2023) y rentas inmobiliarias.',
  'Patrimonio familiar construido en agroindustria y logística portuaria desde 1988.',
  '25-100M',
  '00000000-0000-4000-a000-000000000001',
  now() - interval '40 days', now() - interval '38 days', now() + interval '325 days'
) on conflict (id) do nothing;

insert into public.screening_checks (
  user_id, kyc_case_id, provider, provider_ref, status, lists_checked,
  match_count, matches, risk_score, ran_at
) values (
  '00000000-0000-4000-a000-000000000005',
  '22222222-0000-4000-a000-000000000001',
  'mock', 'mock_scr_7b21', 'clear',
  array['PEP','OFAC-SDN','UN-CONSOLIDATED','EU-SANCTIONS','ADVERSE-MEDIA'],
  0, '[]'::jsonb, 8, now() - interval '38 days'
);

-- ── Suscripciones y pagos ──────────────────────────────────────────────────
insert into public.subscriptions (
  id, user_id, kind, plan_code, status, provider, provider_customer_id,
  provider_subscription_id, current_period_start, current_period_end
) values
  ('33333333-0000-4000-a000-000000000001', '00000000-0000-4000-a000-000000000005',
   'membership', 'membership_black', 'active', 'mock', 'cus_mock_buyer', 'sub_mock_black',
   now() - interval '60 days', now() + interval '305 days'),
  ('33333333-0000-4000-a000-000000000002', '00000000-0000-4000-a000-000000000004',
   'broker', 'broker_professional', 'active', 'mock', 'cus_mock_broker', 'sub_mock_pro',
   now() - interval '20 days', now() + interval '10 days')
on conflict (id) do nothing;

insert into public.payments (
  user_id, kind, status, subscription_id, plan_code, description,
  amount_cents, currency, provider, provider_payment_id, receipt_number, paid_at
) values
  ('00000000-0000-4000-a000-000000000005', 'subscription', 'paid',
   '33333333-0000-4000-a000-000000000001', 'membership_black',
   'Membresía LUXUS BLACK — 12 meses', 500000, 'USD', 'mock', 'pi_mock_001',
   'LX-2026-000118', now() - interval '60 days'),
  ('00000000-0000-4000-a000-000000000004', 'subscription', 'paid',
   '33333333-0000-4000-a000-000000000002', 'broker_professional',
   'Suscripción Professional — mensual', 75000, 'USD', 'mock', 'pi_mock_002',
   'LX-2026-000131', now() - interval '20 days');

-- ============================================================================
-- ACTIVOS  (11 · las 5 categorías · fotografía placeholder determinista)
-- ============================================================================
-- Convención: si asset_media.storage_path empieza por http se usa tal cual;
-- si no, se resuelve contra el bucket. Así el seed no necesita subir binarios.

insert into public.assets (
  id, slug, owner_id, broker_id, category, title, headline, description_public,
  district, province, region, price_min, price_max, visibility, status, tier,
  specs, ownership_verified, registry_reviewed, documentation_reviewed,
  valuation_available, is_featured, featured_rank, view_count, published_at
) values

-- ── Real estate ────────────────────────────────────────────────────────────
('10000000-0000-4000-a000-000000000001', 'penthouse-malecon-de-la-reserva-miraflores',
 '00000000-0000-4000-a000-000000000003', '11111111-0000-4000-a000-000000000001',
 'real-estate',
 'Penthouse sobre el Malecón de la Reserva',
 'Dos plantas con terraza panorámica sobre la bahía de Lima.',
 'Penthouse dúplex en un edificio de ocho unidades frente al acantilado de Miraflores. Ocupa las dos últimas plantas con doble altura en el salón principal, terraza continua orientada al oeste y ascensor privado con llave. La unidad fue remodelada íntegramente en 2021 por un estudio limeño con carpintería en nogal peruano y piedra caliza. Se transfiere con cocina equipada, domótica y cuatro estacionamientos techados. Documentación registral revisada; visitas únicamente con acreditación previa.',
 'Miraflores', 'Lima', 'Lima', 4200000, 4800000, 'verified', 'published', 'signature',
 '{"property_type":"Penthouse dúplex","bedrooms":4,"bathrooms":5,"parking":4,"built_area_m2":612,"terrace_area_m2":180,"floors":2,"year_built":2013,"renovation_year":2021,"view":"Océano Pacífico / Malecón","condition":"Remodelado","furnished":"Parcialmente","amenities":["Ascensor privado","Domótica","Bodega","Gimnasio del edificio","Seguridad 24/7","Grupo electrógeno"]}'::jsonb,
 true, true, true, true, true, 1, 1842, now() - interval '26 days'),

('10000000-0000-4000-a000-000000000002', 'casa-de-playa-playa-misterio-asia',
 '00000000-0000-4000-a000-000000000003', '11111111-0000-4000-a000-000000000001',
 'real-estate',
 'Casa de playa en primera fila — Playa Misterio',
 'Frente de mar en el kilómetro 97 de la Panamericana Sur.',
 'Residencia de verano en primera fila sobre 1,050 m² de terreno, con acceso directo a la playa y frente marino de 22 metros. Volumetría de un solo nivel con patios interiores, piscina desbordante y casa de huéspedes independiente. Pertenece a una asociación privada con control de acceso, muelle deportivo y club. Se vende con mobiliario diseñado a medida. Estado registral saneado y arbitrios al día.',
 'Asia', 'Cañete', 'Lima', 2800000, 3400000, 'verified', 'published', 'signature',
 '{"property_type":"Casa de playa","bedrooms":6,"bathrooms":7,"parking":4,"built_area_m2":540,"land_area_m2":1050,"floors":1,"year_built":2016,"view":"Frente de mar","condition":"Excelente","furnished":"Sí","amenities":["Piscina desbordante","Casa de huéspedes","Acceso directo a playa","Club privado","Muelle deportivo","Pozo de agua"]}'::jsonb,
 true, true, true, true, true, 2, 1204, now() - interval '18 days'),

('10000000-0000-4000-a000-000000000003', 'hacienda-vitivinicola-valle-de-ica',
 '00000000-0000-4000-a000-000000000003', null,
 'real-estate',
 'Hacienda vitivinícola en el valle de Ica',
 '86 hectáreas en producción con bodega y casona restaurada.',
 'Fundo agrícola de 86 hectáreas en el valle de Ica, con 54 hectáreas de vid en producción (quebranta, italia y torontel), bodega propia con capacidad de 240,000 litros y casona republicana restaurada de 1,100 m². Incluye licencia de producción, marca registrada y contratos de distribución vigentes. Derechos de agua acreditados y pozo tubular autorizado. Se ofrece como unidad de negocio en marcha.',
 'Subtanjalla', 'Ica', 'Ica', 6000000, 7500000, 'verified', 'published', 'private',
 '{"property_type":"Fundo agrícola / bodega","land_area_m2":860000,"built_area_m2":2400,"bedrooms":9,"bathrooms":8,"year_built":1912,"renovation_year":2018,"view":"Valle","condition":"Restaurado","hectares_in_production":54,"water_rights":true,"amenities":["Bodega 240,000 L","Pozo tubular autorizado","Casona republicana","Marca registrada","Contratos de distribución"]}'::jsonb,
 true, true, false, true, false, null, 743, now() - interval '11 days'),

-- ── Companies ──────────────────────────────────────────────────────────────
('10000000-0000-4000-a000-000000000004', 'operador-logistico-portuario-callao',
 '00000000-0000-4000-a000-000000000003', '11111111-0000-4000-a000-000000000001',
 'companies',
 'Operador logístico portuario — Callao',
 'Depósito temporal autorizado con 22 años de operación.',
 'Sociedad anónima cerrada dedicada al depósito temporal y agenciamiento de aduanas en el Callao, con autorización vigente de SUNAT y almacén propio de 34,000 m². Cartera de 180 clientes corporativos con contratos plurianuales y rotación baja. El accionista mayoritario ofrece el 70% de las acciones con acompañamiento en la transición durante 18 meses. Estados financieros auditados de los últimos tres ejercicios disponibles en Deal Room.',
 'Callao', 'Callao', 'Callao', 18000000, 24000000, 'verified', 'published', 'signature',
 '{"sector":"Logística y comercio exterior","legal_form":"S.A.C.","year_founded":2003,"employees":214,"revenue_ttm_usd":31400000,"ebitda_ttm_usd":6900000,"ebitda_margin":22.0,"stake_offered_pct":70,"recurring_revenue_pct":74,"customers":180,"transaction_type":"Venta de participación mayoritaria","warehouse_m2":34000,"licenses":["Depósito temporal SUNAT","Agencia de aduanas","OEA"]}'::jsonb,
 true, true, true, true, true, 3, 967, now() - interval '32 days'),

('10000000-0000-4000-a000-000000000005', 'cadena-hotelera-boutique-valle-sagrado',
 '00000000-0000-4000-a000-000000000003', null,
 'companies',
 'Cadena hotelera boutique — Valle Sagrado y Cusco',
 'Cuatro propiedades operativas, 118 llaves, marca consolidada.',
 'Grupo hotelero con cuatro establecimientos boutique en Cusco, Urubamba y Ollantaytambo, 118 habitaciones en total y ocupación media del 71% en 2025. Tres inmuebles son propios y uno opera bajo arrendamiento de largo plazo. Marca registrada en INDECOPI, canal directo consolidado y contratos con operadores internacionales. Se ofrece el 100% del capital social.',
 'Urubamba', 'Urubamba', 'Cusco', 28000000, 35000000, 'private', 'published', 'signature',
 '{"sector":"Hotelería boutique","legal_form":"S.A.","year_founded":2009,"employees":186,"revenue_ttm_usd":14200000,"ebitda_ttm_usd":4100000,"ebitda_margin":28.9,"stake_offered_pct":100,"recurring_revenue_pct":34,"properties":4,"keys":118,"average_occupancy_pct":71,"transaction_type":"Venta del 100% del capital"}'::jsonb,
 true, true, false, true, false, null, 612, now() - interval '9 days'),

-- ── Vehicles ───────────────────────────────────────────────────────────────
('10000000-0000-4000-a000-000000000006', 'porsche-911-993-turbo-s-1997',
 '00000000-0000-4000-a000-000000000004', '11111111-0000-4000-a000-000000000001',
 'vehicles',
 'Porsche 911 (993) Turbo S — 1997',
 'Uno de 345 ejemplares. Matching numbers, historial completo.',
 'Última generación del 911 refrigerado por aire en su versión más buscada. Ejemplar en Arena Red Metallic con interior en cuero negro, 38,400 km acreditados y libro de servicios completo desde nuevo. Importado a Perú en 2019 con DUA en regla y nacionalización concluida. Mantenimiento realizado por especialista independiente en Lima; última intervención mayor en 2024. Se entrega con herramienta original, manuales y certificado de fábrica.',
 'La Molina', 'Lima', 'Lima', 650000, 780000, 'verified', 'published', 'private',
 '{"make":"Porsche","model":"911 (993) Turbo S","year":1997,"mileage_km":38400,"engine":"3.6 L bóxer biturbo","power_hp":424,"transmission":"Manual 6 velocidades","drivetrain":"AWD","exterior_color":"Arena Red Metallic","interior_color":"Cuero negro","condition":"Concours","matching_numbers":true,"production_units":345,"provenance":"Tercer propietario, historial documentado"}'::jsonb,
 true, true, true, true, true, 4, 2318, now() - interval '15 days'),

('10000000-0000-4000-a000-000000000007', 'mercedes-benz-300-sl-gullwing-1955',
 '00000000-0000-4000-a000-000000000004', '11111111-0000-4000-a000-000000000001',
 'vehicles',
 'Mercedes-Benz 300 SL "Gullwing" — 1955',
 'Restauración integral documentada. Certificado por Mercedes-Benz Classic.',
 'Ejemplar de 1955 con carrocería de acero y puertas de ala de gaviota, sometido a restauración integral entre 2015 y 2018 en Alemania con facturas por el total del proceso. Conserva motor y caja originales según certificado de Mercedes-Benz Classic Center. Colores de entrega: Silver Metallic sobre cuero rojo. Se encuentra en Perú bajo régimen de importación definitiva.',
 'San Isidro', 'Lima', 'Lima', 1600000, 1900000, 'off_market', 'published', 'signature',
 '{"make":"Mercedes-Benz","model":"300 SL Gullwing","year":1955,"mileage_km":54210,"engine":"3.0 L inyección directa","power_hp":215,"transmission":"Manual 4 velocidades","drivetrain":"RWD","exterior_color":"Silver Metallic","interior_color":"Cuero rojo","condition":"Restaurado (concours)","matching_numbers":true,"production_units":1400,"provenance":"Certificado Mercedes-Benz Classic Center"}'::jsonb,
 true, true, true, true, false, null, 489, now() - interval '5 days'),

-- ── Yachts ─────────────────────────────────────────────────────────────────
('10000000-0000-4000-a000-000000000008', 'azimut-grande-27m-paracas',
 '00000000-0000-4000-a000-000000000003', null,
 'yachts',
 'Azimut Grande 27M — amarre en Paracas',
 'Cuatro cabinas, tripulación de tres, matrícula peruana vigente.',
 'Unidad de 2019 con 640 horas de motor, mantenida bajo programa del astillero y con amarre asignado en el club náutico de Paracas. Distribución de cuatro cabinas para ocho huéspedes más alojamiento de tripulación para tres. Flybridge con hardtop, plataforma de baño hidráulica y tender Williams incluido. Matrícula DICAPI vigente y certificados de navegabilidad al día. Puede transferirse con el amarre bajo cesión aprobada por el club.',
 'Paracas', 'Pisco', 'Ica', 4900000, 5600000, 'verified', 'published', 'signature',
 '{"builder":"Azimut Yachts","model":"Grande 27M","year":2019,"length_m":26.9,"beam_m":6.4,"draft_m":1.9,"cabins":4,"berths":8,"crew":3,"engines":"2 × MTU 12V 2000 M96L","engine_hours":640,"cruising_speed_kn":24,"max_speed_kn":30,"range_nm":430,"flag":"Perú","hull_material":"Fibra de vidrio","tender":"Williams Sportjet 435","includes_berth":true}'::jsonb,
 true, true, true, true, true, 5, 831, now() - interval '21 days'),

('10000000-0000-4000-a000-000000000009', 'sunseeker-predator-74-ancon',
 '00000000-0000-4000-a000-000000000004', '11111111-0000-4000-a000-000000000001',
 'yachts',
 'Sunseeker Predator 74 — Ancón',
 'Refit 2023. Un solo propietario desde nueva.',
 'Sport yacht de 2015 con refit integral en 2023 que incluyó tapicería, sistemas de navegación y revisión mayor de motores. Un único propietario desde la entrega, uso exclusivamente recreativo en la costa central. Tres cabinas dobles más cabina de tripulación. Documentación DICAPI completa, sin gravámenes inscritos.',
 'Ancón', 'Lima', 'Lima', 2100000, 2500000, 'verified', 'published', 'private',
 '{"builder":"Sunseeker","model":"Predator 74","year":2015,"refit_year":2023,"length_m":22.6,"beam_m":5.4,"draft_m":1.6,"cabins":3,"berths":6,"crew":1,"engines":"2 × MAN V12 1400","engine_hours":1180,"cruising_speed_kn":28,"max_speed_kn":34,"range_nm":380,"flag":"Perú","hull_material":"GRP"}'::jsonb,
 true, true, false, false, false, null, 402, now() - interval '7 days'),

-- ── Aircraft ───────────────────────────────────────────────────────────────
('10000000-0000-4000-a000-000000000010', 'embraer-phenom-300e-2021-lima',
 '00000000-0000-4000-a000-000000000003', null,
 'aircraft',
 'Embraer Phenom 300E — 2021',
 '1,120 horas totales. Programa de mantenimiento del fabricante al día.',
 'Jet ligero de 2021 con 1,120 horas de célula y 720 ciclos, operado siempre bajo programa Embraer Executive Care. Configuración de nueve asientos con interior en cuero claro, cocina de bordo y lavabo con puerta. Aviónica Garmin G3000 con conectividad Gogo AVANCE. Matrícula peruana vigente ante la DGAC, sin gravámenes. Base operativa en el Aeropuerto Internacional Jorge Chávez con hangar disponible por cesión separada.',
 'Callao', 'Callao', 'Callao', 9500000, 11000000, 'verified', 'published', 'signature',
 '{"manufacturer":"Embraer","model":"Phenom 300E","year":2021,"total_time_hours":1120,"cycles":720,"seats":9,"range_nm":2010,"engines":"2 × Pratt & Whitney PW535E1","avionics":"Garmin G3000","connectivity":"Gogo AVANCE L5","maintenance_program":"Embraer Executive Care","interior_year":2021,"exterior_year":2021,"registration_country":"Perú","home_base":"SPJC — Jorge Chávez"}'::jsonb,
 true, true, true, true, true, 6, 1096, now() - interval '13 days'),

('10000000-0000-4000-a000-000000000011', 'airbus-h145-2020-cusco',
 '00000000-0000-4000-a000-000000000004', null,
 'aircraft',
 'Airbus H145 — 2020, configuración de altura',
 'Certificado para operación en altura. Base Cusco.',
 'Helicóptero bimotor de 2020 con 980 horas totales, configurado para operación en altura y transporte ejecutivo de siete pasajeros. Equipado con sistema de flotación, cabrestante y aviónica Helionix. Operado por compañía con certificado DGAC vigente; puede transferirse con contrato de operación y tripulación. Registro sin cargas ni gravámenes.',
 'Cusco', 'Cusco', 'Cusco', 7200000, 8400000, 'off_market', 'published', 'private',
 '{"manufacturer":"Airbus Helicopters","model":"H145 (D3)","year":2020,"total_time_hours":980,"cycles":1420,"seats":7,"range_nm":351,"engines":"2 × Safran Arriel 2E","avionics":"Helionix Step 2","maintenance_program":"HCare Smart","interior_year":2020,"registration_country":"Perú","home_base":"SPZO — Velasco Astete","high_altitude_kit":true}'::jsonb,
 true, true, false, true, false, null, 288, now() - interval '4 days')

on conflict (id) do nothing;

-- ── Nivel II: precio exacto, dirección exacta, valorización ────────────────
update public.asset_private_details d set
  price_exact = v.price_exact,
  address_exact = v.address_exact,
  latitude = v.lat, longitude = v.lng,
  description_private = v.description_private,
  contact_name = v.contact_name,
  contact_phone = '+51 987 200 100',
  contact_email = 'privado@luxusperu.com',
  registry_reference = v.registry_reference,
  valuation_amount = v.valuation_amount,
  valuation_date = current_date - 60,
  valuation_firm = v.valuation_firm
from (values
  ('10000000-0000-4000-a000-000000000001'::uuid, 4650000, 'Malecón de la Reserva 1215, dpto. 1201-1202, Miraflores, Lima', -12.1289, -77.0322, 'El propietario acepta cierre en 60 días con arras del 10%. Existe una oferta previa desistida por financiamiento.', 'Familia Barrantes', 'Partida N.º 11XXXXXX — Registro de Predios de Lima', 4720000, 'Colliers Perú'),
  ('10000000-0000-4000-a000-000000000002'::uuid, 3150000, 'Asociación Playa Misterio, lote 14, km 97.5 Panamericana Sur, Asia', -12.7912, -76.5231, 'Venta motivada por reubicación familiar al extranjero. Mobiliario incluido según inventario anexo.', 'Familia Barrantes', 'Partida N.º 21XXXXXX — Registro de Predios de Cañete', 3080000, 'Binswanger Perú'),
  ('10000000-0000-4000-a000-000000000003'::uuid, 6800000, 'Fundo Santa Rosa, carretera Subtanjalla km 8, Ica', -14.0331, -75.7570, 'Se prefiere comprador que mantenga la operación y la marca. Posible earn-out sobre producción 2027-2029.', 'Familia Barrantes', 'Partida N.º 30XXXXXX — Registro de Predios de Ica', 7100000, 'Cuatro Ríos Valuaciones'),
  ('10000000-0000-4000-a000-000000000004'::uuid, 21500000, 'Av. Néstor Gambetta 3450, Callao', -12.0264, -77.1177, 'Enterprise value sobre EBITDA normalizado 2025. La deuda financiera se cancela al cierre. Vendedor permanece 18 meses como asesor.', 'Grupo Barrantes', 'Partida N.º 12XXXXXX — Registro de Personas Jurídicas del Callao', 22800000, 'PwC Perú — Deals'),
  ('10000000-0000-4000-a000-000000000005'::uuid, 31000000, 'Calle Garcilaso 210, Urubamba, Cusco (sede administrativa)', -13.3053, -72.1148, 'Tres inmuebles propios se transfieren dentro del paquete accionario. El cuarto opera bajo arrendamiento hasta 2034.', 'Grupo Barrantes', 'Partida N.º 11XXXXXX — Registro de Personas Jurídicas de Cusco', 32400000, 'Deloitte Perú'),
  ('10000000-0000-4000-a000-000000000006'::uuid, 715000, 'Depósito privado, Av. La Molina 1890, La Molina, Lima', -12.0790, -76.9450, 'Precio firme. El propietario no acepta permutas. Inspección presencial coordinada con especialista.', 'Marcela Casanova', 'TIV N.º XXXXXXX — SUNARP Lima', 738000, 'Classic Car Appraisals LATAM'),
  ('10000000-0000-4000-a000-000000000007'::uuid, 1750000, 'Colección privada, San Isidro, Lima (dirección reservada)', -12.0976, -77.0365, 'Operación estrictamente off-market. Solo compradores con fondos verificados y NDA firmado.', 'Marcela Casanova', 'TIV N.º XXXXXXX — SUNARP Lima', 1810000, 'Bonhams Consultancy'),
  ('10000000-0000-4000-a000-000000000008'::uuid, 5250000, 'Marina Turística de Paracas, amarre B-12, Pisco', -13.8380, -76.2500, 'La cesión del amarre requiere aprobación del club y toma entre 30 y 45 días.', 'Familia Barrantes', 'Matrícula DICAPI N.º PE-XXXX', 5330000, 'Marine Survey Perú'),
  ('10000000-0000-4000-a000-000000000009'::uuid, 2280000, 'Club Náutico Ancón, muelle 3, Ancón, Lima', -11.7742, -77.1783, 'Refit 2023 documentado con facturas. El propietario financia hasta el 30% a 24 meses.', 'Marcela Casanova', 'Matrícula DICAPI N.º PE-XXXX', 2340000, 'Marine Survey Perú'),
  ('10000000-0000-4000-a000-000000000010'::uuid, 10250000, 'Hangar 7, Aeropuerto Internacional Jorge Chávez, Callao', -12.0219, -77.1143, 'Precio sin hangar. La cesión del hangar se negocia por separado con el operador.', 'Grupo Barrantes', 'Matrícula DGAC OB-XXXX', 10400000, 'JetVal Appraisals'),
  ('10000000-0000-4000-a000-000000000011'::uuid, 7850000, 'Hangar 2, Aeropuerto Alejandro Velasco Astete, Cusco', -13.5357, -71.9388, 'Puede adquirirse la sociedad operadora con su certificado DGAC. Estructura a definir con el comprador.', 'Marcela Casanova', 'Matrícula DGAC OB-XXXX', 7960000, 'JetVal Appraisals')
) as v(asset_id, price_exact, address_exact, lat, lng, description_private, contact_name, registry_reference, valuation_amount, valuation_firm)
where d.asset_id = v.asset_id;

-- ── Media placeholder (5 fotos públicas + 2 privadas por activo) ───────────
do $$
declare
  a record;
  i integer;
begin
  for a in select id, slug from public.assets order by created_at loop
    for i in 1..5 loop
      insert into public.asset_media (asset_id, kind, bucket, storage_path, is_public, sort_order, alt_text)
      values (
        a.id, 'image', 'public-media',
        'https://picsum.photos/seed/' || a.slug || '-' || i || '/1800/1200',
        true, i,
        'Fotografía ' || i || ' del activo'
      );
    end loop;
    for i in 6..7 loop
      insert into public.asset_media (asset_id, kind, bucket, storage_path, is_public, sort_order, alt_text, caption)
      values (
        a.id, 'image', 'asset-private-media',
        'https://picsum.photos/seed/' || a.slug || '-priv-' || i || '/1800/1200',
        false, i,
        'Material reservado ' || i,
        'Disponible para miembros con acceso Nivel II'
      );
    end loop;
  end loop;
end $$;

-- Checklist de verificación: marcar como verificados los ítems de los activos aprobados
update public.asset_verification_items set
  status = 'verified',
  checked_by = '00000000-0000-4000-a000-000000000001',
  checked_at = now() - interval '20 days'
where asset_id in (
  '10000000-0000-4000-a000-000000000001',
  '10000000-0000-4000-a000-000000000004',
  '10000000-0000-4000-a000-000000000006',
  '10000000-0000-4000-a000-000000000008',
  '10000000-0000-4000-a000-000000000010'
);

-- Un activo con documentación pendiente para poblar la cola del Admin
insert into public.assets (
  id, slug, owner_id, category, title, headline, description_public,
  district, province, region, price_min, price_max, visibility, status, tier, specs
) values (
  '10000000-0000-4000-a000-000000000012', 'departamento-duplex-san-isidro-golf',
  '00000000-0000-4000-a000-000000000003', 'real-estate',
  'Dúplex frente al Lima Golf Club',
  'Vista directa al campo. En revisión de documentación.',
  'Dúplex de 380 m² con vista frontal al Lima Golf Club, en edificio de 2018 con solo dos unidades por planta. Documentación registral en proceso de verificación por el equipo de LUXUS.',
  'San Isidro', 'Lima', 'Lima', 1900000, 2300000, 'verified', 'pending_review', 'private',
  '{"property_type":"Dúplex","bedrooms":3,"bathrooms":4,"parking":3,"built_area_m2":380,"floors":2,"year_built":2018,"view":"Lima Golf Club","condition":"Muy bueno"}'::jsonb
) on conflict (id) do nothing;

insert into public.listing_fees (asset_id, tier, amount_cents, currency, status, quoted_by, due_at, notes)
values
  ('10000000-0000-4000-a000-000000000001', 'signature', 600000, 'USD', 'paid',
   '00000000-0000-4000-a000-000000000001', now() - interval '25 days',
   'Incluye producción fotográfica y dossier bilingüe.'),
  ('10000000-0000-4000-a000-000000000012', 'private', 120000, 'USD', 'pending',
   '00000000-0000-4000-a000-000000000001', now() + interval '10 days',
   'Se cobra al aprobar la publicación.');

-- ============================================================================
-- DEAL ROOM ACTIVO
-- Comprador verificado (Alonso Vialta) sobre el operador logístico del Callao.
-- NDA firmado, árbol documental con versiones, permisos con vencimiento,
-- Q&A vivo y una oferta con contraoferta.
-- ============================================================================

insert into public.deals (
  id, reference_code, asset_id, buyer_id, seller_id, broker_id, stage,
  request_message, intended_use, financing_type, proof_of_funds,
  requested_at, kyc_cleared_at, approved_at, approved_by, nda_signed_at,
  opened_at, expires_at, closing_checklist, success_fee_pct
) values (
  '20000000-0000-4000-a000-000000000001', 'DR-2026-0001',
  '10000000-0000-4000-a000-000000000004',
  '00000000-0000-4000-a000-000000000005',
  '00000000-0000-4000-a000-000000000003',
  '11111111-0000-4000-a000-000000000001',
  'offer',
  'Buscamos una plataforma logística en el Callao para integrarla a nuestra operación agroexportadora. Interés en el 70% ofrecido, con posibilidad de ampliar al 100% en 24 meses.',
  'Adquisición estratégica', 'mixed', true,
  now() - interval '34 days', now() - interval '33 days',
  now() - interval '31 days', '00000000-0000-4000-a000-000000000003',
  now() - interval '29 days', now() - interval '29 days',
  now() + interval '60 days',
  '[
    {"key":"spa_draft","label":"Borrador de contrato de compraventa de acciones","status":"in_progress","owner":"seller"},
    {"key":"escrow_setup","label":"Apertura de escrow con entidad fiduciaria externa","status":"pending","owner":"buyer","note":"LUXUS no interviene en el movimiento de fondos"},
    {"key":"regulatory","label":"Notificación a SUNAT por cambio de titularidad","status":"pending","owner":"seller"},
    {"key":"antitrust","label":"Evaluación previa de concentración (INDECOPI)","status":"pending","owner":"buyer"},
    {"key":"closing_date","label":"Fecha de cierre acordada","status":"pending","owner":"both"}
  ]'::jsonb,
  2.50
) on conflict (id) do nothing;

-- Segundo deal, en fase temprana (para probar la bandeja del seller)
insert into public.deals (
  id, reference_code, asset_id, buyer_id, seller_id, stage,
  request_message, financing_type, requested_at
) values (
  '20000000-0000-4000-a000-000000000002', 'DR-2026-0002',
  '10000000-0000-4000-a000-000000000001',
  '00000000-0000-4000-a000-000000000007',
  '00000000-0000-4000-a000-000000000003',
  'seller_review',
  'Family office con mandato de adquisición residencial prime en Lima. Solicitamos acceso a documentación registral y valorización.',
  'cash', now() - interval '3 days'
) on conflict (id) do nothing;

-- Los dos deals de arriba fijan su `reference_code` a mano ('DR-2026-0001',
-- 'DR-2026-0002'), así que el trigger `assign_deal_reference` nunca llama a
-- `nextval()` para ellos y la secuencia se queda en su valor inicial. Sin
-- este ajuste, el primer Deal Room creado de verdad desde la app choca con
-- 'DR-2026-0001' (unique violation) y la solicitud falla en silencio para
-- quien prueba el flujo. Mismo motivo por el que los activos no tienen este
-- problema: su reference_code no se fija a mano en este seed, así que el
-- trigger sí corre y la secuencia sí avanza.
select setval('public.deal_reference_seq', 2, true);

-- ── NDA firmado ────────────────────────────────────────────────────────────
insert into public.ndas (
  id, deal_id, status, provider, provider_envelope_id, template_version,
  draft_path, signed_path, signed_sha256, signer_name, signer_email,
  sent_at, viewed_at, signed_at, expires_at, provider_audit
) values (
  '40000000-0000-4000-a000-000000000001',
  '20000000-0000-4000-a000-000000000001',
  'signed', 'mock', 'mock_env_5f21ab', 'nda-v1-es-PE',
  'ndas/DR-2026-0001/nda-draft.pdf',
  'ndas/DR-2026-0001/nda-signed.pdf',
  '9c1185a5c5e9fc54612808977ee8f548b2258d31ddcd9b8e5b1f1c9a2a1e9b71',
  'Alonso Vialta Echecopar', 'comprador@vialtafamily.com',
  now() - interval '30 days', now() - interval '30 days', now() - interval '29 days',
  now() + interval '700 days',
  '{"provider":"mock","events":[{"type":"envelope.sent"},{"type":"envelope.viewed"},{"type":"envelope.signed"}],"note":"MOCK: reemplazar por proveedor con validez legal en Perú (Ley 27269)"}'::jsonb
) on conflict (id) do nothing;

-- ── Árbol documental ───────────────────────────────────────────────────────
insert into public.documents (id, asset_id, folder, name, description, verification_key, created_by)
values
  ('30000000-0000-4000-a000-000000000001', '10000000-0000-4000-a000-000000000004', 'corporate',  'Partida electrónica de la sociedad.pdf',        'Copia literal vigente emitida por SUNARP.', 'partida_electronica', '00000000-0000-4000-a000-000000000003'),
  ('30000000-0000-4000-a000-000000000002', '10000000-0000-4000-a000-000000000004', 'corporate',  'Estatuto social consolidado.pdf',               'Texto único concordado a 2025.', null, '00000000-0000-4000-a000-000000000003'),
  ('30000000-0000-4000-a000-000000000003', '10000000-0000-4000-a000-000000000004', 'corporate',  'Vigencia de poder del representante legal.pdf', null, 'vigencia_poder', '00000000-0000-4000-a000-000000000003'),
  ('30000000-0000-4000-a000-000000000004', '10000000-0000-4000-a000-000000000004', 'corporate',  'Cap table y libro de matrícula de acciones.pdf','Estructura accionaria al 31-12-2025.', 'cap_table', '00000000-0000-4000-a000-000000000003'),
  ('30000000-0000-4000-a000-000000000005', '10000000-0000-4000-a000-000000000004', 'financial',  'EEFF auditados 2023-2025.pdf',                  'Auditoría por firma de primer nivel.', 'eeff_auditados', '00000000-0000-4000-a000-000000000003'),
  ('30000000-0000-4000-a000-000000000006', '10000000-0000-4000-a000-000000000004', 'financial',  'EBITDA normalizado y ajustes.xlsx',             'Puente de EBITDA reportado a normalizado.', null, '00000000-0000-4000-a000-000000000003'),
  ('30000000-0000-4000-a000-000000000007', '10000000-0000-4000-a000-000000000004', 'financial',  'Proyecciones 2026-2030.xlsx',                   'Modelo del vendedor. No constituye garantía.', null, '00000000-0000-4000-a000-000000000003'),
  ('30000000-0000-4000-a000-000000000008', '10000000-0000-4000-a000-000000000004', 'financial',  'Detalle de deuda financiera.pdf',               null, null, '00000000-0000-4000-a000-000000000003'),
  ('30000000-0000-4000-a000-000000000009', '10000000-0000-4000-a000-000000000004', 'legal',      'Contratos marco con clientes principales.pdf',  'Diez contratos que concentran el 61% de ingresos.', null, '00000000-0000-4000-a000-000000000003'),
  ('30000000-0000-4000-a000-000000000010', '10000000-0000-4000-a000-000000000004', 'legal',      'Litigios y contingencias.pdf',                  'Informe del estudio legal a marzo 2026.', 'contingencias', '00000000-0000-4000-a000-000000000003'),
  ('30000000-0000-4000-a000-000000000011', '10000000-0000-4000-a000-000000000004', 'legal',      'Licencias y autorizaciones SUNAT.pdf',          'Depósito temporal, agencia de aduanas y OEA.', null, '00000000-0000-4000-a000-000000000003'),
  ('30000000-0000-4000-a000-000000000012', '10000000-0000-4000-a000-000000000004', 'tax',        'Ficha RUC y situación tributaria.pdf',          null, 'ficha_ruc', '00000000-0000-4000-a000-000000000003'),
  ('30000000-0000-4000-a000-000000000013', '10000000-0000-4000-a000-000000000004', 'tax',        'Declaraciones juradas anuales 2023-2025.pdf',   null, null, '00000000-0000-4000-a000-000000000003'),
  ('30000000-0000-4000-a000-000000000014', '10000000-0000-4000-a000-000000000004', 'technical',  'Plano y certificado del almacén.pdf',           'Almacén de 34,000 m² en Av. Néstor Gambetta.', null, '00000000-0000-4000-a000-000000000003'),
  ('30000000-0000-4000-a000-000000000015', '10000000-0000-4000-a000-000000000004', 'technical',  'Inventario de equipos y flota.xlsx',            null, null, '00000000-0000-4000-a000-000000000003'),
  ('30000000-0000-4000-a000-000000000016', '10000000-0000-4000-a000-000000000004', 'commercial', 'Cartera de clientes y concentración.pdf',       'Anonimizado en versión 1; nominal en versión 2.', null, '00000000-0000-4000-a000-000000000003'),
  ('30000000-0000-4000-a000-000000000017', '10000000-0000-4000-a000-000000000004', 'commercial', 'Tarifario y márgenes por servicio.pdf',         null, null, '00000000-0000-4000-a000-000000000003')
on conflict (id) do nothing;

-- Versiones (algunas con historial para probar restauración)
do $$
declare d record;
begin
  for d in select id, name from public.documents where asset_id = '10000000-0000-4000-a000-000000000004' loop
    insert into public.document_versions (
      document_id, version, bucket, storage_path, file_name, mime_type,
      size_bytes, sha256, page_count, change_note, uploaded_by, created_at
    ) values (
      d.id, 1, 'deal-documents',
      'assets/10000000-0000-4000-a000-000000000004/' || d.id || '/v1.pdf',
      d.name, case when d.name like '%.xlsx'
        then 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
        else 'application/pdf' end,
      420000 + (random() * 3000000)::bigint,
      encode(extensions.digest(d.id::text || 'v1', 'sha256'), 'hex'),
      (8 + random() * 40)::int, 'Carga inicial',
      '00000000-0000-4000-a000-000000000003', now() - interval '33 days'
    );
  end loop;

  -- Versión 2 en tres documentos
  for d in select id, name from public.documents
           where id in ('30000000-0000-4000-a000-000000000005',
                        '30000000-0000-4000-a000-000000000010',
                        '30000000-0000-4000-a000-000000000016') loop
    insert into public.document_versions (
      document_id, version, bucket, storage_path, file_name, mime_type,
      size_bytes, sha256, page_count, change_note, uploaded_by, created_at
    ) values (
      d.id, 2, 'deal-documents',
      'assets/10000000-0000-4000-a000-000000000004/' || d.id || '/v2.pdf',
      d.name, 'application/pdf',
      620000 + (random() * 2000000)::bigint,
      encode(extensions.digest(d.id::text || 'v2', 'sha256'), 'hex'),
      (10 + random() * 40)::int,
      'Actualización solicitada por el comprador en due diligence',
      '00000000-0000-4000-a000-000000000003', now() - interval '9 days'
    );
  end loop;
end $$;

-- ── Permisos por documento y usuario, con vencimiento ──────────────────────
-- Todo el árbol salvo comercial nominal; un permiso vence en 4 días y otro ya venció.
insert into public.document_permissions (document_id, deal_id, user_id, level, granted_by, granted_at, expires_at, view_count, download_count, last_accessed_at)
select
  doc.id,
  '20000000-0000-4000-a000-000000000001',
  '00000000-0000-4000-a000-000000000005',
  case when doc.folder in ('corporate','technical') then 'download'::public.permission_level
       else 'view'::public.permission_level end,
  '00000000-0000-4000-a000-000000000003',
  now() - interval '29 days',
  case
    when doc.id = '30000000-0000-4000-a000-000000000007' then now() + interval '4 days'
    when doc.id = '30000000-0000-4000-a000-000000000017' then now() - interval '2 days'
    else now() + interval '45 days'
  end,
  (random() * 14)::int,
  (random() * 4)::int,
  now() - (random() * 8 || ' days')::interval
from public.documents doc
where doc.asset_id = '10000000-0000-4000-a000-000000000004'
  and doc.id <> '30000000-0000-4000-a000-000000000016'
on conflict do nothing;

-- ── Q&A ────────────────────────────────────────────────────────────────────
insert into public.qa_threads (id, deal_id, subject, document_id, folder, created_by, last_message_at, message_count, created_at)
values
  ('50000000-0000-4000-a000-000000000001', '20000000-0000-4000-a000-000000000001',
   'Normalización de EBITDA 2025: partidas extraordinarias',
   '30000000-0000-4000-a000-000000000006', 'financial',
   '00000000-0000-4000-a000-000000000005', now() - interval '2 days', 3, now() - interval '12 days'),
  ('50000000-0000-4000-a000-000000000002', '20000000-0000-4000-a000-000000000001',
   'Vigencia de la autorización de depósito temporal',
   '30000000-0000-4000-a000-000000000011', 'legal',
   '00000000-0000-4000-a000-000000000005', now() - interval '6 days', 2, now() - interval '8 days'),
  ('50000000-0000-4000-a000-000000000003', '20000000-0000-4000-a000-000000000001',
   'Concentración de cartera: acceso a nombres de clientes',
   '30000000-0000-4000-a000-000000000016', 'commercial',
   '00000000-0000-4000-a000-000000000005', now() - interval '1 day', 1, now() - interval '1 day')
on conflict (id) do nothing;

-- Los triggers recalculan message_count; se inserta el hilo y luego los mensajes.
update public.qa_threads set message_count = 0
where deal_id = '20000000-0000-4000-a000-000000000001';

insert into public.qa_messages (thread_id, deal_id, author_id, body, created_at) values
  ('50000000-0000-4000-a000-000000000001', '20000000-0000-4000-a000-000000000001',
   '00000000-0000-4000-a000-000000000005',
   'En el puente de EBITDA aparecen USD 840,000 clasificados como “gastos no recurrentes 2024”. ¿Pueden desglosar esa partida y adjuntar los comprobantes de respaldo?',
   now() - interval '12 days'),
  ('50000000-0000-4000-a000-000000000001', '20000000-0000-4000-a000-000000000001',
   '00000000-0000-4000-a000-000000000003',
   'Corresponde a la indemnización por el cese del contrato de arrendamiento del almacén de Ventanilla (USD 610,000) y a honorarios legales del proceso laboral cerrado en 2024 (USD 230,000). Subimos el detalle como versión 2 del documento.',
   now() - interval '10 days'),
  ('50000000-0000-4000-a000-000000000001', '20000000-0000-4000-a000-000000000001',
   '00000000-0000-4000-a000-000000000005',
   'Recibido. Nuestro asesor confirma que el ajuste es razonable. Mantendremos la partida como no recurrente en nuestro modelo.',
   now() - interval '2 days'),
  ('50000000-0000-4000-a000-000000000002', '20000000-0000-4000-a000-000000000001',
   '00000000-0000-4000-a000-000000000005',
   '¿La autorización de depósito temporal se renueva automáticamente o requiere trámite ante SUNAT tras el cambio de titularidad accionaria?',
   now() - interval '8 days'),
  ('50000000-0000-4000-a000-000000000002', '20000000-0000-4000-a000-000000000001',
   '00000000-0000-4000-a000-000000000003',
   'La autorización es de la sociedad, no del accionista, por lo que no caduca con la transferencia. Sí corresponde comunicar el cambio dentro de los 30 días siguientes. El informe legal en la carpeta Legal desarrolla el punto.',
   now() - interval '6 days'),
  ('50000000-0000-4000-a000-000000000003', '20000000-0000-4000-a000-000000000001',
   '00000000-0000-4000-a000-000000000005',
   'Para cerrar la valorización necesitamos los nombres de los diez clientes que concentran el 61% de ingresos. Entendemos la sensibilidad; podemos firmar un anexo de confidencialidad reforzada.',
   now() - interval '1 day');

-- ── Ofertas ────────────────────────────────────────────────────────────────
insert into public.offers (
  id, deal_id, author_id, round, amount, currency, payment_structure,
  deposit_amount, conditions, dd_period_days, exclusivity_days, valid_until,
  status, responded_by, responded_at, response_note, created_at
) values
  ('60000000-0000-4000-a000-000000000001', '20000000-0000-4000-a000-000000000001',
   '00000000-0000-4000-a000-000000000005', 1, 19200000, 'USD', 'mixed',
   1920000,
   'Oferta por el 70% del capital social. Sujeta a due diligence confirmatoria de 45 días, a que la deuda financiera se cancele al cierre y a la permanencia del accionista vendedor como asesor por 18 meses.',
   45, 60, now() - interval '10 days', 'countered',
   '00000000-0000-4000-a000-000000000003', now() - interval '12 days',
   'Agradecemos la oferta. El múltiplo implícito queda por debajo de comparables recientes del sector.',
   now() - interval '15 days'),
  ('60000000-0000-4000-a000-000000000002', '20000000-0000-4000-a000-000000000001',
   '00000000-0000-4000-a000-000000000003', 2, 21800000, 'USD', 'mixed',
   2180000,
   'Contraoferta por el mismo 70%. Due diligence de 30 días, exclusividad de 45 días y earn-out de hasta USD 1,200,000 sujeto a EBITDA 2027.',
   30, 45, now() + interval '12 days', 'submitted',
   null, null, null, now() - interval '12 days')
on conflict (id) do nothing;

update public.offers set parent_offer_id = '60000000-0000-4000-a000-000000000001'
where id = '60000000-0000-4000-a000-000000000002';

-- ============================================================================
-- AUDITORÍA · NOTIFICACIONES · INTELLIGENCE · CRM · SOLICITUDES
-- ============================================================================

insert into public.audit_logs (
  actor_id, actor_email, actor_role, action, entity_type, entity_id,
  deal_id, asset_id, document_id, document_version, ip_address, user_agent, metadata, created_at
)
select
  '00000000-0000-4000-a000-000000000005', 'comprador@vialtafamily.com', 'buyer',
  case when random() < 0.7 then 'document.view' else 'document.download' end,
  'document', dp.document_id,
  '20000000-0000-4000-a000-000000000001',
  '10000000-0000-4000-a000-000000000004',
  dp.document_id, 1,
  ('190.117.44.' || (10 + (random() * 200)::int))::inet,
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Safari/537.36',
  '{"watermark":true,"signed_url_ttl":300}'::jsonb,
  now() - (random() * 25 || ' days')::interval
from public.document_permissions dp
where dp.deal_id = '20000000-0000-4000-a000-000000000001';

insert into public.audit_logs (actor_id, actor_email, actor_role, action, entity_type, entity_id, deal_id, asset_id, ip_address, user_agent, metadata, created_at) values
  ('00000000-0000-4000-a000-000000000005','comprador@vialtafamily.com','buyer','deal.access_requested','deal','20000000-0000-4000-a000-000000000001','20000000-0000-4000-a000-000000000001','10000000-0000-4000-a000-000000000004','190.117.44.21','Mozilla/5.0','{}'::jsonb, now() - interval '34 days'),
  ('00000000-0000-4000-a000-000000000001','admin@luxusperu.com','admin','kyc.approved','profile','00000000-0000-4000-a000-000000000005',null,null,'200.48.12.9','Mozilla/5.0','{"provider":"mock"}'::jsonb, now() - interval '38 days'),
  ('00000000-0000-4000-a000-000000000003','vendedor@patrimonioandino.pe','seller','deal.approved','deal','20000000-0000-4000-a000-000000000001','20000000-0000-4000-a000-000000000001','10000000-0000-4000-a000-000000000004','181.65.7.33','Mozilla/5.0','{}'::jsonb, now() - interval '31 days'),
  ('00000000-0000-4000-a000-000000000005','comprador@vialtafamily.com','buyer','nda.signed','nda','40000000-0000-4000-a000-000000000001','20000000-0000-4000-a000-000000000001','10000000-0000-4000-a000-000000000004','190.117.44.21','Mozilla/5.0','{"sha256":"9c1185a5c5e9fc54612808977ee8f548b2258d31ddcd9b8e5b1f1c9a2a1e9b71"}'::jsonb, now() - interval '29 days'),
  ('00000000-0000-4000-a000-000000000003','vendedor@patrimonioandino.pe','seller','permission.granted','permission','30000000-0000-4000-a000-000000000005','20000000-0000-4000-a000-000000000001','10000000-0000-4000-a000-000000000004','181.65.7.33','Mozilla/5.0','{"level":"view","expires_in_days":45}'::jsonb, now() - interval '29 days'),
  ('00000000-0000-4000-a000-000000000005','comprador@vialtafamily.com','buyer','offer.submitted','offer','60000000-0000-4000-a000-000000000001','20000000-0000-4000-a000-000000000001','10000000-0000-4000-a000-000000000004','190.117.44.21','Mozilla/5.0','{"amount":19200000}'::jsonb, now() - interval '15 days'),
  ('00000000-0000-4000-a000-000000000003','vendedor@patrimonioandino.pe','seller','offer.countered','offer','60000000-0000-4000-a000-000000000002','20000000-0000-4000-a000-000000000001','10000000-0000-4000-a000-000000000004','181.65.7.33','Mozilla/5.0','{"amount":21800000}'::jsonb, now() - interval '12 days');

insert into public.notifications (user_id, type, title, body, link, deal_id, asset_id, severity, created_at, read_at) values
  ('00000000-0000-4000-a000-000000000005','offer.countered','Contraoferta recibida','El vendedor respondió con USD 21,800,000 por el 70% del capital.','/deal/20000000-0000-4000-a000-000000000001','20000000-0000-4000-a000-000000000001','10000000-0000-4000-a000-000000000004','info', now() - interval '12 days', null),
  ('00000000-0000-4000-a000-000000000005','permission.expiring','Un acceso vence en 4 días','Su permiso sobre “Proyecciones 2026-2030.xlsx” vence pronto.','/deal/20000000-0000-4000-a000-000000000001','20000000-0000-4000-a000-000000000001',null,'warning', now() - interval '1 day', null),
  ('00000000-0000-4000-a000-000000000003','qa.new_question','Nueva pregunta en el Deal Room','Concentración de cartera: acceso a nombres de clientes.','/deal/20000000-0000-4000-a000-000000000001','20000000-0000-4000-a000-000000000001',null,'info', now() - interval '1 day', null),
  ('00000000-0000-4000-a000-000000000003','deal.access_requested','Nueva solicitud de Deal Room','Quintanilla Family Office solicitó acceso al penthouse de Miraflores.','/dashboard/seller/requests','20000000-0000-4000-a000-000000000002','10000000-0000-4000-a000-000000000001','info', now() - interval '3 days', null),
  ('00000000-0000-4000-a000-000000000005','kyc.approved','Verificación aprobada','Su verificación KYC fue aprobada. Ya tiene acceso Nivel II.','/dashboard',null,null,'success', now() - interval '38 days', now() - interval '37 days');

-- ── Intelligence ───────────────────────────────────────────────────────────
insert into public.articles (
  slug, title, subtitle, excerpt, body_md, category, tags, reading_time,
  status, is_members_only, author_id, author_name, published_at, seo
) values
(
  'mercado-residencial-prime-lima-2026',
  'El residencial prime de Lima entra en su ciclo más selectivo',
  'Menos operaciones, tickets mayores y un comprador que exige trazabilidad registral.',
  'La oferta sobre USD 2 millones en Lima se concentra en seis distritos y rota cada vez más despacio. Analizamos qué explica el alargamiento de los plazos de venta y por qué la verificación previa se ha vuelto el principal acelerador de transacción.',
  E'## Un mercado que se estrecha\n\nEl segmento residencial por encima de los dos millones de dólares en Lima se concentra en seis distritos: San Isidro, Miraflores, Barranco, La Molina, Santiago de Surco y San Borja. Entre 2023 y 2025 el número de operaciones registradas en ese rango cayó, mientras el ticket medio subió.\n\nLa lectura simple sería enfriamiento. La lectura correcta es selectividad.\n\n## Qué alarga los plazos\n\nEn las operaciones que hemos acompañado, el tiempo entre acuerdo de precio y firma rara vez se explica por el financiamiento. Se explica por documentación:\n\n- Partidas registrales con cargas no levantadas de préstamos ya cancelados.\n- Independizaciones incompletas en edificios de menos de diez unidades.\n- Diferencias entre el área construida declarada en la HR y la que figura en la licencia de edificación.\n\nCada uno de estos puntos añade entre tres y ocho semanas.\n\n## La verificación previa como acelerador\n\nCuando la copia literal, el CRI y el estado de arbitrios se levantan **antes** de salir al mercado, el plazo medio entre oferta y escritura se reduce de forma consistente. No es un servicio accesorio: es lo que separa una operación que cierra de una que se cae.\n\n## Perspectiva 2026\n\nEsperamos que la brecha entre activos verificados y no verificados se amplíe. El comprador de este segmento no negocia el precio de la incertidumbre: se retira.',
  'Market Report', array['Lima','Residencial','Verificación'], 6,
  'published', false, '00000000-0000-4000-a000-000000000002', 'Sebastián Rioja',
  now() - interval '14 days',
  '{"title":"El residencial prime de Lima entra en su ciclo más selectivo | LUXUS PERÚ","description":"Análisis del segmento sobre USD 2 millones en Lima: concentración por distrito, plazos de transacción y el peso de la verificación registral."}'::jsonb
),
(
  'que-mira-un-comprador-de-empresas-en-peru',
  'Qué mira realmente un comprador de empresas en Perú',
  'Seis puntos que deciden si una operación de M&A del mid-market llega a LOI.',
  'Del EBITDA normalizado a la vigencia de licencias sectoriales: el orden de prioridades que hemos observado en compradores estratégicos y financieros que operan en el mercado peruano.',
  E'## 1. EBITDA normalizado, no reportado\n\nLa primera pregunta del comprador serio nunca es el múltiplo. Es qué hay dentro del EBITDA. Gastos del accionista, alquileres a partes relacionadas por debajo de mercado y partidas extraordinarias mal clasificadas son los tres ajustes que más veces cambian el precio.\n\n## 2. Concentración de clientes\n\nUn cliente que representa más del 25% de los ingresos no descalifica la operación, pero traslada valor del precio al earn-out.\n\n## 3. Licencias y autorizaciones\n\nEn sectores regulados —aduanas, salud, educación, transporte— la pregunta es si la autorización pertenece a la sociedad o al titular. Si pertenece al titular, la estructura de la operación cambia por completo.\n\n## 4. Pasivo laboral\n\nLa contingencia laboral no declarada es el hallazgo más frecuente en due diligence en Perú. Cuantificarla antes de salir al mercado evita renegociaciones.\n\n## 5. Estructura societaria y poderes\n\nVigencia de poder desactualizada, acciones sin inscribir en la matrícula, y accionistas minoritarios no localizables retrasan cierres de forma rutinaria.\n\n## 6. Permanencia del vendedor\n\nEn el mid-market peruano, buena parte del valor sigue estando en la relación comercial del fundador. La disposición a permanecer entre 12 y 24 meses es, con frecuencia, la variable que cierra la brecha de precio.',
  'Sector', array['M&A','Empresas','Due diligence'], 7,
  'published', false, '00000000-0000-4000-a000-000000000002', 'Sebastián Rioja',
  now() - interval '28 days',
  '{"title":"Qué mira un comprador de empresas en Perú | LUXUS PERÚ","description":"Los seis factores que determinan si una operación de M&A del mid-market peruano llega a carta de intención."}'::jsonb
),
(
  'activos-de-coleccion-y-registro-en-peru',
  'Activos de colección: el registro importa más que la carrocería',
  'Vehículos, yates y aeronaves comparten un problema y una solución.',
  'TIV, matrícula DICAPI y registro DGAC. Tres registros distintos, una misma consecuencia cuando la documentación no acompaña al activo.',
  E'## El activo y su papel\n\nEn activos de colección, el estado físico se puede inspeccionar en una tarde. El estado registral, no.\n\nEn Perú conviven tres regímenes:\n\n| Activo | Registro | Documento clave |\n|---|---|---|\n| Vehículos | SUNARP / MTC | Tarjeta de Identificación Vehicular |\n| Embarcaciones | DICAPI | Certificado de matrícula |\n| Aeronaves | DGAC | Certificado de matrícula y aeronavegabilidad |\n\n## Los tres hallazgos recurrentes\n\n1. **Gravámenes vigentes** por financiamientos cancelados sin levantamiento inscrito.\n2. **Importación inconclusa**, con DUA que no cierra el ciclo de nacionalización.\n3. **Discrepancia de números de serie** entre el activo físico y el registro.\n\n## Antes de negociar\n\nSolicitar el certificado de gravámenes correspondiente antes de la primera visita cuesta poco y evita el 80% de las operaciones que se caen tarde.',
  'Regulation', array['Vehículos','Yates','Aeronaves','SUNARP','DICAPI','DGAC'], 5,
  'published', false, '00000000-0000-4000-a000-000000000001', 'Adriana Málaga',
  now() - interval '41 days',
  '{"title":"Activos de colección y registro en Perú | LUXUS PERÚ","description":"Cómo funcionan los registros de vehículos, embarcaciones y aeronaves en Perú y qué revisar antes de negociar."}'::jsonb
),
(
  'off-market-peru-primer-trimestre-2026',
  'Off-market: lo que no llega a publicarse',
  'Una lectura del inventario reservado del primer trimestre.',
  'Reporte reservado para miembros: composición, rangos y tiempos del inventario que nunca se publica.',
  E'## Nota para miembros\n\nEste reporte recoge operaciones que no se publican en ninguna colección. Su circulación está restringida a miembros verificados.\n\n## Composición del trimestre\n\nEl inventario off-market del trimestre se concentró en participaciones societarias y residencial de playa. La proporción de mandatos con exclusividad subió respecto del trimestre anterior.\n\n## Tiempos\n\nEl activo off-market no se mueve más rápido: se mueve con menos contrapartes. La media de compradores contactados por mandato se mantiene por debajo de cinco.',
  'Market Report', array['Off-market','Reservado'], 4,
  'published', true, '00000000-0000-4000-a000-000000000002', 'Sebastián Rioja',
  now() - interval '6 days',
  '{"title":"Off-market Perú — Q1 2026 | LUXUS PERÚ","description":"Reporte reservado para miembros verificados."}'::jsonb
),
(
  'borrador-family-offices-peru',
  'Family offices peruanos y la asignación a activos reales',
  'Borrador en preparación.',
  'Trabajo en curso.',
  E'## Borrador\n\nPendiente de completar con entrevistas.',
  'Wealth', array['Family office'], 3,
  'draft', false, '00000000-0000-4000-a000-000000000002', 'Sebastián Rioja',
  null, '{}'::jsonb
)
on conflict (slug) do nothing;

-- ── Solicitudes de Private Access ──────────────────────────────────────────
insert into public.private_access_requests (
  applicant_profile, full_name, email, phone, company, city, interest,
  budget_range, message, source, status, created_at
) values
  ('family_office','Isabel Ferreyros','iferreyros@fofamiliar.pe','+51 999 333 111','Ferreyros Family Office','Lima','real-estate, companies','USD 10-30M','Buscamos diversificar hacia activos reales en Perú con foco en residencial prime y participaciones minoritarias.','referral','pending', now() - interval '2 days'),
  ('buyer','Diego Salaverry','dsalaverry@protonmail.com','+51 987 111 222',null,'Arequipa','vehicles','USD 500K-1M','Colección privada de deportivos alemanes de los 90.','inbound','pending', now() - interval '5 days'),
  ('seller','Grupo Marítimo del Sur','contacto@gmsur.pe','+51 954 777 888','Grupo Marítimo del Sur S.A.C.','Pisco','yachts','—','Deseamos listar dos embarcaciones de la flota corporativa.','inbound','pending', now() - interval '1 day'),
  ('broker','Rodrigo Ampuero','rampuero@ampueroestates.pe','+51 998 222 444','Ampuero Estates','Lima','real-estate','—','Bróker con doce años en residencial prime. Cartera de seis mandatos exclusivos.','inbound','approved', now() - interval '30 days');

-- ── CRM ────────────────────────────────────────────────────────────────────
insert into public.leads (kind, stage, name, email, phone, company, category, estimated_value, source, message, assigned_to, next_action, next_action_at, created_by, created_at) values
  ('seller_pipeline','documentation','Familia Zavaleta','zavaleta.patrimonio@gmail.com','+51 999 456 789',null,'real-estate',5200000,'referral','Casona republicana en Barranco, 1,400 m². Requiere saneamiento de independización.','00000000-0000-4000-a000-000000000002','Recibir copia literal actualizada de SUNARP', now() + interval '3 days','00000000-0000-4000-a000-000000000001', now() - interval '22 days'),
  ('seller_pipeline','interested','Corporación Andina de Alimentos','cfo@caalimentos.pe','+51 954 111 000','Corporación Andina de Alimentos S.A.','companies',42000000,'outbound','Evalúan venta del 60% de la unidad de congelados.','00000000-0000-4000-a000-000000000001','Enviar carta de mandato y NDA', now() + interval '5 days','00000000-0000-4000-a000-000000000001', now() - interval '14 days'),
  ('seller_pipeline','contacted','Coleccionista privado — Trujillo','cdiaz.classics@gmail.com','+51 949 222 333',null,'vehicles',2400000,'referral','Cuatro unidades italianas de los 60. Ubicadas en Trujillo.','00000000-0000-4000-a000-000000000002','Primera videollamada de valorización', now() + interval '2 days','00000000-0000-4000-a000-000000000002', now() - interval '6 days'),
  ('seller_pipeline','approved','Naviera Costa Verde','gerencia@costaverde.pe','+51 955 888 111','Naviera Costa Verde S.A.C.','yachts',3100000,'inbound','Aprobado para listar. Pendiente producción fotográfica.','00000000-0000-4000-a000-000000000001','Coordinar sesión fotográfica en Paracas', now() + interval '7 days','00000000-0000-4000-a000-000000000001', now() - interval '40 days'),
  ('buyer_enquiry','contacted','Alonso Vialta','comprador@vialtafamily.com','+51 987 654 321','Vialta Family','companies',21000000,'enquiry','Consulta privada sobre el operador logístico del Callao. Convertido en Deal Room DR-2026-0001.','00000000-0000-4000-a000-000000000001','Seguimiento de contraoferta', now() + interval '1 day','00000000-0000-4000-a000-000000000001', now() - interval '35 days'),
  ('buyer_enquiry','interested','Camila Otero','cotero@oterocapital.com','+51 986 300 200','Otero Capital','real-estate',4500000,'enquiry','Interesada en el penthouse de Miraflores. Aún sin KYC.','00000000-0000-4000-a000-000000000002','Invitar a completar verificación', now() + interval '2 days','00000000-0000-4000-a000-000000000002', now() - interval '4 days');

insert into public.lead_notes (lead_id, author_id, body)
select l.id, '00000000-0000-4000-a000-000000000001',
  'Llamada de 40 minutos. Confirman disposición a mandato en exclusiva por seis meses. Falta acuerdo sobre listing fee.'
from public.leads l where l.email = 'cfo@caalimentos.pe';

insert into public.lead_notes (lead_id, author_id, body)
select l.id, '00000000-0000-4000-a000-000000000002',
  'La independización de la casona requiere trámite municipal previo. Estimado: 8 a 10 semanas. Se sugiere no listar antes de tener el CRI.'
from public.leads l where l.email = 'zavaleta.patrimonio@gmail.com';

-- ── Watchlist ──────────────────────────────────────────────────────────────
insert into public.watchlist (user_id, asset_id, note) values
  ('00000000-0000-4000-a000-000000000005','10000000-0000-4000-a000-000000000001','Alternativa residencial si no avanza el deal logístico.'),
  ('00000000-0000-4000-a000-000000000005','10000000-0000-4000-a000-000000000010',null),
  ('00000000-0000-4000-a000-000000000007','10000000-0000-4000-a000-000000000003','Revisar derechos de agua.')
on conflict do nothing;

-- ── Vistas de activo (estadísticas del seller) ─────────────────────────────
insert into public.asset_views (asset_id, viewer_id, is_member, created_at)
select a.id,
       case when random() < 0.3 then '00000000-0000-4000-a000-000000000005'::uuid else null end,
       random() < 0.3,
       now() - (random() * 30 || ' days')::interval
from public.assets a, generate_series(1, 40)
where a.status = 'published';

-- Recalcular contadores de Q&A por si el trigger no corrió en el orden esperado
update public.qa_threads t
set message_count = (select count(*) from public.qa_messages m where m.thread_id = t.id),
    last_message_at = coalesce(
      (select max(m.created_at) from public.qa_messages m where m.thread_id = t.id),
      t.created_at);

analyze;
