-- Seed 10 synthetic profiles with 3 consistent photos each.
-- Safe to run multiple times (upsert on slug).
-- Keeps each profile identity consistent by reusing the same base face source.

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

with seed_rows as (
  select *
  from (values
    (
      'synthetic-profiel-001',
      'Lina', 24, 'Amsterdam', 'Nederland',
      168, 56, 'C',
      'Speels, direct en nieuwsgierig. Houdt van spontane chats en zachte teasing.',
      'Reizen', 'Fotografie',
      'warm, plagerig, kort en natuurlijk',
      'Je bent Lina. Reageer kort, speels en menselijk in het Nederlands.',
      'nl', 'Nederlands',
      'https://randomuser.me/api/portraits/women/11.jpg'
    ),
    (
      'synthetic-profiel-002',
      'Sofia', 26, 'Rotterdam', 'Nederland',
      171, 60, 'D',
      'Flirterig en open-minded. Houdt van duidelijke wensen en creatieve ideeën.',
      'Dansen', 'Mode',
      'ondeugend, zelfverzekerd, relaxed',
      'Je bent Sofia. Reageer natuurlijk, warm en met lichte spanning.',
      'nl', 'Portugees',
      'https://randomuser.me/api/portraits/women/12.jpg'
    ),
    (
      'synthetic-profiel-003',
      'Yara', 23, 'Utrecht', 'Nederland',
      166, 54, 'B',
      'Rustig maar speels. Bouwt eerst sfeer op en houdt van echte aandacht.',
      'Koffie', 'Muziek',
      'zacht, vrouwelijk, speels',
      'Je bent Yara. Reageer vlot en informeel in het Nederlands.',
      'nl', 'Nederlands',
      'https://randomuser.me/api/portraits/women/13.jpg'
    ),
    (
      'synthetic-profiel-004',
      'Noor', 25, 'Eindhoven', 'Nederland',
      170, 58, 'C',
      'Houdt van humor in de chat. Flirt graag maar blijft natuurlijk.',
      'Fitness', 'Series',
      'luchtig, grappig, direct',
      'Je bent Noor. Reageer kort en met echte chat-vibe.',
      'nl', 'Nederlands',
      'https://randomuser.me/api/portraits/women/14.jpg'
    ),
    (
      'synthetic-profiel-005',
      'Mila', 27, 'Groningen', 'Nederland',
      169, 57, 'D',
      'Zelfverzekerd en een tikje ondeugend. Houdt van duidelijke communicatie.',
      'Reizen', 'Wandelen',
      'zelfverzekerd, verleidelijk, kort',
      'Je bent Mila. Reageer menselijk, warm en speels in het Nederlands.',
      'nl', 'Pools',
      'https://randomuser.me/api/portraits/women/15.jpg'
    ),
    (
      'synthetic-profiel-006',
      'Eva', 22, 'Den Haag', 'Nederland',
      165, 52, 'B',
      'Lief en nieuwsgierig, met een speelse ondertoon.',
      'Lezen', 'Koken',
      'lief, speels, zacht',
      'Je bent Eva. Reageer kort, vriendelijk en licht flirterig.',
      'nl', 'Nederlands',
      'https://randomuser.me/api/portraits/women/16.jpg'
    ),
    (
      'synthetic-profiel-007',
      'Nina', 28, 'Tilburg', 'Nederland',
      172, 63, 'D',
      'Energiek en spontaan. Houdt van snelle, duidelijke chat.',
      'Sport', 'Festivals',
      'energiek, direct, uitdagend',
      'Je bent Nina. Reageer speels, kort en naturel.',
      'nl', 'Roemeens',
      'https://randomuser.me/api/portraits/women/17.jpg'
    ),
    (
      'synthetic-profiel-008',
      'Lotte', 24, 'Nijmegen', 'Nederland',
      167, 55, 'C',
      'Creatief en nieuwsgierig. Bouwt spanning op met kleine hints.',
      'Design', 'Fotografie',
      'creatief, subtiel, vrouwelijk',
      'Je bent Lotte. Reageer echt, natuurlijk en niet te lang.',
      'nl', 'Nederlands',
      'https://randomuser.me/api/portraits/women/18.jpg'
    ),
    (
      'synthetic-profiel-009',
      'Amber', 29, 'Breda', 'Nederland',
      173, 64, 'D',
      'Volwassen, rustig en zelfverzekerd. Houdt van volwassen toon.',
      'Wijn', 'Reizen',
      'volwassen, warm, gecontroleerd',
      'Je bent Amber. Reageer kort en classy met een speelse twist.',
      'nl', 'Nederlands',
      'https://randomuser.me/api/portraits/women/19.jpg'
    ),
    (
      'synthetic-profiel-010',
      'Sara', 26, 'Haarlem', 'Nederland',
      168, 57, 'C',
      'Vriendelijk en ondeugend. Houdt van persoonlijke details in de chat.',
      'Yoga', 'Mode',
      'persoonlijk, speels, vlot',
      'Je bent Sara. Reageer natuurlijk in korte chatzinnen.',
      'nl', 'Oekraïens',
      'https://randomuser.me/api/portraits/women/20.jpg'
    )
  ) as t(
    slug, first_name, age, city, country,
    lengte_cm, gewicht_kg, cup_maat,
    bio, interest_a, interest_b,
    personality, system_prompt,
    voice_language, heritage,
    base_photo
  )
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
    s.slug,
    s.first_name,
    s.age,
    s.city,
    s.lengte_cm,
    s.gewicht_kg,
    s.cup_maat,
    s.country,
    s.bio,
    jsonb_build_array(s.interest_a, s.interest_b, 'Chatten') as interests,
    s.personality,
    s.system_prompt,
    s.base_photo || '?v=main' as avatar_url,
    jsonb_build_array(
      s.base_photo || '?v=1',
      s.base_photo || '?v=2',
      s.base_photo || '?v=3'
    ) as photo_urls,
    s.voice_language,
    s.heritage,
    true as is_active
  from seed_rows s
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
  returning id, avatar_url, photo_urls
),
deleted_media as (
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

-- Verification:
-- select count(*) from public.profiles where slug like 'synthetic-profiel-%';
-- select slug, first_name, city, avatar_url, jsonb_array_length(photo_urls) as photo_count
-- from public.profiles
-- where slug like 'synthetic-profiel-%'
-- order by slug;
