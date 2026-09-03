-- ============================================================================
-- LUXUS PERÚ · 0700 — Row Level Security
--
-- Regla de la casa: RLS activo en TODAS las tablas de `public`.
-- Sin política = sin acceso. `service_role` (solo la API Fastify) la elude.
-- ============================================================================

do $$
declare t text;
begin
  for t in
    select tablename from pg_tables where schemaname = 'public'
  loop
    execute format('alter table public.%I enable row level security', t);
  end loop;
end $$;

-- ────────────────────────────────────────────────────────────────────────────
-- profiles
-- ────────────────────────────────────────────────────────────────────────────
create policy "profiles: read own"
  on public.profiles for select to authenticated
  using (id = auth.uid());

create policy "profiles: read counterpart in a deal"
  on public.profiles for select to authenticated
  using (
    exists (
      select 1 from public.deals d
      where (d.buyer_id = auth.uid() and d.seller_id = profiles.id)
         or (d.seller_id = auth.uid() and d.buyer_id = profiles.id)
    )
  );

create policy "profiles: admin reads all"
  on public.profiles for select to authenticated
  using (luxus.is_admin());

-- El usuario edita su perfil, pero NO su rol, nivel ni estado de compliance.
create policy "profiles: update own"
  on public.profiles for update to authenticated
  using (id = auth.uid() and not is_suspended)
  with check (
    id = auth.uid()
    and role = (select p.role from public.profiles p where p.id = auth.uid())
    and kyc_status = (select p.kyc_status from public.profiles p where p.id = auth.uid())
    and screening_status = (select p.screening_status from public.profiles p where p.id = auth.uid())
    and membership_tier = (select p.membership_tier from public.profiles p where p.id = auth.uid())
    and is_suspended = false
  );

create policy "profiles: admin writes"
  on public.profiles for all to authenticated
  using (luxus.is_admin()) with check (luxus.is_admin());

-- ────────────────────────────────────────────────────────────────────────────
-- notification_preferences · user_sessions
-- ────────────────────────────────────────────────────────────────────────────
create policy "notif prefs: own"
  on public.notification_preferences for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

create policy "sessions: own read"
  on public.user_sessions for select to authenticated
  using (user_id = auth.uid() or luxus.is_admin());

create policy "sessions: own revoke"
  on public.user_sessions for update to authenticated
  using (user_id = auth.uid() or luxus.is_admin())
  with check (user_id = auth.uid() or luxus.is_admin());

-- ────────────────────────────────────────────────────────────────────────────
-- brokers — la ficha pública del bróker verificado es Nivel I
-- ────────────────────────────────────────────────────────────────────────────
create policy "brokers: public read verified"
  on public.brokers for select to anon, authenticated
  using (is_verified);

create policy "brokers: read own"
  on public.brokers for select to authenticated
  using (user_id = auth.uid() or luxus.is_admin());

create policy "brokers: manage own"
  on public.brokers for update to authenticated
  using (user_id = auth.uid())
  with check (
    user_id = auth.uid()
    and is_verified = (select b.is_verified from public.brokers b where b.user_id = auth.uid())
  );

create policy "brokers: admin all"
  on public.brokers for all to authenticated
  using (luxus.is_admin()) with check (luxus.is_admin());

-- ────────────────────────────────────────────────────────────────────────────
-- private_access_requests — se escriben SOLO desde la API (rate limit + captcha)
-- ────────────────────────────────────────────────────────────────────────────
create policy "access requests: admin"
  on public.private_access_requests for all to authenticated
  using (luxus.is_admin()) with check (luxus.is_admin());

-- ────────────────────────────────────────────────────────────────────────────
-- assets — Nivel I
-- ────────────────────────────────────────────────────────────────────────────
create policy "assets: public catalogue"
  on public.assets for select to anon, authenticated
  using (
    status = 'published'
    and visibility in ('verified', 'private')
    and published_at is not null
  );

-- Off-market: solo miembros verificados (Nivel II).
create policy "assets: off-market for verified members"
  on public.assets for select to authenticated
  using (
    status = 'published'
    and visibility = 'off_market'
    and luxus.is_verified_member()
  );

create policy "assets: owner reads own"
  on public.assets for select to authenticated
  using (luxus.owns_asset(id) or luxus.is_admin());

