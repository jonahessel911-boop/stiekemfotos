-- Eénmalige platform-intro na eerste login (users.platform_onboarding_completed_at)
alter table users
  add column if not exists platform_onboarding_completed_at timestamptz;

comment on column users.platform_onboarding_completed_at is
  'Gezet zodra de gebruiker de welkomst-onboarding heeft afgerond; NULL = nog niet (nieuwe accounts).';
