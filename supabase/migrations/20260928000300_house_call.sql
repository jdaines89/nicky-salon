-- House calls (2026-09-28): a booking done at the client's home.
-- Additive; every existing booking reads false, which is what they were.
alter table public.bookings add column if not exists house_call boolean not null default false;
comment on column public.bookings.house_call is 'Done at the client''s home rather than at the salon.';
