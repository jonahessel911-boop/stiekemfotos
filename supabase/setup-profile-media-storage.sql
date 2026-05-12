-- ============================================================================
-- Supabase Storage setup voor `profile-media` bucket.
--
-- Run dit script éénmalig in de Supabase SQL Editor (of via `psql` / Supabase
-- CLI). Idempotent: alle CREATE / INSERT operations zijn safe om opnieuw te
-- draaien.
--
-- Wat dit script doet:
--   1) Maakt een publieke bucket `profile-media` aan (als die nog niet bestaat).
--   2) Zet RLS aan op `storage.objects` (default in Supabase, expliciet hier
--      voor zekerheid) en maakt veilige policies:
--        - anon + authenticated mogen ALLEEN lezen uit `profile-media`.
--        - INSERT/UPDATE/DELETE blijven beperkt tot service-role calls
--          (RLS bypass via SUPABASE_SERVICE_ROLE_KEY). Geen anon/auth writes.
--   3) Sanity check op `public.profile_media`: zorg dat anon + authenticated
--      kunnen selecten (idem aan grant-profiles-read-to-anon.sql; gerepliceerd
--      hier zodat dit script standalone draaibaar is).
--
-- Belangrijk: dit script kan GEEN bestaande lokale image-bestanden uploaden naar
-- Supabase Storage — daarvoor draai je het Node/TS backfill-script
-- `scripts/migrate-local-profile-media-to-supabase.mjs` (zie REPO).
-- ============================================================================

-- ──────────────────────────────────────────────────────────────────────────
-- 1) BUCKET
-- ──────────────────────────────────────────────────────────────────────────

insert into storage.buckets
  (id, name, public, file_size_limit, allowed_mime_types)
values
  ('profile-media',
   'profile-media',
   true,
   12 * 1024 * 1024,          -- 12 MB
   array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update
  set public            = excluded.public,
      file_size_limit   = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- ──────────────────────────────────────────────────────────────────────────
-- 2) RLS op storage.objects + policies (alleen voor deze bucket).
--    De service-role key omzeilt RLS automatisch, dus uploads vanaf de server
--    blijven werken zonder INSERT/UPDATE-policy voor anon/authenticated.
-- ──────────────────────────────────────────────────────────────────────────

alter table storage.objects enable row level security;

-- 2a) PUBLIC READ (anon + authenticated) — alleen voor onze bucket.
drop policy if exists "profile-media public read" on storage.objects;
create policy "profile-media public read"
on storage.objects
for select
to anon, authenticated
using (bucket_id = 'profile-media');

-- 2b) Veiligheid: expliciet geen INSERT/UPDATE/DELETE voor anon/authenticated.
--     We droppen mogelijke "open" policies die per ongeluk eerder werden gemaakt
--     met dezelfde naam, en maken ze NIET opnieuw aan. Service-role bypasst RLS.
drop policy if exists "profile-media authenticated insert" on storage.objects;
drop policy if exists "profile-media authenticated update" on storage.objects;
drop policy if exists "profile-media authenticated delete" on storage.objects;
drop policy if exists "profile-media anon insert" on storage.objects;

-- ──────────────────────────────────────────────────────────────────────────
-- 3) public.profile_media — sanity (idempotent t.o.v. grant-profiles-read-to-anon.sql)
--    Zorg dat readers (browser) deze tabel kunnen selecten zodat profiel-feeds
--    blijven werken. Schrijven gebeurt via service-role calls.
-- ──────────────────────────────────────────────────────────────────────────

grant usage on schema public to anon, authenticated;
grant select on table public.profile_media to anon, authenticated;

alter table public.profile_media enable row level security;

drop policy if exists "public can read profile media" on public.profile_media;
create policy "public can read profile media"
on public.profile_media
for select
to anon, authenticated
using (true);

-- ──────────────────────────────────────────────────────────────────────────
-- 4) Optioneel: index op `profile_media.url` om legacy-lookups in de
--    /api/conversations/.../image/... fallback-route te versnellen.
-- ──────────────────────────────────────────────────────────────────────────

create index if not exists idx_profile_media_url_trgm
  on public.profile_media using gin (url gin_trgm_ops);
-- Vereist de extensie `pg_trgm`. Op een nieuwe Supabase project enablen via:
--   create extension if not exists pg_trgm;
-- Mocht de extensie niet beschikbaar zijn, comment de bovenstaande index-statement.

-- ──────────────────────────────────────────────────────────────────────────
-- Verificatie (gewoon SELECTs, no-op):
-- ──────────────────────────────────────────────────────────────────────────
-- select id, name, public, file_size_limit, allowed_mime_types
--   from storage.buckets where id = 'profile-media';
--
-- select policyname, cmd, roles, qual::text
--   from pg_policies
--  where schemaname = 'storage' and tablename = 'objects'
--    and policyname like 'profile-media%';
