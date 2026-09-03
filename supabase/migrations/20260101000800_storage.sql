-- ============================================================================
-- LUXUS PERÚ · 0800 — Storage
--
-- Solo dos buckets son públicos (fotografía de catálogo y portadas editoriales).
-- Todo lo demás es privado y se sirve exclusivamente por la API Fastify con
-- URL firmada de 5 minutos, previa verificación de KYC + NDA + permiso vigente.
-- ============================================================================

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values
  ('public-media',        'public-media',        true,  26214400,
     array['image/jpeg','image/png','image/webp','image/avif','video/mp4']),
  ('intelligence',        'intelligence',        true,  10485760,
     array['image/jpeg','image/png','image/webp','image/avif']),
  ('broker-logos',        'broker-logos',        true,   2097152,
     array['image/jpeg','image/png','image/webp','image/svg+xml']),
  ('asset-private-media', 'asset-private-media', false, 52428800,
     array['image/jpeg','image/png','image/webp','image/avif','video/mp4','application/pdf']),
  ('kyc-documents',       'kyc-documents',       false, 15728640,
     array['image/jpeg','image/png','image/webp','application/pdf']),
  ('deal-documents',      'deal-documents',      false, 104857600,
     array['application/pdf','image/jpeg','image/png',
           'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
           'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
           'application/vnd.ms-excel','text/csv']),
  ('signed-documents',    'signed-documents',    false, 26214400,
     array['application/pdf'])
on conflict (id) do nothing;

-- ── public-media ───────────────────────────────────────────────────────────
-- Lectura pública (bucket público). Escritura: dueño del activo o admin.
-- Convención de ruta: {asset_id}/{uuid}.{ext}
create policy "public-media: owner uploads"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'public-media'
    and luxus.owns_asset(((storage.foldername(name))[1])::uuid)
  );

create policy "public-media: owner manages"
  on storage.objects for update to authenticated
  using (bucket_id = 'public-media' and luxus.owns_asset(((storage.foldername(name))[1])::uuid));

create policy "public-media: owner deletes"
  on storage.objects for delete to authenticated
  using (bucket_id = 'public-media' and luxus.owns_asset(((storage.foldername(name))[1])::uuid));

-- ── asset-private-media (Nivel II) ─────────────────────────────────────────
create policy "private-media: owner writes"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'asset-private-media'
    and luxus.owns_asset(((storage.foldername(name))[1])::uuid)
  );

create policy "private-media: level II reads"
  on storage.objects for select to authenticated
  using (
    bucket_id = 'asset-private-media'
    and luxus.can_view_asset_private(((storage.foldername(name))[1])::uuid)
  );

create policy "private-media: owner deletes"
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'asset-private-media'
    and luxus.owns_asset(((storage.foldername(name))[1])::uuid)
  );

-- ── kyc-documents ──────────────────────────────────────────────────────────
-- El usuario sube a su propia carpeta {user_id}/… y NO puede releer.
-- La revisión ocurre en el Admin, siempre a través de la API.
create policy "kyc: user uploads to own folder"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'kyc-documents'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

-- ── deal-documents y signed-documents ──────────────────────────────────────
-- Sin políticas para anon/authenticated: TODA lectura pasa por la API, que
-- comprueba KYC + NDA + permiso vigente, aplica marca de agua y firma la URL.
-- El vendedor sube versiones también vía API (para calcular hash y auditar).

-- ── intelligence y broker-logos ────────────────────────────────────────────
create policy "intelligence: admin writes"
  on storage.objects for insert to authenticated
  with check (bucket_id = 'intelligence' and luxus.is_admin());

create policy "intelligence: admin manages"
  on storage.objects for update to authenticated
  using (bucket_id = 'intelligence' and luxus.is_admin());

create policy "broker-logos: own"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'broker-logos'
    and (storage.foldername(name))[1] = auth.uid()::text
  );
