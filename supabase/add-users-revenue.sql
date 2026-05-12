-- Per-user totale revenue (som van alle voltooide Stripe-betalingen).
-- Idempotent: veilig om meerdere keren te draaien.

-- 1. Exacte bedragen op stripe_checkouts (was alleen `price_label` als display string).
alter table public.stripe_checkouts
  add column if not exists amount_cents integer,
  add column if not exists currency     text not null default 'eur';

create index if not exists idx_stripe_checkouts_user_paid
  on public.stripe_checkouts (user_id, fulfilled_at);

-- 2. Cached totale revenue per user.
alter table public.users
  add column if not exists revenue_cents bigint not null default 0,
  add column if not exists revenue_currency text not null default 'eur',
  add column if not exists last_payment_at  timestamptz;

create index if not exists idx_users_revenue_cents
  on public.users (revenue_cents desc);

-- 3. Backfill stripe_checkouts.amount_cents uit price_label voor zover parseerbaar.
--    Formaten die voorkomen: "€10,00", "€9,99", "€19,99 actie", "10.00", "9,99".
update public.stripe_checkouts
   set amount_cents = (
         (regexp_match(price_label, '([0-9]+)[.,]([0-9]{1,2})'))[1]::int * 100
       + lpad((regexp_match(price_label, '([0-9]+)[.,]([0-9]{1,2})'))[2], 2, '0')::int
   )
 where amount_cents is null
   and price_label is not null
   and regexp_match(price_label, '([0-9]+)[.,]([0-9]{1,2})') is not null;

-- 4. Trigger functie: zodra een checkout fulfilled_at krijgt (of amount_cents wijzigt
--    voor een al-gefulfilled checkout), update users.revenue_cents.
create or replace function public.recalculate_user_revenue(target_user_id uuid)
returns void
language plpgsql
as $$
begin
  if target_user_id is null then return; end if;

  update public.users u
     set revenue_cents    = coalesce((
            select sum(coalesce(sc.amount_cents, 0))::bigint
              from public.stripe_checkouts sc
             where sc.user_id = u.id
               and sc.fulfilled_at is not null
         ), 0),
         last_payment_at  = (
            select max(sc.fulfilled_at)
              from public.stripe_checkouts sc
             where sc.user_id = u.id
               and sc.fulfilled_at is not null
         )
   where u.id = target_user_id;
end;
$$;

create or replace function public.stripe_checkouts_after_change()
returns trigger
language plpgsql
as $$
begin
  if (tg_op = 'INSERT') then
    if new.user_id is not null then
      perform public.recalculate_user_revenue(new.user_id);
    end if;
  elsif (tg_op = 'UPDATE') then
    if new.user_id is not null then
      perform public.recalculate_user_revenue(new.user_id);
    end if;
    if old.user_id is not null and old.user_id is distinct from new.user_id then
      perform public.recalculate_user_revenue(old.user_id);
    end if;
  elsif (tg_op = 'DELETE') then
    if old.user_id is not null then
      perform public.recalculate_user_revenue(old.user_id);
    end if;
    return old;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_stripe_checkouts_revenue on public.stripe_checkouts;
create trigger trg_stripe_checkouts_revenue
after insert or update or delete on public.stripe_checkouts
for each row execute function public.stripe_checkouts_after_change();

-- 5. One-time backfill: vul revenue_cents voor bestaande users obv alle fulfilled
--    checkouts.
update public.users u
   set revenue_cents = coalesce(t.total_cents, 0),
       last_payment_at = t.max_paid_at
  from (
    select sc.user_id,
           sum(coalesce(sc.amount_cents, 0))::bigint as total_cents,
           max(sc.fulfilled_at) as max_paid_at
      from public.stripe_checkouts sc
     where sc.fulfilled_at is not null
       and sc.user_id is not null
  group by sc.user_id
  ) t
 where t.user_id = u.id;
