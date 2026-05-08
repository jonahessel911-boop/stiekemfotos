-- Add configurable photo unlock price per profile.
-- Run in Supabase SQL editor.

alter table profiles
  add column if not exists photo_unlock_credits integer not null default 100;

alter table profiles
  add constraint profiles_photo_unlock_credits_check
  check (photo_unlock_credits > 0);

-- Example 1: set same price for all active profiles.
-- update profiles
-- set photo_unlock_credits = 100
-- where is_active = true;

-- Example 2: set price for one profile by id.
-- update profiles
-- set photo_unlock_credits = 125
-- where id = '00000000-0000-0000-0000-000000000000';

-- Example 3: set price for one profile by first name.
-- update profiles
-- set photo_unlock_credits = 150
-- where lower(first_name) = lower('Sophie');

-- Verify current prices.
-- select id, first_name, photo_unlock_credits
-- from profiles
-- order by created_at desc;