create policy "assets: seller creates"
  on public.assets for insert to authenticated
  with check (
    owner_id = auth.uid()
    and luxus.actor_role() in ('seller', 'broker', 'admin')
    and luxus.is_active()
    and status in ('draft', 'pending_review')
  );

-- El vendedor edita mientras el activo no esté aprobado; una vez publicado
-- solo puede tocar campos no críticos (lo controla la API), nunca el estado.
create policy "assets: owner updates"
  on public.assets for update to authenticated
  using (luxus.owns_asset(id) and luxus.is_active())
  with check (
    luxus.owns_asset(id)
    and status in ('draft', 'pending_review', 'changes_requested', 'published', 'sold')
    and ownership_verified = (select a.ownership_verified from public.assets a where a.id = assets.id)
    and registry_reviewed  = (select a.registry_reviewed  from public.assets a where a.id = assets.id)
    and documentation_reviewed = (select a.documentation_reviewed from public.assets a where a.id = assets.id)
  );

create policy "assets: admin all"
  on public.assets for all to authenticated
  using (luxus.is_admin()) with check (luxus.is_admin());

-- ────────────────────────────────────────────────────────────────────────────
-- asset_private_details — Nivel II/III. Precio exacto y dirección exacta.
-- Sin política para `anon`: un visitante público NUNCA puede leer esta tabla.
-- ────────────────────────────────────────────────────────────────────────────
create policy "asset private: level II+"
  on public.asset_private_details for select to authenticated
  using (luxus.can_view_asset_private(asset_id));

create policy "asset private: owner writes"
  on public.asset_private_details for all to authenticated
  using (luxus.owns_asset(asset_id) or luxus.is_admin())
  with check (luxus.owns_asset(asset_id) or luxus.is_admin());

-- ────────────────────────────────────────────────────────────────────────────
-- asset_media
-- ────────────────────────────────────────────────────────────────────────────
create policy "media: public images of published assets"
  on public.asset_media for select to anon, authenticated
  using (
    is_public
    and exists (
      select 1 from public.assets a
      where a.id = asset_media.asset_id
        and a.status = 'published'
        and a.visibility in ('verified','private')
    )
  );

create policy "media: private media level II+"
  on public.asset_media for select to authenticated
  using (luxus.can_view_asset_private(asset_id));

create policy "media: owner manages"
  on public.asset_media for all to authenticated
  using (luxus.owns_asset(asset_id) or luxus.is_admin())
  with check (luxus.owns_asset(asset_id) or luxus.is_admin());

-- ────────────────────────────────────────────────────────────────────────────
-- asset_verification_items · watchlist · asset_views
-- ────────────────────────────────────────────────────────────────────────────
create policy "verification items: owner and admin"
  on public.asset_verification_items for select to authenticated
  using (luxus.owns_asset(asset_id) or luxus.is_admin());

create policy "verification items: admin writes"
  on public.asset_verification_items for all to authenticated
  using (luxus.is_admin()) with check (luxus.is_admin());

create policy "watchlist: own"
  on public.watchlist for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid() and luxus.is_active());

create policy "asset views: owner stats"
  on public.asset_views for select to authenticated
  using (luxus.owns_asset(asset_id) or luxus.is_admin());

-- ────────────────────────────────────────────────────────────────────────────
-- KYC y screening
-- ────────────────────────────────────────────────────────────────────────────
create policy "kyc: read own"
  on public.kyc_cases for select to authenticated
  using (user_id = auth.uid() or luxus.is_admin());

create policy "kyc: create own"
  on public.kyc_cases for insert to authenticated
  with check (user_id = auth.uid() and luxus.is_active());

create policy "kyc: edit own while open"
  on public.kyc_cases for update to authenticated
  using (user_id = auth.uid() and status in ('in_progress', 'submitted'))
  with check (user_id = auth.uid() and status in ('in_progress', 'submitted'));

create policy "kyc: admin all"
  on public.kyc_cases for all to authenticated
  using (luxus.is_admin()) with check (luxus.is_admin());

create policy "kyc docs: own"
  on public.kyc_documents for select to authenticated
  using (user_id = auth.uid() or luxus.is_admin());

create policy "kyc docs: upload own"
  on public.kyc_documents for insert to authenticated
  with check (user_id = auth.uid() and luxus.is_active());

create policy "kyc docs: admin all"
  on public.kyc_documents for all to authenticated
  using (luxus.is_admin()) with check (luxus.is_admin());

