-- =============================================================================
-- LET OP
-- =============================================================================
-- Alleen de SELECT-queries hieronder (inclusief de “preview” met old_first_name /
-- new_first_name) lezen data — ze schrijven NIETS weg. Daarom blijven namen in de
-- app hetzelfde tot je het echte update-script draait:
--   → gebruik bestand: **dedupe-profile-names-APPLY.sql**
-- =============================================================================
--
-- 1) INZICHT: welke foto hoort bij welk profiel + waar zit typisch het naamkaartje?
-- =============================================================================
-- Er is géén aparte kolom "verificatiefoto" in de database. Bij admin random-
-- profielen wordt die in code op één willekeurige index gezet: **niet** op de
-- eerste foto (avatar), maar op **foto 2 of 3** → in Supabase `profile_media`
-- meestal **sort_order = 1 of 2** (0-based volgorde zoals bij insert).
-- Let op: niet elk profiel heeft een naamkaartje-foto; dan zijn 1 en 2 gewone shots.
--
-- Draai onderstaande SELECT’s eerst (alleen lezen).

-- Overzicht dubbele voornamen (case-insensitive)
SELECT
  lower(trim(p.first_name)) AS naam_key,
  count(*) AS aantal,
  array_agg(p.id ORDER BY p.created_at ASC, p.id ASC) AS profile_ids_volgorde,
  array_agg(p.slug ORDER BY p.created_at ASC, p.id ASC) AS slugs
FROM public.profiles p
GROUP BY 1
HAVING count(*) > 1
ORDER BY aantal DESC, naam_key;

-- Per profiel: alle media-URL’s met volgorde (sort_order 0 = eerste / avatar-lijn)
SELECT
  p.id AS profile_id,
  p.slug,
  p.first_name,
  p.created_at,
  pm.sort_order,
  pm.url,
  CASE
    WHEN pm.sort_order IN (1, 2) THEN 'typische slot voor naamkaartje (generator)'
    WHEN pm.sort_order = 0 THEN 'eerste foto (vaak ook avatar)'
    ELSE 'overige'
  END AS hint
FROM public.profiles p
JOIN public.profile_media pm ON pm.profile_id = p.id
WHERE lower(trim(p.first_name)) IN (
  SELECT lower(trim(p2.first_name))
  FROM public.profiles p2
  GROUP BY 1
  HAVING count(*) > 1
)
ORDER BY p.first_name, p.created_at, pm.sort_order;

-- Avatar vs photo_urls (JSON) naast elkaar
SELECT
  p.id,
  p.first_name,
  p.avatar_url,
  p.photo_urls
FROM public.profiles p
WHERE lower(trim(p.first_name)) IN (
  SELECT lower(trim(p2.first_name))
  FROM public.profiles p2
  GROUP BY 1
  HAVING count(*) > 1
)
ORDER BY p.first_name, p.created_at;


-- =============================================================================
-- 2) FIX: dubbele namen uniek maken + naamkaartje-slots wissen bij hernoemde rijen
-- =============================================================================
-- Strategie:
--   - Per groep gelijke naam: **oudste profiel** (created_at, dan id) behoudt de naam.
--   - Alle andere in die groep krijgen: "<oude naam> · <8 chars van uuid>" zodat de kaart
--     in de UI niet meer "Julia" toont terwijl de DB al "Samira" zegt — je verwijdert
--     daarna de shots waar het kaartje nog de oude naam kan tonen (sort_order 1 en 2).
--
-- Preview wie hernoemd wordt (nieuwe namen komen uit pool in dedupe-profile-names-APPLY.sql)
WITH dup_groups AS (
  SELECT
    lower(trim(first_name)) AS nk,
    array_agg(id ORDER BY created_at ASC NULLS LAST, id ASC) AS ids
  FROM public.profiles
  GROUP BY 1
  HAVING count(*) > 1
),
to_rename AS (
  SELECT
    p.id,
    p.first_name AS old_first_name,
    dg.ids[1] AS keeper_id
  FROM public.profiles p
  JOIN dup_groups dg ON lower(trim(p.first_name)) = dg.nk
  WHERE p.id <> dg.ids[1]
)
SELECT * FROM to_rename ORDER BY old_first_name, id;

-- Uitvoeren: **dedupe-profile-names-APPLY.sql** (PL/pgSQL: kiest vrije voornamen uit pool).

-- =============================================================================
-- 3) Optioneel: alleen media sync (als je first_name handmatig hebt gezet)
-- =============================================================================
/*
UPDATE public.profiles p
SET
  photo_urls = coalesce(
    (SELECT jsonb_agg(pm.url ORDER BY pm.sort_order ASC)
     FROM public.profile_media pm WHERE pm.profile_id = p.id),
    '[]'::jsonb
  ),
  avatar_url = (
    SELECT pm.url FROM public.profile_media pm
    WHERE pm.profile_id = p.id
    ORDER BY pm.sort_order ASC LIMIT 1
  ),
  updated_at = now()
WHERE p.id IN (...);
*/
