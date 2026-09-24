# Nicky — Beauty & Nails

Bookings, clients and takings for a one-chair nail salon in Gqeberha.

- **App:** Next.js (React, TypeScript), exported as a static site and served
  from GitHub Pages, so it loads instantly and never sleeps.
- **Data:** Supabase (Postgres, Auth, Storage). Sign-in is invite-only, and
  row-level security in the database keeps every client record private: the
  site shows nothing to anyone who isn't signed in with an invited account.

This replaces an earlier Streamlit version of the same app.
