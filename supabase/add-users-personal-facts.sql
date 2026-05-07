-- Adds realtime chat-memory facts field to users.
alter table if exists public.users
  add column if not exists personal_facts jsonb;
