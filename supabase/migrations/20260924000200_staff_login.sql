-- Who may use the salon app: invite-only staff.
--
-- Sending an invite from Supabase (Authentication > Users > Invite user)
-- creates the auth account, and a trigger makes it a staff member. Anyone who
-- manages to sign up without an invite gets an account and nothing else:
-- being signed in is not enough, the account must be in public.staff.
-- Public sign-up should also be switched off in the dashboard; this is the
-- second lock, not the only one.
--
-- Additive and harmless to the running Streamlit app: it adds a table, two
-- triggers on auth.users and two functions, and touches no salon table, so it
-- can be applied ahead of cutover (and staff invited ahead of it).

create table if not exists public.staff (
  user_id    uuid primary key references auth.users(id) on delete cascade,
  email      text,
  created_at timestamptz not null default now()
);

-- Locked from the moment it exists, not only from cutover: this migration may
-- go in while the Streamlit app still runs on the anon key, and a staff table
-- that key could write to would let anyone add themselves ahead of cutover.
-- Only the invite trigger (security definer) and the service role write here.
alter table public.staff enable row level security;
alter table public.staff force row level security;
revoke all on public.staff from anon, public;
revoke insert, update, delete, truncate, references, trigger on public.staff from authenticated;
grant select on public.staff to authenticated;

create or replace function public.handle_new_staff()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.invited_at is null then
    return new;   -- signed up, not invited: no access
  end if;
  insert into public.staff (user_id, email)
  values (new.id, new.email)
  on conflict (user_id) do nothing;
  return new;
end;
$$;

-- Both triggers are needed. Supabase's invite inserts the auth.users row and
-- stamps invited_at in a separate update a moment later, so an insert
-- trigger alone sees invited_at null and makes nobody staff (learned the hard
-- way in scrumline, 20260923000800_member_on_invite_update.sql).
drop trigger if exists on_auth_user_created_staff on auth.users;
create trigger on_auth_user_created_staff
  after insert on auth.users
  for each row execute function public.handle_new_staff();

drop trigger if exists on_auth_user_invited_staff on auth.users;
create trigger on_auth_user_invited_staff
  after update of invited_at on auth.users
  for each row
  when (old.invited_at is null and new.invited_at is not null)
  execute function public.handle_new_staff();

-- Anyone invited before these triggers existed.
insert into public.staff (user_id, email)
select u.id, u.email
from auth.users u
where u.invited_at is not null
on conflict (user_id) do nothing;

-- The one question every policy asks. Security definer so it can read
-- public.staff whatever that table's own policies say; stable so Postgres
-- evaluates it once per statement, not once per row.
create or replace function public.is_staff()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.staff where user_id = auth.uid())
$$;

-- Staff can see who else is staff; nobody else sees anything.
drop policy if exists "staff read staff" on public.staff;
create policy "staff read staff" on public.staff
  for select to authenticated using (public.is_staff());

revoke execute on function public.handle_new_staff() from public, anon, authenticated;
revoke execute on function public.is_staff() from public, anon;
grant  execute on function public.is_staff() to authenticated;
