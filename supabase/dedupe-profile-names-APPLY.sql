-- ============================================================================
-- PAS OP: wijzigt public.profiles en public.profile_media.
--
-- Wie wordt hernoemd?
--   A) Dubbele voornamen: alle behalve het **oudste** profiel per naam (keeper).
--   B) Profielen waar first_name nog het oude patroon heeft: voornaam + ' · ' of ' - '
--      + 8 hex (vorige script). Die krijgen een schone **nieuwe** voornaam.
--
-- Nieuwe naam: eerste vrije naam uit een grote pool (volgorde roteert per profiel-
-- id zodat het niet altijd Lotte wordt). Geen uuid-suffix meer.
--
-- Media: sort_order 1 en 2 worden gewist (naamkaartje-slots).
--
-- Backup eerst. Één transactie.
-- ============================================================================

BEGIN;

DO $$
DECLARE
  r RECORD;
  pool text[] := ARRAY[
    'Lotte', 'Sanne', 'Noa', 'Mila', 'Romy', 'Iris', 'Nina', 'Zoey', 'Yara', 'Lina', 'Vera', 'Tess',
    'Emma', 'Sophie', 'Julia', 'Fleur', 'Eva', 'Lisa', 'Anna', 'Bo', 'Liv', 'Kim', 'Demi', 'Marie',
    'Julie', 'Sofie', 'Roos', 'Saar', 'Evi', 'Floor', 'Nienke', 'Britt', 'Fenna', 'Merel', 'Jasmijn',
    'Anouk', 'Celine', 'Esmee', 'Manon', 'Eline', 'Tessa', 'Danique', 'Fayah', 'Quincy', 'Selena',
    'Wies', 'Puck', 'Marit', 'Nikkie', 'Odette', 'Philou', 'Renske', 'Sterre', 'Trijntje', 'Uma',
    'Vieve', 'Wilma', 'Xenia', 'Ilse', 'Jette', 'Kyara', 'Lieke', 'Maaike', 'Nicky', 'Olivia',
    'Petra', 'Quinn', 'Rosalie', 'Susanne', 'Thea', 'Una', 'Violet', 'Zara',
    'Oksana', 'Kasia', 'Magdalena', 'Zuzanna', 'Milena', 'Radka', 'Alina', 'Iveta', 'Lenka', 'Nadia',
    'Elin', 'Freya', 'Ingrid', 'Saga', 'Linnea', 'Astrid', 'Elsa', 'Malin',
    'Giulia', 'Chiara', 'Martina', 'Valentina', 'Paola', 'Silvia', 'Renata', 'Flavia',
    'Mei', 'Yuki', 'Lin', 'Hana', 'Siti', 'Indah', 'Dewi', 'Rani', 'Soraya',
    'Elif', 'Zeynep', 'Selin', 'Dilara', 'Burcu', 'Merve', 'Ilayda', 'Aylin', 'Esra', 'Gizem',
    'Emine', 'Havin', 'Leyla', 'Defne', 'Ceren', 'Asya', 'Melis', 'Damla', 'Ebru', 'Sumeyra',
    'Rania', 'Yasmina', 'Salma', 'Malak', 'Nour', 'Rasha', 'Hanan', 'Amal', 'Dua',
    'Amara', 'Chioma', 'Eshe', 'Ifeoma', 'Zola', 'Adwoa', 'Makeda', 'Zuri',
    'Camila', 'Lucia', 'Valeria', 'Isabella', 'Daniela', 'Rocio', 'Sofia', 'Beatriz',
    'Shanti', 'Candice', 'Roxanne', 'Melissa', 'Monica', 'Janine', 'Sherida', 'Ashanti',
    'Karlijn', 'Mirthe', 'Femke', 'Annebel', 'Christel', 'Desiree', 'Ellen',
    'Noortje', 'Pien', 'Sien', 'Fien', 'Lize', 'Maud', 'Isa', 'Maya',
    'Luna', 'Tara', 'Yasmine', 'Hanna', 'Isabel', 'Claire', 'Elise', 'Renate', 'Moniek',
    'Heleen', 'Marieke', 'Inge', 'Bianca', 'Esther', 'Joyce', 'Lindy', 'Tamara'
  ];
  taken text[];
  new_nm text;
  nm text;
  j int;
  idx int;
  pool_len int;
BEGIN
  pool_len := array_length(pool, 1);

  SELECT coalesce(array_agg(DISTINCT lower(trim(first_name))), ARRAY[]::text[])
  INTO taken
  FROM public.profiles;

  DROP TABLE IF EXISTS _dedupe_targets;
  CREATE TEMP TABLE _dedupe_targets (id uuid PRIMARY KEY) ON COMMIT DROP;

  INSERT INTO _dedupe_targets (id)
  WITH dup_groups AS (
    SELECT
      lower(trim(first_name)) AS nk,
      array_agg(id ORDER BY created_at ASC NULLS LAST, id ASC) AS ids
    FROM public.profiles
    GROUP BY 1
    HAVING count(*) > 1
  ),
  tr_dup AS (
    SELECT p.id
    FROM public.profiles p
    JOIN dup_groups dg ON lower(trim(p.first_name)) = dg.nk
    WHERE p.id <> dg.ids[1]
  ),
  tr_suffix AS (
    SELECT p.id
    FROM public.profiles p
    WHERE (p.first_name LIKE '% · %' OR p.first_name LIKE '% - %')
      AND trim(p.first_name) ~ '[a-f0-9]{8}$'
  ),
  combined AS (
    SELECT id FROM tr_dup
    UNION
    SELECT id FROM tr_suffix
  )
  SELECT DISTINCT id FROM combined;

  DELETE FROM public.profile_media pm
  WHERE pm.profile_id IN (SELECT id FROM _dedupe_targets)
    AND pm.sort_order IN (1, 2);

  FOR r IN SELECT id FROM _dedupe_targets ORDER BY id
  LOOP
    new_nm := NULL;

    FOR j IN 0..pool_len - 1 LOOP
      idx := 1 + ((abs(hashtext(r.id::text)) + j) % pool_len);
      nm := pool[idx];
      IF NOT (lower(nm) = ANY (taken)) THEN
        new_nm := nm;
        taken := array_append(taken, lower(nm));
        EXIT;
      END IF;
    END LOOP;

    IF new_nm IS NULL THEN
      j := 1;
      LOOP
        new_nm := 'Noor' || j::text;
        EXIT WHEN NOT (lower(new_nm) = ANY (taken));
        j := j + 1;
        EXIT WHEN j > 50000;
      END LOOP;
      taken := array_append(taken, lower(new_nm));
    END IF;

    UPDATE public.profiles AS p
    SET
      first_name = new_nm,
      avatar_url = (
        SELECT pm.url
        FROM public.profile_media pm
        WHERE pm.profile_id = r.id
        ORDER BY pm.sort_order ASC
        LIMIT 1
      ),
      photo_urls = coalesce(
        (
          SELECT jsonb_agg(pm.url ORDER BY pm.sort_order ASC)
          FROM public.profile_media pm
          WHERE pm.profile_id = r.id
        ),
        '[]'::jsonb
      ),
      updated_at = now()
    WHERE p.id = r.id;
  END LOOP;

  DROP TABLE IF EXISTS _dedupe_targets;
END $$;

COMMIT;

-- Controle dubbele platte namen:
-- SELECT lower(trim(first_name)), count(*) FROM public.profiles GROUP BY 1 HAVING count(*) > 1;
