"use client";

import type { ReactNode } from "react";

export interface BarRow {
  key: string;
  label: ReactNode;
  /** 0..1 share of the longest bar. */
  frac: number;
  text: ReactNode;
  muted?: boolean;
}

/**
 * Label on top, bar underneath, figure beside it: reads at 375px without the
 * label and the bar fighting for width, and never scrolls sideways.
 */
export function ReportsBarList({ rows }: { rows: BarRow[] }) {
  return (
    <div className="stack" style={{ gap: 10 }}>
      {rows.map((r) => (
        <div key={r.key}>
          <div className="row" style={{ flexWrap: "nowrap", gap: 8, alignItems: "baseline" }}>
            <span className="grow" style={{ fontWeight: 600, fontSize: 14, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {r.label}
            </span>
            <span className="small muted" style={{ fontVariantNumeric: "tabular-nums", textAlign: "right" }}>{r.text}</span>
          </div>
          <div className="bar" style={{ marginTop: 4 }}>
            <span style={{ width: `${Math.max(0, Math.min(1, r.frac)) * 100}%`, background: r.muted ? "var(--line)" : undefined }} />
          </div>
        </div>
      ))}
    </div>
  );
}

/** Vertical columns for a short series (a handful of weeks). Value printed above each column. */
export function ReportsColumns({ points, format, highlight }: {
  points: { key: string; label: string; value: number }[];
  format: (v: number) => string;
  highlight?: string;
}) {
  const max = Math.max(1, ...points.map((p) => p.value));
  return (
    <div role="img" aria-label={points.map((p) => `${p.label}: ${format(p.value)}`).join(", ")}
      style={{ display: "grid", gridTemplateColumns: `repeat(${points.length}, minmax(0, 1fr))`, gap: 8, alignItems: "end", height: 170 }}>
      {points.map((p) => (
        <div key={p.key} style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "flex-end", height: "100%", minWidth: 0 }}>
          <span style={{ fontSize: 11.5, fontVariantNumeric: "tabular-nums", color: "var(--ink-soft)", whiteSpace: "nowrap" }}>{format(p.value)}</span>
          <div style={{
            width: "100%", maxWidth: 48, marginTop: 4, borderRadius: "6px 6px 0 0",
            height: `${(p.value / max) * 120}px`, minHeight: p.value ? 3 : 1,
            background: p.key === highlight ? "var(--teal)" : "var(--gold)",
          }} />
          <span style={{ fontSize: 11.5, marginTop: 4, whiteSpace: "nowrap", fontWeight: p.key === highlight ? 700 : 400 }}>{p.label}</span>
        </div>
      ))}
    </div>
  );
}
