-- Core platform schema for discreetemeisjes.nl
-- Run this in Supabase SQL editor for project hbfwgulodzodxcyhzhbq

create extension if not exists pgcrypto;

create table if not exists app_blobs (
  key text primary key,
  payload jsonb not null,
  updated_at timestamptz not null default now()
);

create or replace function set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_app_blobs_updated_at on app_blobs;
create trigger trg_app_blobs_updated_at
before update on app_blobs
for each row execute function set_updated_at();

create table if not exists users (
  id uuid primary key default gen_random_uuid(),
  email text not null unique,
  naam text not null,
  leeftijd integer not null,
  password_hash text not null,
  discreet_akkoord boolean not null default false,
  voorwaarden_akkoord boolean not null default false,
  email_verify_token text,
  email_verified_at timestamptz,
  zoek_leeftijd_categorie text,
  zoek_eigenschappen jsonb,
  geschatte_matches integer,
  first_credit_purchase_at timestamptz,
  last_seen_at timestamptz,
  engagement_slots jsonb,
  reaction_nudges jsonb,
  personal_facts jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table users
  add column if not exists personal_facts jsonb;

drop trigger if exists trg_users_updated_at on users;
create trigger trg_users_updated_at
before update on users
for each row execute function set_updated_at();

create table if not exists onboarding_signups (
  id uuid primary key default gen_random_uuid(),
  naam text not null,
  email text not null,
  leeftijd integer not null,
  discreet_akkoord boolean not null default false,
  voorwaarden_akkoord boolean not null default false,
  created_at timestamptz not null default now()
);

create table if not exists conversations (
  id uuid primary key default gen_random_uuid(),
  owner_user_id uuid references users(id) on delete cascade,
  profile_id text not null,
  profile_name text not null,
  profile_avatar text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  metadata jsonb not null default '{}'::jsonb
);

drop trigger if exists trg_conversations_updated_at on conversations;
create trigger trg_conversations_updated_at
before update on conversations
for each row execute function set_updated_at();

create table if not exists messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references conversations(id) on delete cascade,
  role text not null check (role in ('user', 'assistant', 'system')),
  content text not null default '',
  image_url text,
  voice_url text,
  gift_credits integer,
  gift_label text,
  gift_note text,
  created_at timestamptz not null default now(),
  metadata jsonb not null default '{}'::jsonb
);

create index if not exists idx_messages_conversation_created
  on messages (conversation_id, created_at);

create table if not exists stripe_checkouts (
  session_id text primary key,
  user_id uuid references users(id) on delete set null,
  credits integer not null,
  price_label text not null,
  paid_at timestamptz,
  fulfilled_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

drop trigger if exists trg_stripe_checkouts_updated_at on stripe_checkouts;
create trigger trg_stripe_checkouts_updated_at
before update on stripe_checkouts
for each row execute function set_updated_at();

create table if not exists credit_ledger (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  direction text not null check (direction in ('credit', 'debit')),
  amount integer not null check (amount > 0),
  reason text not null,
  reference_id text,
  created_at timestamptz not null default now(),
  metadata jsonb not null default '{}'::jsonb
);

create index if not exists idx_credit_ledger_user_created
  on credit_ledger (user_id, created_at desc);

create table if not exists profiles (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  first_name text not null,
  age integer not null check (age between 21 and 32),
  city text not null,
  country text not null,
  bio text not null,
  interests jsonb not null default '[]'::jsonb,
  personality text not null,
  system_prompt text not null,
  avatar_url text,
  photo_urls jsonb not null default '[]'::jsonb,
  voice_language text not null default 'ro',
  heritage text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

drop trigger if exists trg_profiles_updated_at on profiles;
create trigger trg_profiles_updated_at
before update on profiles
for each row execute function set_updated_at();

create table if not exists profile_media (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references profiles(id) on delete cascade,
  media_type text not null default 'image' check (media_type in ('image', 'video')),
  url text not null,
  sort_order integer not null default 0,
  created_at timestamptz not null default now()
);

create index if not exists idx_profile_media_profile_order
  on profile_media (profile_id, sort_order);
