-- Random admin-profielen: leeftijd 18–30 (was 21–32).
alter table public.profiles
  drop constraint if exists profiles_age_check;

alter table public.profiles
  add constraint profiles_age_check check (age between 18 and 30);
