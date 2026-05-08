-- Allow profile reads with SUPABASE_ANON_KEY.
-- Run this in Supabase SQL editor on the same project as SUPABASE_URL.

grant usage on schema public to anon, authenticated;
grant select on table public.profiles to anon, authenticated;
grant select on table public.profile_media to anon, authenticated;

-- Optional if you use RLS now or later:
alter table public.profiles enable row level security;
alter table public.profile_media enable row level security;

drop policy if exists "public can read active profiles" on public.profiles;
create policy "public can read active profiles"
on public.profiles
for select
to anon, authenticated
using (is_active = true);

drop policy if exists "public can read profile media" on public.profile_media;
create policy "public can read profile media"
on public.profile_media
for select
to anon, authenticated
using (true);
