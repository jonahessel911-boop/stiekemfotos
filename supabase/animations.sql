-- Animations metadata (e.g. gift animation video)
-- Run this in Supabase SQL editor.

create table if not exists public.app_animations (
  key text primary key,
  url text not null,
  mime text,
  size_bytes bigint,
  updated_at timestamptz not null default now()
);

-- Expected keys (examples):
-- - gift_closed  (looping closed box video shown instantly)
-- - gift_open    (opening animation played on click)

-- Keep updated_at fresh on updates
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists trg_app_animations_updated_at on public.app_animations;
create trigger trg_app_animations_updated_at
before update on public.app_animations
for each row execute function public.set_updated_at();

alter table public.app_animations enable row level security;

-- Public read (so the site can fetch animation URLs without auth)
drop policy if exists "public read animations" on public.app_animations;
create policy "public read animations"
on public.app_animations
for select
using (true);

