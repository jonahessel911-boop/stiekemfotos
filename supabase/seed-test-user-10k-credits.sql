-- Testaccount met 10.000 credits in Supabase (credit_ledger).
-- Wachtwoord: 1234  (zelfde scrypt-formaat als Node: salt_hex:hash_hex, scrypt 64 bytes)
--
-- Let op: inloggen in de app gaat via users.json (Vercel blob), niet alleen via deze rij.
--         Klik in /admin op "Testaccount 10k" om het account in users.json te zetten,
--         of draai POST /api/admin/seed-test-user (admin ingelogd).
--
-- Draai in Supabase → SQL Editor. Pas e-mail aan indien gewenst.

begin;

delete from public.credit_ledger
 where user_id in (select id from public.users where email in ('jona@fioads.com', 'test10kcredits@stiekemefotos.test'));

delete from public.users
 where email in ('jona@fioads.com', 'test10kcredits@stiekemefotos.test');

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
  'jona@fioads.com',
  'Jona test',
  30,
  '89aa360c1f73de198db9bb4b21b48959:1d87bfee29f2cb2954559fac341f0f1f56a6eb90155bdd4c29a0ea77d4c411ff7ca80dbebe160fe159fcf3837de0ca70dc1a630d82ebf661a70dccba579f91ea',
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
-- where u.email = 'jona@fioads.com'
-- group by u.id, u.email;
