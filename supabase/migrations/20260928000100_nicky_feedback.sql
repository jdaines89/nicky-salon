-- Nicky's first week of real use (2026-09-28): quantities, vouchers, the
-- late-cancellation fee, promotions with dates, and blocked-out time.
--
-- Additive only. Every existing row keeps its values and means what it meant:
--   * booking_services.quantity defaults to 1, and price_at_time stays the
--     line's total (unit price x quantity), so every revenue sum is unchanged.
--   * clients.shape and clients.shade stay; the app just stops asking for them.
--   * the payment_method check only widens (adds 'voucher').
-- Idempotent, so re-running it changes nothing.

-- ------------------------------------------------------------
-- Quantity on a booked service ("Nail art x 5")
-- ------------------------------------------------------------
alter table public.booking_services add column if not exists quantity integer not null default 1;
do $$ begin
  if not exists (select 1 from pg_constraint where conrelid = 'public.booking_services'::regclass
                 and conname = 'booking_services_quantity_check') then
    alter table public.booking_services add constraint booking_services_quantity_check
      check (quantity between 1 and 99);
  end if;
end $$;
comment on column public.booking_services.quantity is
  'How many of this service (nail art per nail x 5). price_at_time is the line total, unit price x quantity.';

-- ------------------------------------------------------------
-- Vouchers as a way to pay
-- ------------------------------------------------------------
alter table public.bookings drop constraint if exists bookings_payment_method_check;
alter table public.bookings add constraint bookings_payment_method_check
  check (payment_method is null or payment_method in ('cash', 'card', 'transfer', 'voucher'));
alter table public.bookings add column if not exists voucher_code text;
alter table public.bookings add column if not exists voucher_value numeric(10,2);
do $$ begin
  if not exists (select 1 from pg_constraint where conrelid = 'public.bookings'::regclass
                 and conname = 'bookings_voucher_value_check') then
    alter table public.bookings add constraint bookings_voucher_value_check
      check (voucher_value is null or voucher_value >= 0);
  end if;
end $$;

-- ------------------------------------------------------------
-- Late cancellation: under 24 hours' notice, not an emergency. 30% of the
-- cancelled visit is owed at the client's next visit, unless Nicky waives it.
-- ------------------------------------------------------------
alter table public.bookings add column if not exists late_cancel boolean not null default false;
alter table public.bookings add column if not exists late_fee numeric(10,2);
alter table public.bookings add column if not exists late_fee_status text;
alter table public.bookings add column if not exists late_fee_booking_id uuid
  references public.bookings(id) on delete set null;
do $$ begin
  if not exists (select 1 from pg_constraint where conrelid = 'public.bookings'::regclass
                 and conname = 'bookings_late_fee_status_check') then
    alter table public.bookings add constraint bookings_late_fee_status_check
      check (late_fee_status is null or late_fee_status in ('owed', 'charged', 'waived'));
  end if;
end $$;
comment on column public.bookings.late_fee_booking_id is
  'The later visit the late-cancellation fee was added to (late_fee_status = charged).';

-- ------------------------------------------------------------
-- Promotions (were "packages"): an optional date window. Outside it the
-- promotion isn't offered for a booking on that date.
-- ------------------------------------------------------------
alter table public.services add column if not exists promo_start date;
alter table public.services add column if not exists promo_end date;
do $$ begin
  if not exists (select 1 from pg_constraint where conrelid = 'public.services'::regclass
                 and conname = 'services_promo_window_check') then
    alter table public.services add constraint services_promo_window_check
      check (promo_start is null or promo_end is null or promo_end >= promo_start);
  end if;
end $$;

-- ------------------------------------------------------------
-- Blocked-out time (lunch, a school run): no bookings offered in it.
-- ------------------------------------------------------------
create table if not exists public.time_locks (
  id               uuid primary key default gen_random_uuid(),
  date             date not null,
  time             time not null,
  duration_minutes integer not null default 60 check (duration_minutes between 5 and 24 * 60),
  label            text not null default 'Blocked',
  created_at       timestamptz not null default now()
);
create index if not exists idx_time_locks_date on public.time_locks (date);

alter table public.time_locks enable row level security;
alter table public.time_locks force row level security;
revoke all on public.time_locks from anon, public;
revoke truncate, references, trigger on public.time_locks from authenticated;
grant select, insert, update, delete on public.time_locks to authenticated;
drop policy if exists "staff full access" on public.time_locks;
create policy "staff full access" on public.time_locks for all to authenticated
  using (public.is_staff()) with check (public.is_staff());

-- ------------------------------------------------------------
-- Nightly snapshot covers the new table too.
-- ------------------------------------------------------------
create or replace function snapshots.capture() returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  batch uuid := gen_random_uuid();
  n bigint;
  total bigint := 0;
  t text;
begin
  foreach t in array array['clients','services','recurring_series','bookings','booking_services','time_locks'] loop
    execute format(
      'insert into snapshots.rows (batch_id, table_name, row_data)
       select $1, %L, to_jsonb(x) from public.%I x', t, t) using batch;
    get diagnostics n = row_count;
    total := total + n;
  end loop;
  delete from snapshots.rows where captured_at < now() - interval '35 days';
  return format('captured %s rows in batch %s', total, batch);
end
$$;
