-- Exacte visuele referentie-prompt (zoals bij profielfoto-generatie) voor chat image generation.
alter table public.profiles
  add column if not exists visual_identity_prompt text;

comment on column public.profiles.visual_identity_prompt is
  'English prompt fragment: stable appearance + amateur style used when profile photos were generated; reuse for chat unlock images.';
