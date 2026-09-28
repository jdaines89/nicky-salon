"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { loadAll, type SalonData } from "@/lib/db";
import { supabase } from "@/lib/supabase";
import { lockAsBooking, todaySa } from "@/lib/salon";
import type { BookingWithServices, Client } from "@/lib/types";

interface Ctx extends SalonData {
  today: string;
  clientById: Map<string, Client>;
  /**
   * Bookings plus blocked-out time, for the free-time maths only (clashes,
   * gaps, offered times). Never for money, visits or counts.
   */
  busy: BookingWithServices[];
  /** Re-read everything after a write. Cheap: a salon's data is small. */
  reload: () => Promise<void>;
}

const DataCtx = createContext<Ctx | null>(null);
const REFRESH_AFTER_MS = 60_000;

/** Loads the salon's data once after sign-in; every page reads from here. */
export function DataProvider({ children }: { children: ReactNode }) {
  const [data, setData] = useState<SalonData | null>(null);
  const [error, setError] = useState<string | null>(null);

  const loadedAt = useRef(0);
  const reload = useCallback(async () => {
    loadedAt.current = Date.now();
    try {
      setData(await loadAll());
      setError(null);
    } catch {
      // Opening the app after a while, the sign-in token is renewed at the same
      // moment the first reads go out, and one of them can be refused. Let the
      // renewal finish and ask once more before bothering her with an error.
      try {
        await new Promise((r) => setTimeout(r, 700));
        await supabase.auth.getSession();
        setData(await loadAll());
        setError(null);
      } catch (e2) {
        setError(e2 instanceof Error ? e2.message : String(e2));
      }
    }
  }, []);

  useEffect(() => {
    reload();
    // Coming back to the tab (phone out of the apron) refreshes, so a booking
    // made on the tablet shows up on the phone without a manual reload. Not
    // more than once a minute: she flicks between WhatsApp and the app all
    // day, and each refresh re-reads the whole book over mobile data.
    const onVisible = () => {
      if (document.visibilityState === "visible" && Date.now() - loadedAt.current > REFRESH_AFTER_MS) reload();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [reload]);

  const value = useMemo<Ctx | null>(() => data && {
    ...data,
    today: todaySa(),
    clientById: new Map(data.clients.map((c) => [c.id, c])),
    busy: [...data.bookings, ...data.locks.map(lockAsBooking)],
    reload,
  }, [data, reload]);

  if (error && !data) {
    return (
      <div className="card narrow">
        <h2>Couldn&apos;t load the salon&apos;s data</h2>
        <p className="sub">Check the phone has signal, then try again. Nothing you saved is lost.</p>
        <p className="small muted">{error}</p>
        <button onClick={reload}>Try again</button>
      </div>
    );
  }
  if (!value) return <p className="loading">Loading your book&hellip;</p>;
  return <DataCtx.Provider value={value}>{children}</DataCtx.Provider>;
}

export function useSalon(): Ctx {
  const v = useContext(DataCtx);
  if (!v) throw new Error("useSalon outside DataProvider");
  return v;
}
