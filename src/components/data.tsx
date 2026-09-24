"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { loadAll, type SalonData } from "@/lib/db";
import { todaySa } from "@/lib/salon";
import type { Client } from "@/lib/types";

interface Ctx extends SalonData {
  today: string;
  clientById: Map<string, Client>;
  /** Re-read everything after a write. Cheap: a salon's data is small. */
  reload: () => Promise<void>;
}

const DataCtx = createContext<Ctx | null>(null);

/** Loads the salon's data once after sign-in; every page reads from here. */
export function DataProvider({ children }: { children: ReactNode }) {
  const [data, setData] = useState<SalonData | null>(null);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    try {
      setData(await loadAll());
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, []);

  useEffect(() => {
    reload();
    // Coming back to the tab (phone out of the apron) refreshes, so a booking
    // made on the tablet shows up on the phone without a manual reload.
    const onVisible = () => { if (document.visibilityState === "visible") reload(); };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [reload]);

  const value = useMemo<Ctx | null>(() => data && {
    ...data,
    today: todaySa(),
    clientById: new Map(data.clients.map((c) => [c.id, c])),
    reload,
  }, [data, reload]);

  if (error && !data) {
    return (
      <div className="card narrow">
        <h2>Couldn&apos;t load the salon&apos;s data</h2>
        <p className="sub">{error}</p>
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
