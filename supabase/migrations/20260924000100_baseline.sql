-- Baseline: the live salon schema as it stood on 2026-09-24, before login.
--
-- Everything the Streamlit app built by hand-pasting SQL files into the
-- editor, gathered into one migration so a fresh database built from these
-- migrations equals live:
--   supabase_schema.sql       clients, services, recurring_series, bookings,
--                             booking_services + their indexes
--   photos_schema.sql         client_photos, the private client-photos bucket
--                             and its three storage policies
--   payment_method_schema.sql bookings.payment_method + check + index
--   snapshot_backups.sql      snapshots.rows, snapshots.capture(), nightly job
--
-- Idempotent, and a no-op on live (checked against live on 2026-09-24:
-- columns, types, defaults, constraints, indexes, bucket and cron job all
-- match). On live, mark it applied rather than running it:
--   supabase migration repair --status applied 20260924000100
-- Live's history also holds 20260924052351 (bookings_payment_method, applied
-- through the dashboard); it is folded in here, so mark it reverted:
--   supabase migration repair --status reverted 20260924052351
--
-- Nothing here turns on row-level security: live runs with it off, because
-- the Streamlit app uses the anon key. 20260924000300_security.sql does that,
-- at cutover.

-- ============================================================
-- Salon tables
-- ============================================================

create table if not exists public.clients (
  id            uuid primary key default gen_random_uuid(),
  name          text not null,
  phone         text,
  shape         text,                          -- preferred nail shape
  shade         text,                          -- preferred shade
  birthday      text,                          -- 'MM-DD', no year needed
  prior_visits  jsonb default '[]'::jsonb,     -- one-time pre-system backfill; never written after go-live
  created_at    timestamptz default now()
);

create table if not exists public.services (
  id                uuid primary key default gen_random_uuid(),
  category          text not null,             -- 'Packages' is reserved for bundles
  name              text not null,
  price             numeric(10,2) not null default 0,
  duration_minutes  integer not null default 30,
  active            boolean default true,      -- soft delete: history stays intact
  created_at        timestamptz default now()
);

create table if not exists public.recurring_series (
  id             uuid primary key default gen_random_uuid(),
  client_id      uuid references public.clients(id) on delete restrict,
  freq_days      integer not null,             -- 7 / 14 / 28
  start_date     date not null,
  end_type       text not null,                -- 'count' | 'until'
  end_count      integer,
  end_date       date,
  status         text not null default 'confirmed',
  notes          text,
  active         boolean default true,
  created_at     timestamptz default now()
);

create table if not exists public.bookings (
  id               uuid primary key default gen_random_uuid(),
  client_id        uuid references public.clients(id) on delete restrict,
  series_id        uuid references public.recurring_series(id) on delete set null,  -- null = one-off
  date             date not null,
  time             time not null,
  duration_minutes integer not null default 30,
  status           text not null default 'confirmed',  -- confirmed | pending | cancelled | no-show
  discount         numeric(10,2) not null default 0,   -- reduces recognised revenue
  tip              numeric(10,2) not null default 0,   -- never counted as revenue
  notes            text,
  created_at       timestamptz default now()
);

create table if not exists public.booking_services (
  id            uuid primary key default gen_random_uuid(),
  booking_id    uuid references public.bookings(id) on delete cascade,
  service_id    uuid references public.services(id) on delete restrict,
  service_name  text not null,             -- snapshotted at booking time
  price_at_time numeric(10,2) not null     -- snapshotted: repricing never rewrites past revenue
);

create index if not exists idx_bookings_date   on public.bookings(date);
create index if not exists idx_bookings_client on public.bookings(client_id);
create index if not exists idx_bookings_series on public.bookings(series_id);
create index if not exists idx_booking_services_booking on public.booking_services(booking_id);

-- ============================================================
-- How each booking was paid (payment_method_schema.sql)
-- ============================================================
-- Nullable, no default: bookings from before this existed are "not recorded",
-- not guessed. Never feeds a revenue figure.

alter table public.bookings add column if not exists payment_method text;

do $$ begin
  if not exists (select 1 from pg_constraint
                 where conrelid = 'public.bookings'::regclass
                   and conname = 'bookings_payment_method_check') then
    alter table public.bookings add constraint bookings_payment_method_check
      check (payment_method is null or payment_method in ('cash', 'card', 'transfer'));
  end if;
end $$;

create index if not exists idx_bookings_payment_method
  on public.bookings (payment_method) where payment_method is not null;

-- ============================================================
-- Nail photos (photos_schema.sql)
-- ============================================================

create table if not exists public.client_photos (
  id            uuid primary key default gen_random_uuid(),
  client_id     uuid not null references public.clients(id) on delete restrict,
  booking_id    uuid references public.bookings(id) on delete set null,
  storage_path  text not null unique,   -- path inside the private bucket
  caption       text,
  created_at    timestamptz default now()
);

create index if not exists idx_client_photos_client
  on public.client_photos (client_id, created_at desc);

-- The bucket is PRIVATE: photos of identifiable people, read only through
-- short-lived signed URLs.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('client-photos', 'client-photos', false, 5242880, array['image/jpeg'])
on conflict (id) do update
  set public             = false,
      file_size_limit    = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- The pre-login policies: open to any role, scoped to this bucket, because the
-- Streamlit app uses the anon key. 20260924000300_security.sql replaces them.
-- Created only while that replacement has not happened, so re-running this
-- baseline after cutover can never reopen the bucket.
do $$ begin
  if not exists (select 1 from pg_policies
                 where schemaname = 'storage' and tablename = 'objects'
                   and policyname like 'client photos (staff):%') then
    drop policy if exists "client photos: read"   on storage.objects;
    drop policy if exists "client photos: insert" on storage.objects;
    drop policy if exists "client photos: delete" on storage.objects;
    create policy "client photos: read"   on storage.objects
      for select using (bucket_id = 'client-photos');
    create policy "client photos: insert" on storage.objects
      for insert with check (bucket_id = 'client-photos');
    create policy "client photos: delete" on storage.objects
      for delete using (bucket_id = 'client-photos');
  end if;
end $$;

-- ============================================================
-- Nightly snapshots (snapshot_backups.sql)
-- ============================================================
-- Not exposed by PostgREST (only public is). 35-day retention. Restore
-- recipes are in snapshot_backups.sql in the Streamlit repo.

create schema if not exists snapshots;

create table if not exists snapshots.rows (
  id           bigint generated always as identity primary key,
  captured_at  timestamptz not null default now(),
  batch_id     uuid not null,
  table_name   text not null,
  row_data     jsonb not null
);
create index if not exists idx_snapshots_captured on snapshots.rows (captured_at);
create index if not exists idx_snapshots_batch    on snapshots.rows (batch_id, table_name);

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
  foreach t in array array['clients','services','recurring_series','bookings','booking_services'] loop
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

-- 02:00 UTC = 04:00 in South Africa. pg_cron exists on Supabase but not on a
-- plain local Postgres, so the schedule is skipped (with a notice) where the
-- extension can't be had. cron.schedule upserts by job name.
do $$
begin
  begin
    create extension if not exists pg_cron;
  exception when others then
    raise notice 'pg_cron not available (%); nightly snapshot not scheduled', sqlerrm;
  end;
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.schedule('nightly-snapshot', '0 2 * * *', 'select snapshots.capture()');
  end if;
end $$;
