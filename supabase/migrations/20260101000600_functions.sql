-- ============================================================================
-- LUXUS PERÚ · 0600 — Helpers de autorización, triggers y jobs
--
-- Todas las funciones de autorización viven en el esquema `luxus`, son
-- SECURITY DEFINER con search_path fijo y STABLE, para poder consultarse desde
-- las políticas RLS sin recursión infinita.
-- ============================================================================

-- ── Identidad ──────────────────────────────────────────────────────────────
create or replace function luxus.actor_role()
returns public.user_role
language sql stable security definer set search_path = public, pg_temp as $$
  select p.role from public.profiles p where p.id = auth.uid();
$$;

create or replace function luxus.is_admin()
returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select exists (
    select 1 from public.profiles p
    where p.id = auth.uid() and p.role = 'admin' and not p.is_suspended
  );
$$;

create or replace function luxus.is_active()
returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select exists (
    select 1 from public.profiles p where p.id = auth.uid() and not p.is_suspended
  );
$$;

-- Miembro verificado = Nivel II. Exige KYC aprobado y screening no bloqueante.
create or replace function luxus.is_verified_member()
returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select exists (
    select 1 from public.profiles p
    where p.id = auth.uid()
      and not p.is_suspended
      and p.kyc_status = 'approved'
      and p.screening_status in ('clear', 'flagged')
  );
$$;

-- ── Activos ────────────────────────────────────────────────────────────────
create or replace function luxus.owns_asset(p_asset_id uuid)
returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select exists (
    select 1
    from public.assets a
    left join public.brokers b on b.id = a.broker_id
    where a.id = p_asset_id
      and (a.owner_id = auth.uid() or b.user_id = auth.uid())
  );
$$;

-- ── Deals ──────────────────────────────────────────────────────────────────
create or replace function luxus.is_deal_party(p_deal_id uuid)
returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select exists (
    select 1
    from public.deals d
    left join public.brokers b on b.id = d.broker_id
    where d.id = p_deal_id
      and (d.buyer_id = auth.uid() or d.seller_id = auth.uid() or b.user_id = auth.uid())
  );
$$;

-- Deal Room abierto: NDA firmado, no vencido, y ninguna de las partes suspendida.
create or replace function luxus.deal_room_open(p_deal_id uuid)
returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select exists (
    select 1 from public.deals d
    where d.id = p_deal_id
      and d.stage in ('nda_signed','qa','offer','loi','due_diligence','closing','closed')
      and (d.expires_at is null or d.expires_at > now())
  );
$$;

-- Nivel II sobre un activo concreto: dueño/bróker/admin, o comprador con Deal
-- Room abierto sobre ese activo.
create or replace function luxus.can_view_asset_private(p_asset_id uuid)
returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select
    luxus.is_admin()
    or luxus.owns_asset(p_asset_id)
    or exists (
      select 1 from public.deals d
      where d.asset_id = p_asset_id
        and d.buyer_id = auth.uid()
        and d.stage in ('nda_signed','qa','offer','loi','due_diligence','closing','closed')
        and (d.expires_at is null or d.expires_at > now())
    );
$$;

-- ── Documentos ─────────────────────────────────────────────────────────────
-- Un permiso es válido si: existe, no está revocado, no ha expirado, el deal
-- sigue abierto y el usuario está verificado y activo.
create or replace function luxus.has_document_permission(p_document_id uuid, p_level public.permission_level default 'view')
returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select exists (
    select 1
    from public.document_permissions dp
    join public.deals d on d.id = dp.deal_id
    join public.profiles pr on pr.id = dp.user_id
    where dp.document_id = p_document_id
      and dp.user_id = auth.uid()
      and dp.revoked_at is null
      and (dp.expires_at is null or dp.expires_at > now())
      and (p_level = 'view' or dp.level = 'download')
      and d.stage in ('nda_signed','qa','offer','loi','due_diligence','closing','closed')
      and (d.expires_at is null or d.expires_at > now())
      and pr.kyc_status = 'approved'
      and not pr.is_suspended
  );
