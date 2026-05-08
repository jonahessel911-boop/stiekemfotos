-- Seed 50 test profiles with images for local/staging testing.
-- Safe to run multiple times (upsert on slug).

begin;

do $$
begin
  if to_regclass('public.profiles') is null then
    raise exception 'Table public.profiles does not exist. Run supabase/schema.sql first.';
  end if;
  if to_regclass('public.profile_media') is null then
    raise exception 'Table public.profile_media does not exist. Run supabase/schema.sql first.';
  end if;
end
$$;

with
name_pool as (
  select array[
    'Sophie','Emma','Julia','Mila','Noor','Lotte','Sara','Zoey','Lisa','Fleur',
    'Anna','Eva','Nina','Iris','Luna','Roos','Amber','Vera','Yara','Mara'
  ]::text[] as names
),
city_pool as (
  select array[
    'Amsterdam','Rotterdam','Utrecht','Eindhoven','Groningen','Tilburg','Nijmegen','Breda','Haarlem','Leiden',
    'Delft','Arnhem','Zwolle','Maastricht','Den Bosch'
  ]::text[] as cities
),
interest_pool as (
  select array[
    'Reizen','Fitness','Koken','Netflix','Fotografie','Dansen','Wandelen','Muziek','Mode','Koffie'
  ]::text[] as interests
),
rows as (
  select
    gs as n,
    lpad(gs::text, 3, '0') as n3,
    (select names[((gs - 1) % array_length(names, 1)) + 1] from name_pool) as first_name,
    (select cities[((gs - 1) % array_length(cities, 1)) + 1] from city_pool) as city,
    (select interests[((gs - 1) % array_length(interests, 1)) + 1] from interest_pool) as interest_a,
    (select interests[((gs + 2) % array_length(interests, 1)) + 1] from interest_pool) as interest_b,
    (21 + ((gs * 3) % 12))::int as age
  from generate_series(1, 50) gs
),
upserted as (
  insert into public.profiles (
    slug,
    first_name,
    age,
    city,
    lengte_cm,
    gewicht_kg,
    cup_maat,
    country,
    bio,
    interests,
    personality,
    system_prompt,
    avatar_url,
    photo_urls,
    voice_language,
    heritage,
    is_active
  )
  select
    format('test-profiel-%s', r.n3) as slug,
    r.first_name,
    r.age,
    r.city,
    (160 + (r.n % 18))::int as lengte_cm,
    (48 + (r.n % 20))::int as gewicht_kg,
    (array['A','B','C','D'])[((r.n - 1) % 4) + 1] as cup_maat,
    'Nederland' as country,
    format(
      'Hoi, ik ben %s uit %s. Dit is een testprofiel voor het image/chat platform.',
      r.first_name,
      r.city
    ) as bio,
    jsonb_build_array(r.interest_a, r.interest_b, 'Chatten') as interests,
    'speels, direct, flirterig maar natuurlijk' as personality,
    'Je bent een speels testprofiel. Reageer kort, natuurlijk en in het Nederlands.' as system_prompt,
    format('https://picsum.photos/seed/test-%s-main/900/1200', r.n3) as avatar_url,
    jsonb_build_array(
      format('https://picsum.photos/seed/test-%s-1/900/1200', r.n3),
      format('https://picsum.photos/seed/test-%s-2/900/1200', r.n3),
      format('https://picsum.photos/seed/test-%s-3/900/1200', r.n3),
      format('https://picsum.photos/seed/test-%s-4/900/1200', r.n3)
    ) as photo_urls,
    'nl' as voice_language,
    'Nederlands' as heritage,
    true as is_active
  from rows r
  on conflict (slug) do update
    set first_name = excluded.first_name,
        age = excluded.age,
        city = excluded.city,
        lengte_cm = excluded.lengte_cm,
        gewicht_kg = excluded.gewicht_kg,
        cup_maat = excluded.cup_maat,
        country = excluded.country,
        bio = excluded.bio,
        interests = excluded.interests,
        personality = excluded.personality,
        system_prompt = excluded.system_prompt,
        avatar_url = excluded.avatar_url,
        photo_urls = excluded.photo_urls,
        voice_language = excluded.voice_language,
        heritage = excluded.heritage,
        is_active = excluded.is_active,
        updated_at = now()
  returning id, slug, avatar_url, photo_urls
),
clean_media as (
  delete from public.profile_media pm
  using upserted u
  where pm.profile_id = u.id
  returning pm.id
)
insert into public.profile_media (profile_id, media_type, url, sort_order)
select u.id, 'image', u.avatar_url, 0
from upserted u
where u.avatar_url is not null
union all
select
  u.id,
  'image',
  p.url,
  p.ord
from upserted u
cross join lateral jsonb_array_elements_text(coalesce(u.photo_urls, '[]'::jsonb)) with ordinality as p(url, ord);

commit;

-- Quick verification:
-- select count(*) from profiles where slug like 'test-profiel-%';
-- select p.slug, p.first_name, p.city, p.avatar_url
-- from profiles p
-- where p.slug like 'test-profiel-%'
-- order by p.slug
-- limit 10;
