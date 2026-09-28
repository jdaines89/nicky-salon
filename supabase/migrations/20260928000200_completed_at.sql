-- "Complete visit" (2026-09-28): when Nicky marks a visit done after the
-- service. Additive; the booking stays status 'confirmed', so every money and
-- loyalty rule is unchanged. Null = not marked complete (every older booking).
alter table public.bookings add column if not exists completed_at timestamptz;
