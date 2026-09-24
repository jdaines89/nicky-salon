-- ##########################################################################
-- ##  CUTOVER ONLY.  Applying this migration WILL BREAK the Streamlit app.  ##
-- ##########################################################################
--
-- The live Streamlit app (nicky-beauty-nails.streamlit.app) talks to
-- Supabase with the anon key and no login. The moment this runs, the anon key
-- can read and write nothing: every page of that app shows an empty salon and
-- every save fails. Apply it only at cutover, in the same sitting as
-- switching Nicky to the React site, after:
--   1. 20260924000200_staff_login.sql is applied and Nicky's account has been
--      invited and has signed in once (select * from public.staff shows her);
--   2. public sign-up is switched off (Authentication > Sign In / Providers);
--   3. a fresh backup: python backup_export.py in the Streamlit repo.
-- Rolling back is disabling RLS on the six salon tables and restoring the
-- three open "client photos: ..." storage policies from the baseline.
--
-- Who can do what afterwards:
--   Not signed in (anon, the publishable key alone): nothing at all.
--   Signed in, not staff (never invited):            nothing at all.
--   Staff (invited):                                 everything the app does
--       today: read, add, change and delete on every salon table and in the
--       client-photos bucket. It is a one-chair salon; there are no roles.
--   Service role:                                    everything (bypasses RLS).
--   snapshots schema:                                no API role at all; only
--       the nightly pg_cron job (as postgres) and the SQL editor.

-- ============================================================
-- Salon tables
-- ============================================================

do $$
declare t text;
begin
  foreach t in array array['clients','services','recurring_series','bookings',
                           'booking_services','client_photos']
  loop
    execute format('alter table public.%I enable row level security', t);
    execute format('alter table public.%I force row level security', t);
    execute format('revoke all on public.%I from anon, public', t);
    -- RLS never applies to TRUNCATE, and REFERENCES/TRIGGER are not things
    -- the app does, so a signed-in stranger must not hold them either.
    execute format('revoke truncate, references, trigger on public.%I from authenticated', t);
    execute format('grant select, insert, update, delete on public.%I to authenticated', t);
    execute format('drop policy if exists "staff full access" on public.%I', t);
    execute format('create policy "staff full access" on public.%I for all to authenticated '
                   'using (public.is_staff()) with check (public.is_staff())', t);
  end loop;
end $$;

-- ============================================================
-- Staff table (also locked in 20260924000200; restated so this file alone
-- says everything about access)
-- ============================================================

alter table public.staff enable row level security;
alter table public.staff force row level security;
revoke all on public.staff from anon, public;
revoke insert, update, delete, truncate, references, trigger on public.staff from authenticated;
grant select on public.staff to authenticated;
drop policy if exists "staff read staff" on public.staff;
create policy "staff read staff" on public.staff
  for select to authenticated using (public.is_staff());

revoke execute on function public.handle_new_staff() from public, anon, authenticated;
revoke execute on function public.is_staff() from public, anon;
grant  execute on function public.is_staff() to authenticated;

-- ============================================================
-- Photos bucket: staff only
-- ============================================================
-- The bucket stays private (signed URLs); these replace the three open
-- policies, which let any role, anon included, read, upload and delete.

drop policy if exists "client photos: read"   on storage.objects;
drop policy if exists "client photos: insert" on storage.objects;
drop policy if exists "client photos: delete" on storage.objects;

drop policy if exists "client photos (staff): read"   on storage.objects;
drop policy if exists "client photos (staff): insert" on storage.objects;
drop policy if exists "client photos (staff): delete" on storage.objects;

create policy "client photos (staff): read" on storage.objects
  for select to authenticated
  using (bucket_id = 'client-photos' and public.is_staff());
create policy "client photos (staff): insert" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'client-photos' and public.is_staff());
create policy "client photos (staff): delete" on storage.objects
  for delete to authenticated
  using (bucket_id = 'client-photos' and public.is_staff());

-- ============================================================
-- Snapshots: unreachable from the API
-- ============================================================
-- PostgREST doesn't expose the schema, and the API roles have no usage on it,
-- but capture() was executable by PUBLIC (the Postgres default for any new
-- function). Close all of it explicitly rather than rely on exposure settings.

revoke all on schema snapshots from public, anon, authenticated;
revoke all on all tables    in schema snapshots from public, anon, authenticated;
revoke all on all sequences in schema snapshots from public, anon, authenticated;
revoke execute on function snapshots.capture() from public, anon, authenticated;
-- RLS with no policies: a belt to the braces above. capture() runs as its
-- owner (postgres, which bypasses RLS on Supabase), so backups carry on.
alter table snapshots.rows enable row level security;

-- ============================================================
-- Tables added later
-- ============================================================
-- Supabase grants every API role full rights on each new public table by
-- default, so a table created in a later migration would be open to the
-- publishable key until someone remembered RLS. Stop granting anon anything
-- by default; a new table must still enable RLS and add a staff policy.
alter default privileges in schema public revoke all on tables    from anon;
alter default privileges in schema public revoke all on sequences from anon;
alter default privileges in schema public revoke execute on functions from anon;
