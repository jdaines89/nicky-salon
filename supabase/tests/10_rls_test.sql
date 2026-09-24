-- Behaviour tests for salon access: run after the migrations.
-- Every check raises on failure, so a clean run prints "ALL CHECKS PASSED".
\set ON_ERROR_STOP on

create function pg_temp.check(ok boolean, what text) returns void language plpgsql as
  $$ begin if not coalesce(ok, false) then raise exception 'FAILED: %', what; end if; raise notice 'ok: %', what; end $$;

-- null = not signed in (anon); otherwise signed in as that auth user.
create function pg_temp.as_user(uid text) returns void language plpgsql as $$
begin
  if uid is null then
    perform set_config('role', 'anon', false);
    perform set_config('request.jwt.claim.sub', '', false);
  else
    perform set_config('role', 'authenticated', false);
    perform set_config('request.jwt.claim.sub', uid, false);
  end if;
end $$;

-- A statement that must be refused outright (no privilege, or RLS check).
create function pg_temp.refused(stmt text, what text) returns void language plpgsql as $$
begin
  execute stmt;
  raise exception 'FAILED: %', what;
exception when insufficient_privilege then raise notice 'ok: %', what;
end $$;

-- ------------------------------------------------------------------
-- Schema: the baseline built everything live has
-- ------------------------------------------------------------------
select pg_temp.check((select count(*) from pg_tables where schemaname = 'public'
  and tablename in ('clients','services','recurring_series','bookings','booking_services','client_photos','staff')) = 7,
  'all seven public tables exist');
select pg_temp.check((select count(*) from pg_indexes where schemaname = 'public' and indexname in
  ('idx_bookings_date','idx_bookings_client','idx_bookings_series','idx_booking_services_booking',
   'idx_bookings_payment_method','idx_client_photos_client')) = 6, 'all six app indexes exist');
select pg_temp.check((select not public from storage.buckets where id = 'client-photos'), 'photos bucket exists and is private');
do $$ begin
  insert into public.bookings (date, time, payment_method) values (current_date, '10:00', 'cheque');
  raise exception 'FAILED: bad payment_method accepted';
exception when check_violation then raise notice 'ok: payment_method only takes cash/card/transfer';
end $$;

-- ------------------------------------------------------------------
-- Accounts: two ways of being invited, one stranger
-- ------------------------------------------------------------------
-- Nicky: invite row arrives with invited_at already set.
insert into auth.users (id, email, invited_at) values
  ('00000000-0000-0000-0000-00000000000a', 'nicky@example.com', now());
-- Helper: invited the way Supabase actually does it, row first, invited_at a moment later.
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-00000000000b', 'helper@example.com');
update auth.users set invited_at = now() where id = '00000000-0000-0000-0000-00000000000b';
-- Stranger: signed up without an invite, then changes their details.
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000ff', 'stranger@example.com');
update auth.users set email = 'stranger2@example.com', raw_user_meta_data = '{"x":1}'
  where id = '00000000-0000-0000-0000-0000000000ff';

select pg_temp.check((select count(*) from public.staff) = 2, 'both invited accounts are staff (insert and invite-update paths)');
select pg_temp.check(not exists (select 1 from public.staff where user_id = '00000000-0000-0000-0000-0000000000ff'),
  'a signed-up, never-invited user is not staff');

-- Some salon data, made as the owner (postgres), as the migration would find it.
insert into public.clients (id, name, phone) values ('11111111-1111-1111-1111-111111111111', 'Thandi M', '0821234567');
insert into public.services (id, category, name, price, duration_minutes)
  values ('22222222-2222-2222-2222-222222222222', 'Gel Overlays', 'Gel overlay', 300, 60);
insert into public.bookings (id, client_id, date, time, duration_minutes)
  values ('33333333-3333-3333-3333-333333333333', '11111111-1111-1111-1111-111111111111', current_date, '10:00', 60);
insert into public.booking_services (booking_id, service_id, service_name, price_at_time)
  values ('33333333-3333-3333-3333-333333333333', '22222222-2222-2222-2222-222222222222', 'Gel overlay', 300);
insert into storage.objects (bucket_id, name) values ('client-photos', 'existing.jpg');

