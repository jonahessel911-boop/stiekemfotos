-- Reset alle app-gebruikers, chats en credit-/stripe-data in Supabase.
-- Profielen (profiles / profile_media) worden NIET aangepast.
--
-- Gebruik: Supabase → SQL Editor → plak dit script → Run.
-- LET OP: onomkeerbaar. Maak eerst een backup als je data wilt bewaren.

begin;

-- Relationele tabellen (volgorde: afhankelijkheden worden in één TRUNCATE opgelost)
truncate table
  messages,
  conversations,
  credit_ledger,
  stripe_checkouts,
  users,
  onboarding_signups
restart identity cascade;

-- JSON state die de app naast Postgres in app_blobs bewaart (users.json, chats, checkouts)
delete from app_blobs
where key in (
  'users.json',
  'conversations.json',
  'stripe-checkouts.json'
);

commit;

-- Insert initial free credits for demo users (every user starts with 100 credits)
-- This ensures the "simple count sum every message - 10" formula works from a clean slate.
INSERT INTO users (id, email, naam, leeftijd, password_hash, discreet_akkoord, voorwaarden_akkoord, created_at)
VALUES 
  ('00000000-0000-0000-0000-000000000001', 'demo@discreetemeisjes.nl', 'Demo Gebruiker', 28, '$2a$10$dummyhashforreset', true, true, now())
ON CONFLICT (id) DO NOTHING;

INSERT INTO credit_ledger (user_id, direction, amount, reason, metadata)
VALUES 
  ('00000000-0000-0000-0000-000000000001', 'credit', 100, 'initial_free', '{"source": "reset"}'::jsonb);

-- Optioneel: controleer dat alles leeg is (uncomment om te draaien)
-- select (select count(*) from users) as users_count,
--        (select count(*) from conversations) as conv_count,
--        (select count(*) from messages) as msg_count,
--        (select count(*) from credit_ledger) as ledger_count,
--        (select count(*) from app_blobs where key in ('users.json','conversations.json','stripe-checkouts.json')) as blob_keys_left;
