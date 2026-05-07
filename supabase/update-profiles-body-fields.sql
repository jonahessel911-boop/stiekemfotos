alter table if exists profiles
  add column if not exists lengte_cm integer check (lengte_cm between 140 and 220),
  add column if not exists gewicht_kg integer check (gewicht_kg between 35 and 180),
  add column if not exists cup_maat text;
