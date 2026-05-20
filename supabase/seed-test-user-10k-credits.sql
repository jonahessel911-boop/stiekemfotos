-- Testaccount met 10.000 credits in Supabase (credit_ledger).
-- Wachtwoord: TestAccount10k!  (zelfde scrypt-formaat als Node: salt_hex:hash_hex, scrypt 64 bytes)
--
-- Let op: inloggen in de app gaat via users.json (Vercel blob), niet alleen via deze rij.
--         Klik in /admin op "Testaccount 10k" om het account in users.json te zetten,
--         of draai POST /api/admin/seed-test-user (admin ingelogd).
--
-- Draai in Supabase → SQL Editor. Pas e-mail aan indien gewenst.

begin;

-- Optioneel: oude testuser met deze e-mail weghalen
delete from public.credit_ledger
 where user_id in (select id from public.users where email = 'test10kcredits@stiekemefotos.test');

delete from public.users
 where email = 'test10kcredits@stiekemefotos.test';

insert into public.users (
  id,
  email,
  naam,
  leeftijd,
  password_hash,
  discreet_akkoord,
  voorwaarden_akkoord,
  email_verified_at,
  created_at,
  updated_at
) values (
  'a0000000-0000-4000-8000-000000000001'::uuid,
  'test10kcredits@stiekemefotos.test',
  'Test 10k credits',
  30,
  '0123456789abcdef0123456789abcdef:70856528405e6123e1231d8d77ca64538692cebf74dab5ac24fdd814a7875193f41d66e07db59d5e4489bdc0d428de41b967fbf8b0235e074b9e9f73692cbc36',
  true,
  true,
  now(),
  now(),
  now()
);

insert into public.credit_ledger (user_id, direction, amount, reason, metadata)
values (
  'a0000000-0000-4000-8000-000000000001'::uuid,
  'credit',
  10000,
  'test_grant',
  '{"source": "seed-test-user-10k-credits.sql"}'::jsonb
);

commit;

-- Controle saldo (som ledger: credits − debits)
-- select
--   u.email,
--   coalesce(sum(case when l.direction = 'credit' then l.amount when l.direction = 'debit' then -l.amount end), 0) as balance
-- from public.users u
-- left join public.credit_ledger l on l.user_id = u.id
-- where u.email = 'test10kcredits@stiekemefotos.test'
-- group by u.id, u.email;