$$;

create or replace function luxus.can_read_document(p_document_id uuid)
returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select
    luxus.is_admin()
    or exists (
      select 1 from public.documents doc
      where doc.id = p_document_id and luxus.owns_asset(doc.asset_id)
    )
    or luxus.has_document_permission(p_document_id, 'view');
$$;

grant execute on all functions in schema luxus to authenticated, anon, service_role;

-- ============================================================================
-- Triggers
-- ============================================================================

create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

do $$
declare t text;
begin
  foreach t in array array[
    'profiles','brokers','assets','asset_private_details','kyc_cases','deals',
    'ndas','documents','articles','leads','subscriptions','lois'
  ] loop
    execute format(
      'create trigger set_updated_at before update on public.%I
         for each row execute function public.set_updated_at()', t);
  end loop;
end $$;

-- ── Alta de usuario: crea perfil y preferencias ────────────────────────────
create or replace function public.handle_new_user()
returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  insert into public.profiles (id, email, full_name, role, phone)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data ->> 'full_name', new.raw_user_meta_data ->> 'name'),
    coalesce((new.raw_user_meta_data ->> 'role')::public.user_role, 'buyer'),
    new.raw_user_meta_data ->> 'phone'
  )
  on conflict (id) do nothing;

  insert into public.notification_preferences (user_id)
  values (new.id)
  on conflict (user_id) do nothing;

  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ── access_level derivado del estado KYC ───────────────────────────────────
create or replace function public.sync_access_level()
returns trigger language plpgsql as $$
begin
  if new.role = 'admin' then
    new.access_level := 3;
  elsif new.kyc_status = 'approved'
        and new.screening_status <> 'blocked'
        and not new.is_suspended then
    new.access_level := greatest(new.access_level, 2);
  else
    new.access_level := 1;
  end if;
  return new;
end;
$$;

create trigger profiles_sync_access_level
  before insert or update of kyc_status, screening_status, is_suspended, role
  on public.profiles
  for each row execute function public.sync_access_level();

-- ── Historial de etapas del deal ───────────────────────────────────────────
create or replace function public.log_deal_stage_change()
returns trigger language plpgsql as $$
begin
  if tg_op = 'INSERT' then
    insert into public.deal_stage_history (deal_id, from_stage, to_stage, actor_id)
    values (new.id, null, new.stage, auth.uid());
  elsif new.stage is distinct from old.stage then
    new.stage_changed_at := now();
    insert into public.deal_stage_history (deal_id, from_stage, to_stage, actor_id)
    values (new.id, old.stage, new.stage, auth.uid());
  end if;
  return new;
end;
$$;

create trigger deals_stage_history_ins
  after insert on public.deals
  for each row execute function public.log_deal_stage_change();

create trigger deals_stage_history_upd
  before update of stage on public.deals
  for each row execute function public.log_deal_stage_change();

-- ── Versionado de documentos ───────────────────────────────────────────────
create or replace function public.bump_document_version()
returns trigger language plpgsql as $$
begin
  update public.documents
     set current_version_id = new.id,
         version_count      = greatest(version_count, new.version),
         updated_at         = now()
   where id = new.document_id;
  return new;
end;
$$;

create trigger document_versions_bump
  after insert on public.document_versions
  for each row execute function public.bump_document_version();

-- Número de versión automático si no se indica
create or replace function public.assign_document_version_number()
returns trigger language plpgsql as $$
begin
  if new.version is null or new.version = 0 then
    select coalesce(max(version), 0) + 1 into new.version
      from public.document_versions where document_id = new.document_id;
  end if;
  return new;
end;
$$;

create trigger document_versions_assign_number
  before insert on public.document_versions
  for each row execute function public.assign_document_version_number();

alter table public.document_versions alter column version drop not null;

-- ── Contadores de Q&A ──────────────────────────────────────────────────────
create or replace function public.touch_qa_thread()
returns trigger language plpgsql as $$
begin
  update public.qa_threads
     set last_message_at = new.created_at,
         message_count   = message_count + 1
   where id = new.thread_id;
  return new;
