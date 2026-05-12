-- Voegt Swift Visit Log click_id (+ optionele payout/txid) toe aan de users tabel.
-- Idempotent: veilig om meerdere keren te draaien.

alter table public.users
  add column if not exists click_id   text,
  add column if not exists svl_payout text,
  add column if not exists svl_txid   text;

create index if not exists idx_users_click_id on public.users (click_id);
