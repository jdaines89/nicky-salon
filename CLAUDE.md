# CLAUDE.md

Bookings, clients and takings for Nicky's Beauty & Nails, a one-chair nail
salon in Gqeberha (Rand pricing, Africa/Johannesburg). The owner uses it for
real, mostly one-handed on a phone between clients.

This replaces the Streamlit app in the private `jdaines89/nicky-beauty-nails`
repo. That repo's CLAUDE.md, USE_CASES.md and NICKY_GUIDE.md hold the history
behind every business rule; the rules themselves were ported here unchanged.

## Commands

```bash
npm install
cp .env.example .env.local   # Supabase URL + publishable key
npm run dev
npm test          # the salon's rules (money, loyalty, insights, payroll)
npm run typecheck
npm run db:test   # rebuilds the database from supabase/migrations on a local
                  # Postgres 16 and proves the access rules (PGHOST etc.)
```

UI check without a database: build with
`NEXT_PUBLIC_SUPABASE_URL=https://example.supabase.co NEXT_PUBLIC_SUPABASE_KEY=x npm run build`,
then `python scripts/ui_smoke.py out screenshots`. It fakes Supabase in the
browser with sample data, drives every page at 375px and 1280px, fails on
errors or sideways scroll on the phone, and screenshots each page. Read the
screenshots for the pages you touched.

## How it fits together

- **Static site.** `next.config.ts` exports plain HTML/JS; GitHub Pages serves
  it (`.github/workflows/pages.yml`, on every push to `main`). Nothing sleeps.
  A push to `main` is a production deploy: work on a branch, merge a PR.
- **Security is in the database.** The publishable key is public by design.
  Row-level security (`supabase/migrations/*_security.sql`) gives everything
  to invited staff (`public.staff`, filled only by Supabase's invite) and
  nothing to anyone else. There is no sign-up form. Never add a table without
  RLS and a staff policy, and extend `supabase/tests/10_rls_test.sql` with it.
- **Data:** `src/lib/db.ts` is the only file that reads or writes; pages use
  `useSalon()` from `src/components/data.tsx` (loads everything once, reloads
  after each write and when the tab regains focus). Every read pages past
  PostgREST's silent 1000-row cap via `fetchAll`.
- **Rules:** `src/lib/salon.ts`, `insights.ts`, `payroll.ts` are pure and
  fully tested. Key ones: revenue sums `bookingNet()` (services minus discount,
  tips never), only past *confirmed* bookings count for money and loyalty,
  loyalty is every 5th completed visit at 20%, collisions are true interval
  overlaps, "today" always comes from `todaySa()`, booking_services snapshot
  name and price so editing a service never rewrites past revenue.
- **Photos:** private `client-photos` bucket, signed URLs only, every image
  re-encoded in the browser (EXIF/GPS stripped) before upload.

## Supabase

Live project `nicky-beauty-nails` (ref afwezsbaccehhukrqowu). The dev project
is usually paused (free plan allows two active projects), which is why
`db:test` runs on a local Postgres instead.

The migrations are not yet applied to live. `..._baseline.sql` matches live
exactly; `..._staff_login.sql` is safe to apply any time; `..._security.sql`
switches RLS on and **breaks the Streamlit app** the moment it is applied, so
it goes on at cutover only, with the owner's go-ahead.