end;
$$;

create trigger qa_messages_touch_thread
  after insert on public.qa_messages
  for each row execute function public.touch_qa_thread();

-- ── Referencias legibles ───────────────────────────────────────────────────
create sequence if not exists public.asset_reference_seq;
create sequence if not exists public.deal_reference_seq;

create or replace function public.assign_asset_reference()
returns trigger language plpgsql as $$
declare prefix text;
begin
  if new.reference_code is null or new.reference_code = '' then
    prefix := case new.category
      when 'real-estate' then 'RE'
      when 'companies'   then 'CO'
      when 'vehicles'    then 'VH'
      when 'yachts'      then 'YT'
      when 'aircraft'    then 'AC'
    end;
    new.reference_code := 'LX-' || prefix || '-' ||
      lpad(nextval('public.asset_reference_seq')::text, 4, '0');
  end if;
  return new;
end;
$$;

create trigger assets_assign_reference
  before insert on public.assets
  for each row execute function public.assign_asset_reference();

alter table public.assets alter column reference_code drop not null;

create or replace function public.assign_deal_reference()
returns trigger language plpgsql as $$
begin
  if new.reference_code is null or new.reference_code = '' then
    new.reference_code := 'DR-' || to_char(now(), 'YYYY') || '-' ||
      lpad(nextval('public.deal_reference_seq')::text, 4, '0');
  end if;
  return new;
end;
$$;

create trigger deals_assign_reference
  before insert on public.deals
  for each row execute function public.assign_deal_reference();

alter table public.deals alter column reference_code drop not null;

-- ============================================================================
-- Jobs
-- ============================================================================

-- Expiración automática de accesos. La API la invoca desde /v1/jobs/expire-access
-- (o pg_cron si está disponible en el proyecto).
create or replace function public.expire_document_permissions()
returns table (expired_permissions integer, expired_deals integer)
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_perms integer := 0;
  v_deals integer := 0;
begin
  with revoked as (
    update public.document_permissions
       set revoked_at    = now(),
           revoke_reason = 'auto:expired'
     where revoked_at is null
       and expires_at is not null
       and expires_at <= now()
    returning id
  )
  select count(*) into v_perms from revoked;

  with closed as (
    update public.deals
       set stage = 'expired'
     where stage in ('nda_signed','qa','offer','loi','due_diligence')
       and expires_at is not null
       and expires_at <= now()
    returning id
  )
  select count(*) into v_deals from closed;

  return query select v_perms, v_deals;
end;
$$;

comment on function public.expire_document_permissions is
  'Barrido de expiraciones. Idempotente. Invocado por la API con el secreto interno.';

-- Checklist de verificación por categoría (requisitos peruanos).
create or replace function public.seed_verification_checklist(p_asset_id uuid)
returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_category public.asset_category;
  item record;
