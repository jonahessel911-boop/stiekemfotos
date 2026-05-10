-- Lengte/gewicht/cup (optioneel op profielen). Draai op bestaande Supabase als seeds/API deze velden gebruiken.
alter table public.profiles
  add column if not exists lengte_cm integer,
  add column if not exists gewicht_kg integer,
  add column if not exists cup_maat text;