-- ------------------------------------------------------------------
-- Not signed in: sees nothing, writes nothing
-- ------------------------------------------------------------------
select pg_temp.as_user(null);
select pg_temp.refused('select 1 from public.clients',          'anon cannot read clients');
select pg_temp.refused('select 1 from public.bookings',         'anon cannot read bookings');
select pg_temp.refused('select 1 from public.booking_services', 'anon cannot read booking_services');
select pg_temp.refused('select 1 from public.services',         'anon cannot read services');
select pg_temp.refused('select 1 from public.recurring_series', 'anon cannot read recurring_series');
select pg_temp.refused('select 1 from public.client_photos',    'anon cannot read client_photos');
select pg_temp.refused('select 1 from public.staff',            'anon cannot read staff');
select pg_temp.refused($$insert into public.clients (name) values ('Anon')$$, 'anon cannot add a client');
select pg_temp.refused($$update public.bookings set tip = 50$$,             'anon cannot change a booking');
select pg_temp.refused($$delete from public.bookings$$,                      'anon cannot delete bookings');
select pg_temp.refused($$truncate public.bookings cascade$$,                 'anon cannot truncate bookings');
select pg_temp.refused($$insert into public.staff (user_id) values ('00000000-0000-0000-0000-0000000000ff')$$,
  'anon cannot add anyone to staff');
select pg_temp.refused('select 1 from snapshots.rows',       'anon cannot read snapshots');
select pg_temp.refused('select snapshots.capture()',         'anon cannot run snapshots.capture()');
select pg_temp.refused('select public.is_staff()',           'anon cannot call is_staff()');
select pg_temp.check((select count(*) from storage.objects where bucket_id = 'client-photos') = 0, 'anon sees no photos');
select pg_temp.refused($$insert into storage.objects (bucket_id, name) values ('client-photos', 'anon.jpg')$$,
  'anon cannot upload a photo');
delete from storage.objects where bucket_id = 'client-photos';
reset role;
select pg_temp.check((select count(*) from storage.objects) = 1, 'anon could not delete a photo');

-- ------------------------------------------------------------------
-- Signed in, never invited: sees nothing, writes nothing
-- ------------------------------------------------------------------
select pg_temp.as_user('00000000-0000-0000-0000-0000000000ff');
select pg_temp.check(not public.is_staff(), 'stranger is_staff() is false');
select pg_temp.check((select count(*) from public.clients) = 0,          'stranger sees no clients');
select pg_temp.check((select count(*) from public.bookings) = 0,         'stranger sees no bookings');
select pg_temp.check((select count(*) from public.booking_services) = 0, 'stranger sees no booking services');
select pg_temp.check((select count(*) from public.services) = 0,         'stranger sees no services');
select pg_temp.check((select count(*) from public.staff) = 0,            'stranger sees no staff list');
select pg_temp.check((select count(*) from storage.objects) = 0,         'stranger sees no photos');
select pg_temp.refused($$insert into public.clients (name) values ('Gatecrasher')$$, 'stranger cannot add a client');
select pg_temp.refused($$insert into public.bookings (date, time) values (current_date, '12:00')$$, 'stranger cannot add a booking');
select pg_temp.refused($$insert into public.staff (user_id, email) values ('00000000-0000-0000-0000-0000000000ff', 'me')$$,
  'stranger cannot make themselves staff');
select pg_temp.refused($$truncate public.booking_services$$, 'stranger cannot truncate (RLS does not cover truncate)');
select pg_temp.refused($$insert into storage.objects (bucket_id, name) values ('client-photos', 'x.jpg')$$,
  'stranger cannot upload a photo');
select pg_temp.refused('select 1 from snapshots.rows',       'stranger cannot read snapshots');
select pg_temp.refused('select snapshots.capture()',         'stranger cannot run snapshots.capture()');
update public.bookings set tip = 999;       -- sees no rows, so changes none
delete from public.clients;
delete from storage.objects;
reset role;
select pg_temp.check((select tip from public.bookings where id = '33333333-3333-3333-3333-333333333333') = 0,
  'stranger could not change a booking');
select pg_temp.check((select count(*) from public.clients) = 1, 'stranger could not delete a client');
select pg_temp.check((select count(*) from storage.objects) = 1, 'stranger could not delete a photo');

-- ------------------------------------------------------------------
-- Invited staff: everything the app does
-- ------------------------------------------------------------------
select pg_temp.as_user('00000000-0000-0000-0000-00000000000a');
select pg_temp.check(public.is_staff(), 'Nicky is_staff() is true');
select pg_temp.check((select count(*) from public.clients) = 1,  'staff sees clients');
select pg_temp.check((select count(*) from public.bookings) = 1, 'staff sees bookings');
select pg_temp.check((select count(*) from public.staff) = 2,    'staff sees the staff list');
insert into public.clients (id, name, phone) values ('44444444-4444-4444-4444-444444444444', 'Lerato K', '0831234567');
update public.clients set shade = 'Nude pink' where id = '44444444-4444-4444-4444-444444444444';
insert into public.services (category, name, price) values ('Waxing', 'Brow wax', 90);
update public.services set active = false where name = 'Brow wax';
insert into public.recurring_series (id, client_id, freq_days, start_date, end_type, end_count)
  values ('55555555-5555-5555-5555-555555555555', '44444444-4444-4444-4444-444444444444', 14, current_date, 'count', 4);