begin
  select category into v_category from public.assets where id = p_asset_id;

  for item in
    select * from (values
      -- Comunes
      ('identity_owner',   'Identidad del titular (DNI/CE/Pasaporte)', 'RENIEC/MIGRACIONES', true, array['real-estate','companies','vehicles','yachts','aircraft']),
      ('ownership_proof',  'Acreditación de titularidad',              null,                 true, array['real-estate','companies','vehicles','yachts','aircraft']),
      ('valuation',        'Tasación o valorización',                  null,                 false, array['real-estate','companies','vehicles','yachts','aircraft']),
      -- Inmuebles
      ('sunarp_literal',   'Copia literal de partida registral',       'SUNARP',             true, array['real-estate']),
      ('cri',              'Certificado Registral Inmobiliario (CRI)', 'SUNARP',             true, array['real-estate']),
      ('hr_pu',            'HR y PU del ejercicio vigente',            'Municipalidad/SAT',  true, array['real-estate']),
      ('predial_paz',      'No adeudo de Impuesto Predial y arbitrios','SAT/Municipalidad',  true, array['real-estate']),
      ('cargas_gravamenes','Certificado de cargas y gravámenes',       'SUNARP',             true, array['real-estate']),
      ('licencia_edif',    'Licencia de edificación / conformidad de obra','Municipalidad',  false, array['real-estate']),
      -- Empresas
      ('partida_electronica','Partida electrónica de la sociedad',     'SUNARP',             true, array['companies']),
      ('eeff_auditados',   'EEFF auditados (últimos 3 ejercicios)',    null,                 true, array['companies']),
      ('ficha_ruc',        'Ficha RUC y situación tributaria',         'SUNAT',              true, array['companies']),
      ('vigencia_poder',   'Vigencia de poder del representante',      'SUNARP',             true, array['companies']),
      ('cap_table',        'Estructura accionaria / cap table',        null,                 true, array['companies']),
      ('contingencias',    'Declaración de contingencias legales y laborales', null,         false, array['companies']),
      -- Vehículos
      ('tiv',              'Tarjeta de Identificación Vehicular (TIV)','SUNARP/MTC',         true, array['vehicles']),
      ('gravamenes_veh',   'Certificado de gravámenes vehicular',      'SUNARP',             true, array['vehicles']),
      ('soat_revision',    'SOAT y revisión técnica vigentes',         'MTC',                false, array['vehicles']),
      ('dua_importacion',  'DUA de importación / póliza',              'SUNAT-Aduanas',      false, array['vehicles']),
      ('historial_proc',   'Historial de procedencia y mantenimiento', null,                 false, array['vehicles']),
      -- Yates
      ('matricula_dicapi', 'Certificado de matrícula de nave',         'DICAPI',             true, array['yachts']),
      ('certificado_nav',  'Certificado de navegabilidad',             'DICAPI',             true, array['yachts']),
      ('gravamenes_nave',  'Certificado de gravámenes de nave',        'DICAPI/SUNARP',      true, array['yachts']),
      ('survey_report',    'Survey técnico / informe de condición',    null,                 false, array['yachts']),
      -- Aeronaves
      ('matricula_dgac',   'Certificado de matrícula de aeronave',     'DGAC',               true, array['aircraft']),
      ('aeronavegabilidad','Certificado de aeronavegabilidad',         'DGAC',               true, array['aircraft']),
      ('logbooks',         'Logbooks de célula, motores y hélices',    null,                 true, array['aircraft']),
      ('ad_sb_status',     'Estado de AD/SB y programa de mantenimiento', null,              true, array['aircraft']),
      ('gravamenes_aero',  'Registro de gravámenes aeronáuticos',      'DGAC',               true, array['aircraft'])
    ) as t(item_key, label, authority, required, categories)
  loop
    if v_category::text = any (item.categories) then
      insert into public.asset_verification_items (asset_id, item_key, label, authority, required)
      values (p_asset_id, item.item_key, item.label, item.authority, item.required)
      on conflict (asset_id, item_key) do nothing;
    end if;
  end loop;
end;
$$;

create or replace function public.on_asset_created()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  insert into public.asset_private_details (asset_id) values (new.id)
  on conflict (asset_id) do nothing;
  perform public.seed_verification_checklist(new.id);
  return new;
end;
$$;

create trigger assets_after_insert
  after insert on public.assets
  for each row execute function public.on_asset_created();

-- Contadores de actividad del activo. Se exponen como RPC porque el vendedor
-- no puede actualizar estas columnas directamente (política de RLS) y el
-- incremento debe ser atómico.
create or replace function public.increment_asset_views(p_asset_id uuid)
returns void
language sql security definer set search_path = public, pg_temp as $$
  update public.assets set view_count = view_count + 1 where id = p_asset_id;
$$;

create or replace function public.increment_asset_enquiries(p_asset_id uuid)
returns void
language sql security definer set search_path = public, pg_temp as $$
  update public.assets set enquiry_count = enquiry_count + 1 where id = p_asset_id;
$$;

revoke all on function public.increment_asset_views(uuid) from public;
revoke all on function public.increment_asset_enquiries(uuid) from public;
grant execute on function public.increment_asset_views(uuid) to anon, authenticated, service_role;
grant execute on function public.increment_asset_enquiries(uuid) to service_role;
