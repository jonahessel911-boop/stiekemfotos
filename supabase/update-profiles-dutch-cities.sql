-- Eenmalig in Supabase SQL Editor: zet alle actieve profielen op een Nederlandse stad.
-- `system_prompt` wordt niet aangepast; na grote wijzigingen kun je `npm run seed:profiles` (of je seed-script) opnieuw draaien voor consistente prompts.

UPDATE public.profiles
SET
  city = (
    ARRAY[
      'Amsterdam','Rotterdam','Utrecht','Den Haag','Eindhoven','Groningen',
      'Tilburg','Almere','Breda','Nijmegen','Haarlem','Arnhem','Maastricht',
      'Leiden','Zwolle','Enschede','Apeldoorn','Amersfoort','Hilversum','Delft',
      'Venlo','Deventer','Roosendaal','Schiedam','Zaanstad'
    ]
  )[1 + (abs(hashtext(id::text)) % 25)],
  country = 'Nederland',
  updated_at = now();