insert into public.bookings (id, client_id, series_id, date, time, payment_method)
  values ('66666666-6666-6666-6666-666666666666', '44444444-4444-4444-4444-444444444444',
          '55555555-5555-5555-5555-555555555555', current_date + 1, '14:00', 'card');
insert into public.booking_services (booking_id, service_id, service_name, price_at_time)
  values ('66666666-6666-6666-6666-666666666666', '22222222-2222-2222-2222-222222222222', 'Gel overlay', 300);
update public.bookings set status = 'no-show', tip = 20 where id = '33333333-3333-3333-3333-333333333333';
insert into public.client_photos (client_id, booking_id, storage_path)
  values ('44444444-4444-4444-4444-444444444444', '66666666-6666-6666-6666-666666666666', 'lerato/1.jpg');
insert into storage.objects (bucket_id, name) values ('client-photos', 'lerato/1.jpg');
select pg_temp.check((select count(*) from storage.objects) = 2, 'staff sees and uploads photos');
select pg_temp.check((select count(*) from public.bookings) = 2 and (select count(*) from public.booking_services) = 2,
  'staff added a booking with its services');
select pg_temp.check((select status from public.bookings where id = '33333333-3333-3333-3333-333333333333') = 'no-show',
  'staff changed a booking');
delete from storage.objects where name = 'lerato/1.jpg';
delete from public.client_photos where storage_path = 'lerato/1.jpg';
delete from public.bookings where id = '66666666-6666-6666-6666-666666666666';   -- cascades its services
delete from public.recurring_series where id = '55555555-5555-5555-5555-555555555555';
delete from public.clients where id = '44444444-4444-4444-4444-444444444444';
select pg_temp.check((select count(*) from public.bookings) = 1 and (select count(*) from public.booking_services) = 1
  and (select count(*) from public.clients) = 1 and (select count(*) from storage.objects) = 1,
  'staff deleted a photo, booking (and its services), series and client');
select pg_temp.refused($$insert into public.staff (user_id, email) values ('00000000-0000-0000-0000-0000000000ff', 'x')$$,
  'staff cannot add staff by hand (invites only)');
select pg_temp.refused($$delete from public.staff$$, 'staff cannot remove staff');
select pg_temp.refused('select 1 from snapshots.rows', 'staff cannot read snapshots through the API');
reset role;

-- The helper (invited via the update path) has the same access.
select pg_temp.as_user('00000000-0000-0000-0000-00000000000b');
select pg_temp.check((select count(*) from public.clients) = 1, 'invite-update staff sees clients');
insert into public.clients (name) values ('Walk-in');
select pg_temp.check((select count(*) from public.clients) = 2, 'invite-update staff adds a client');
reset role;

-- ------------------------------------------------------------------
-- Policies and backups
-- ------------------------------------------------------------------
select pg_temp.check((select count(*) from pg_policies where schemaname = 'storage'
  and policyname like 'client photos:%') = 0, 'the open photo policies are gone (even after re-running the baseline)');
select pg_temp.check((select count(*) from pg_policies where schemaname = 'storage'
  and policyname like 'client photos (staff):%' and roles = '{authenticated}') = 3, 'three staff-only photo policies');
select pg_temp.check((select bool_and(relrowsecurity and relforcerowsecurity) from pg_class
  where oid in ('public.clients'::regclass, 'public.services'::regclass, 'public.recurring_series'::regclass,
                'public.bookings'::regclass, 'public.booking_services'::regclass,
                'public.client_photos'::regclass, 'public.staff'::regclass)), 'RLS enabled and forced on all seven tables');
select pg_temp.check(snapshots.capture() like 'captured 6 rows%', 'nightly snapshot still captures every salon row');

-- Deleting an auth account removes its staff row.
delete from auth.users where id = '00000000-0000-0000-0000-00000000000b';
select pg_temp.check((select count(*) from public.staff) = 1, 'deleting an account removes it from staff');

\echo ALL CHECKS PASSED