-- El resultado del screening se lee, nunca se escribe desde el cliente.
create policy "screening: read own"
  on public.screening_checks for select to authenticated
  using (user_id = auth.uid() or luxus.is_admin());

create policy "screening: admin writes"
  on public.screening_checks for all to authenticated
  using (luxus.is_admin()) with check (luxus.is_admin());

-- ────────────────────────────────────────────────────────────────────────────
-- Deals
-- ────────────────────────────────────────────────────────────────────────────
create policy "deals: parties read"
  on public.deals for select to authenticated
  using (luxus.is_deal_party(id) or luxus.is_admin());

create policy "deals: buyer requests access"
  on public.deals for insert to authenticated
  with check (
    buyer_id = auth.uid()
    and stage = 'requested'
    and luxus.is_active()
    -- el vendedor no lo elige el comprador: sale del activo
    and seller_id = (select a.owner_id from public.assets a where a.id = asset_id)
  );

-- Transiciones de etapa se hacen SIEMPRE por la API (valida KYC, NDA, permisos).
create policy "deals: parties limited update"
  on public.deals for update to authenticated
  using (luxus.is_deal_party(id))
  with check (luxus.is_deal_party(id));

create policy "deals: admin all"
  on public.deals for all to authenticated
  using (luxus.is_admin()) with check (luxus.is_admin());

create policy "deal history: parties read"
  on public.deal_stage_history for select to authenticated
  using (luxus.is_deal_party(deal_id) or luxus.is_admin());

create policy "nda: parties read"
  on public.ndas for select to authenticated
  using (luxus.is_deal_party(deal_id) or luxus.is_admin());

create policy "nda: admin all"
  on public.ndas for all to authenticated
  using (luxus.is_admin()) with check (luxus.is_admin());

-- ────────────────────────────────────────────────────────────────────────────
-- Documentos del Deal Room
--   El comprador solo ve documentos con permiso vigente. La *existencia* de un
--   documento sin permiso tampoco se revela.
-- ────────────────────────────────────────────────────────────────────────────
create policy "documents: readable with permission"
  on public.documents for select to authenticated
  using (deleted_at is null and luxus.can_read_document(id));

create policy "documents: owner manages"
  on public.documents for all to authenticated
  using (luxus.owns_asset(asset_id) or luxus.is_admin())
  with check (luxus.owns_asset(asset_id) or luxus.is_admin());

create policy "doc versions: readable with permission"
  on public.document_versions for select to authenticated
  using (luxus.can_read_document(document_id));

create policy "doc versions: owner manages"
  on public.document_versions for all to authenticated
  using (
    exists (select 1 from public.documents d
            where d.id = document_versions.document_id and luxus.owns_asset(d.asset_id))
    or luxus.is_admin()
  )
  with check (
    exists (select 1 from public.documents d
            where d.id = document_versions.document_id and luxus.owns_asset(d.asset_id))
    or luxus.is_admin()
  );

create policy "doc permissions: subject reads own"
  on public.document_permissions for select to authenticated
  using (user_id = auth.uid());

create policy "doc permissions: seller manages"
  on public.document_permissions for all to authenticated
  using (
    exists (select 1 from public.documents d
            where d.id = document_permissions.document_id and luxus.owns_asset(d.asset_id))
    or luxus.is_admin()
  )
  with check (
    exists (select 1 from public.documents d
            where d.id = document_permissions.document_id and luxus.owns_asset(d.asset_id))
    or luxus.is_admin()
  );

-- ────────────────────────────────────────────────────────────────────────────
-- Q&A · ofertas · LOI  (requieren Deal Room abierto)
-- ────────────────────────────────────────────────────────────────────────────
create policy "qa threads: parties"
  on public.qa_threads for select to authenticated
  using (luxus.is_deal_party(deal_id) or luxus.is_admin());

create policy "qa threads: parties create"
  on public.qa_threads for insert to authenticated
  with check (
    created_by = auth.uid()
    and luxus.is_deal_party(deal_id)
    and luxus.deal_room_open(deal_id)
  );

create policy "qa threads: parties update"
  on public.qa_threads for update to authenticated
  using (luxus.is_deal_party(deal_id))
  with check (luxus.is_deal_party(deal_id));

