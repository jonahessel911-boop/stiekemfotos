-- ============================================================================
-- Na het draaien van dedupe-profile-names-APPLY.sql — alleen controleren (geen writes).
-- ============================================================================

-- 1) Geen dubbele voornamen meer (case-insensitive)?
SELECT
  lower(trim(first_name)) AS naam_key,
  count(*) AS aantal
FROM public.profiles
GROUP BY 1
HAVING count(*) > 1
ORDER BY aantal DESC, naam_key;

-- Verwachting: **geen rijen**.

-- 2) Optioneel: rijen die nog het oude suffix-patroon hebben (naam · uuid)?
SELECT id, first_name, slug, created_at
FROM public.profiles
WHERE (first_name LIKE '% · %' OR first_name LIKE '% - %')
  AND trim(first_name) ~ '[a-f0-9]{8}$'
ORDER BY created_at;

-- Verwachting: **geen rijen** na een volledige APPLY-run.
