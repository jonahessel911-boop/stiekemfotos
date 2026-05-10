-- Relationele opslag i.p.v. app_blobs JSON voor chats en foto-aanvragen (+ gallery-map).
-- Voer uit in Supabase SQL editor na schema.sql.

create index if not exists idx_conversations_owner_user_id on conversations (owner_user_id);

create table if not exists photo_requests (
  id uuid primary key,
  owner_user_id uuid not null references users (id) on delete cascade,
  payload jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

drop trigger if exists trg_photo_requests_updated_at on photo_requests;
create trigger trg_photo_requests_updated_at before
update on photo_requests for each row execute function set_updated_at();

create index if not exists idx_photo_requests_updated on photo_requests (updated_at desc);

create table if not exists user_gallery_prefs (
  user_id uuid primary key references users (id) on delete cascade,
  folders jsonb not null default '[]'::jsonb,
  folder_map jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

drop trigger if exists trg_user_gallery_prefs_updated_at on user_gallery_prefs;
create trigger trg_user_gallery_prefs_updated_at before
update on user_gallery_prefs for each row execute function set_updated_at();