create policy "qa messages: parties"
  on public.qa_messages for select to authenticated
  using (luxus.is_deal_party(deal_id) or luxus.is_admin());

create policy "qa messages: parties post"
  on public.qa_messages for insert to authenticated
  with check (
    author_id = auth.uid()
    and luxus.is_deal_party(deal_id)
    and luxus.deal_room_open(deal_id)
  );

create policy "offers: parties read"
  on public.offers for select to authenticated
  using (luxus.is_deal_party(deal_id) or luxus.is_admin());

create policy "offers: parties create"
  on public.offers for insert to authenticated
  with check (
    author_id = auth.uid()
    and luxus.is_deal_party(deal_id)
    and luxus.deal_room_open(deal_id)
  );

create policy "offers: parties respond"
  on public.offers for update to authenticated
  using (luxus.is_deal_party(deal_id))
  with check (luxus.is_deal_party(deal_id));

create policy "loi: parties read"
  on public.lois for select to authenticated
  using (luxus.is_deal_party(deal_id) or luxus.is_admin());

create policy "loi: admin all"
  on public.lois for all to authenticated
  using (luxus.is_admin()) with check (luxus.is_admin());

-- ────────────────────────────────────────────────────────────────────────────
-- Auditoría — append-only. El cliente NUNCA escribe.
-- ────────────────────────────────────────────────────────────────────────────
create policy "audit: seller of the deal reads"
  on public.audit_logs for select to authenticated
  using (
    luxus.is_admin()
    or (deal_id is not null and exists (
          select 1 from public.deals d
          where d.id = audit_logs.deal_id and d.seller_id = auth.uid()))
    or (asset_id is not null and luxus.owns_asset(asset_id))
  );

-- ────────────────────────────────────────────────────────────────────────────
-- Monetización
-- ────────────────────────────────────────────────────────────────────────────
create policy "plans: public catalogue"
  on public.plans for select to anon, authenticated
  using (is_active);

create policy "plans: admin"
  on public.plans for all to authenticated
  using (luxus.is_admin()) with check (luxus.is_admin());

create policy "subscriptions: own"
  on public.subscriptions for select to authenticated
  using (user_id = auth.uid() or luxus.is_admin());

create policy "payments: own"
  on public.payments for select to authenticated
  using (user_id = auth.uid() or luxus.is_admin());

create policy "listing fees: owner and admin"
  on public.listing_fees for select to authenticated
  using (luxus.owns_asset(asset_id) or luxus.is_admin());

-- ────────────────────────────────────────────────────────────────────────────
-- Intelligence
-- ────────────────────────────────────────────────────────────────────────────
create policy "articles: published are public"
  on public.articles for select to anon, authenticated
  using (status = 'published' and not is_members_only and published_at <= now());

create policy "articles: members-only for verified"
  on public.articles for select to authenticated
  using (status = 'published' and is_members_only and luxus.is_verified_member());

create policy "articles: admin all"
  on public.articles for all to authenticated
  using (luxus.is_admin()) with check (luxus.is_admin());

-- ────────────────────────────────────────────────────────────────────────────
-- CRM — interno
-- ────────────────────────────────────────────────────────────────────────────
create policy "leads: staff"
  on public.leads for all to authenticated
  using (luxus.is_admin() or assigned_to = auth.uid())
  with check (luxus.is_admin() or assigned_to = auth.uid());

create policy "lead notes: staff"
  on public.lead_notes for all to authenticated
  using (
    luxus.is_admin()
    or exists (select 1 from public.leads l
               where l.id = lead_notes.lead_id and l.assigned_to = auth.uid())
  )
  with check (author_id = auth.uid());

-- ────────────────────────────────────────────────────────────────────────────
-- Notificaciones
-- ────────────────────────────────────────────────────────────────────────────
create policy "notifications: own read"
  on public.notifications for select to authenticated
  using (user_id = auth.uid());

create policy "notifications: mark as read"
  on public.notifications for update to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

-- email_log y webhook_events: sin políticas → solo service_role.

-- ────────────────────────────────────────────────────────────────────────────
-- Realtime para el centro de notificaciones y el Q&A
-- ────────────────────────────────────────────────────────────────────────────
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    alter publication supabase_realtime add table public.notifications;
    alter publication supabase_realtime add table public.qa_messages;
    alter publication supabase_realtime add table public.deals;
  end if;
end $$;
