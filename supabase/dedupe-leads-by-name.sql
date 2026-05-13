-- ============================================================================
-- Dedupe `public.profiles` op voornaam
-- ----------------------------------------------------------------------------
-- Bij dubbele `first_name` blijft per groep de OUDSTE profiel staan
-- (laagste `created_at`, tie-breaker op `id`). Alle latere duplicaten worden
-- gewist. Matching is case-insensitive en trimt witruimte
-- (`lower(trim(first_name))`).
--
-- Cascade-effect:
--   - profile_media.profile_id -> ON DELETE CASCADE → foto's gaan automatisch
--     mee weg.
--   - conversations.profile_id is een tekstkolom (geen FK). Bestaande chats
--     blijven dus staan, maar verwijzen naar een verdwenen profiel-id.
--
-- TIP: draai eerst blok 1 (preview, alleen SELECT). Doe de DELETE in blok 2
-- pas als de preview klopt.
-- ============================================================================

-- ─── 1. PREVIEW — welke profielen zouden verwijderd worden? ─────────────────
with ranked as (
  select
    id,
    first_name,
    slug,
    city,
    age,
    created_at,
    row_number() over (
      partition by lower(trim(first_name))
      order by created_at asc, id asc
    ) as rn
  from public.profiles
)
select
  id,
  first_name,
  slug,
  city,
  age,
  created_at,
  rn,
  case when rn = 1 then 'KEEP' else 'DELETE' end as action
from ranked
where lower(trim(first_name)) in (
  select lower(trim(first_name))
  from public.profiles
  group by lower(trim(first_name))
  having count(*) > 1
)
order by lower(trim(first_name)), created_at;


-- ─── 2. DELETE — voer dit blok uit als de preview hierboven klopt ───────────
begin;

with ranked as (
  select
    id,
    row_number() over (
      partition by lower(trim(first_name))
      order by created_at asc, id asc
    ) as rn
  from public.profiles
)
delete from public.profiles p
using ranked r
where p.id = r.id
  and r.rn > 1;

commit;


-- ─── 3. VERIFICATIE — moet 0 zijn ───────────────────────────────────────────
select count(*) as remaining_dupes
from (
  select 1
  from public.profiles
  group by lower(trim(first_name))
  having count(*) > 1
) x;
