"use client";

import { useMemo, useState } from "react";
import { rand } from "@/components/ui";
import { firstVisitMap, isFirstVisit, PACKAGE_CATEGORY, toMinutes, validPhone } from "@/lib/salon";
import type { BookingWithServices, Client, Service } from "@/lib/types";

// ---------------------------------------------------------------------------
// Status colours and labels (same palette as the Streamlit calendar)
// ---------------------------------------------------------------------------

export const STATUS_COLOR: Record<string, string> = {
  confirmed: "#1B5E59", pending: "#B78B4E", cancelled: "#7C8783", "no-show": "#7A3B3B", new: "#A2603A",
};

export type FvMap = Map<string | null, string>;

/** A client's very first booking reads "New Client" everywhere, unless it was cancelled or a no-show. */
export function bookingLook(b: BookingWithServices, fv: FvMap): { color: string; label: string; badge: string } {
  if (b.status === "cancelled") return { color: STATUS_COLOR.cancelled, label: "Cancelled", badge: "muted" };
  if (b.status === "no-show") return { color: STATUS_COLOR["no-show"], label: "No-Show", badge: "danger" };
  if (isFirstVisit(b, fv)) return { color: STATUS_COLOR.new, label: "New Client", badge: "bk-new" };
  if (b.status === "confirmed") return { color: STATUS_COLOR.confirmed, label: "Confirmed", badge: "" };
  return { color: STATUS_COLOR.pending, label: "Pending", badge: "gold" };
}

export function useFirstVisits(clients: Client[], bookings: BookingWithServices[]): FvMap {
  return useMemo(() => firstVisitMap(clients, bookings), [clients, bookings]);
}

export function StatusLegend() {
  return (
    <div className="bk-legend">
      <span><i style={{ background: STATUS_COLOR.confirmed }} />Confirmed</span>
      <span><i style={{ background: STATUS_COLOR.pending }} />Pending</span>
      <span><i style={{ background: STATUS_COLOR.new }} />New Client</span>
      <span><i style={{ background: STATUS_COLOR.cancelled }} />Cancelled</span>
    </div>
  );
}

export const hhmm = (min: number) => `${String(Math.floor(min / 60)).padStart(2, "0")}:${String(min % 60).padStart(2, "0")}`;

export function freeText(mins: number): string {
  if (mins < 60) return `${mins}m`;
  return `${Math.floor(mins / 60)}h${mins % 60 ? ` ${mins % 60}m` : ""}`;
}

export function endTime(b: { time: string; duration_minutes?: number | null }): string {
  return hhmm(toMinutes(b.time) + (b.duration_minutes || 30));
}

// ---------------------------------------------------------------------------
// Service options: packages float to the top with a 📦 label (the snapshotted
// service_name stays clean); new bookings default to the first regular one.
// ---------------------------------------------------------------------------

export interface SvcOpt { id: string; name: string; price: number; duration: number; category: string; pkg: boolean }

export function serviceOptions(services: Service[]): SvcOpt[] {
  const opts = services
    .filter((s) => s.active !== false)
    .map((s) => ({ id: s.id, name: s.name, price: Number(s.price), duration: s.duration_minutes, category: s.category, pkg: s.category === PACKAGE_CATEGORY }));
  // Stable sort: packages first, everything else keeps category/name order.
  return opts.map((o, i) => [o, i] as const).sort(([a, ia], [b, ib]) => (a.pkg === b.pkg ? ia - ib : a.pkg ? -1 : 1)).map(([o]) => o);
}

export function optLabel(o: SvcOpt): string {
  return `${o.pkg ? "📦 " : ""}${o.name} — R${Math.round(o.price)} · ${o.duration} min`;
}

export function defaultServiceIds(opts: SvcOpt[]): string[] {
  const first = opts.find((o) => !o.pkg) ?? opts[0];
  return first ? [first.id] : [];
}

/** One chosen service line. Existing lines keep their snapshotted name and price. */
export interface Line { key: string; service_id: string | null; name: string; price: number; duration: number; pkg: boolean }

export function lineFromOpt(o: SvcOpt): Line {
  return { key: `${o.id}-${Math.random().toString(36).slice(2, 7)}`, service_id: o.id, name: o.name, price: o.price, duration: o.duration, pkg: o.pkg };
}

export function ServicePicker({ opts, lines, onChange }: { opts: SvcOpt[]; lines: Line[]; onChange: (l: Line[]) => void }) {
  const chosenIds = new Set(lines.map((l) => l.service_id));
  const remaining = opts.filter((o) => !chosenIds.has(o.id));
  const groups: [string, SvcOpt[]][] = [];
  for (const o of remaining) {
    const g = o.pkg ? "📦 Packages" : o.category;
    const last = groups[groups.length - 1];
    if (last && last[0] === g) last[1].push(o);
    else groups.push([g, [o]]);
  }
  return (
    <div className="stack" style={{ gap: 6 }}>
      <span className="bk-label">Services</span>
      {!lines.length && <p className="small muted" style={{ margin: 0 }}>No services added yet. Add one below.</p>}
      {lines.map((l) => (
        <div key={l.key} className="bk-line">
          <div className="grow">
            <div style={{ fontWeight: 600 }}>{l.pkg ? "📦 " : ""}{l.name}</div>
            <div className="small muted">{rand(l.price)}{l.duration ? ` · ${l.duration} min` : ""}</div>
          </div>
          <button type="button" className="ghost" aria-label={`Remove ${l.name}`}
            onClick={() => onChange(lines.filter((x) => x.key !== l.key))}>✕</button>
        </div>
      ))}
      <select value="" aria-label="Add a service" onChange={(e) => {
        const o = opts.find((x) => x.id === e.target.value);
        if (o) onChange([...lines, lineFromOpt(o)]);
      }}>
        <option value="">＋ Add a service…</option>
        {groups.map(([g, items]) => (
          <optgroup key={g} label={g}>
            {items.map((o) => <option key={o.id} value={o.id}>{optLabel(o)}</option>)}
          </optgroup>
        ))}
      </select>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Client picker: search an existing client, or add a new one inline. A real
// pick rather than free text, so a typo can't silently create a duplicate.
// ---------------------------------------------------------------------------

export type ClientChoice =
  | { kind: "none" }
  | { kind: "existing"; id: string }
  | { kind: "new"; name: string; phone: string };

export function findClientByName(clients: Client[], name: string): Client | null {
  const n = name.trim().toLowerCase();
  if (!n) return null;
  return clients.find((c) => c.name.trim().toLowerCase() === n) ?? null;
}

/** The existing client this choice means: a typed "new" name that matches someone already on file is her. */
export function resolveClient(choice: ClientChoice, clients: Client[], byId: Map<string, Client>): Client | null {
  if (choice.kind === "existing") return byId.get(choice.id) ?? null;
  if (choice.kind === "new") return findClientByName(clients, choice.name);
  return null;
}

export function phoneProblem(choice: ClientChoice): string | null {
  if (choice.kind !== "new") return null;
  const p = choice.phone.trim();
  if (p && !validPhone(p)) return "Enter a valid 10-digit phone number (e.g. 0821234567), or leave it blank.";
  return null;
}

export function ClientPicker({ clients, byId, value, onChange }: {
  clients: Client[]; byId: Map<string, Client>; value: ClientChoice; onChange: (c: ClientChoice) => void;
}) {
  const [q, setQ] = useState("");
  if (value.kind === "existing") {
    const c = byId.get(value.id);
    return (
      <div className="stack" style={{ gap: 6 }}>
        <span className="bk-label">Client</span>
        <div className="bk-line">
          <span className="avatar">{(c?.name || "?").trim().charAt(0).toUpperCase()}</span>
          <div className="grow">
            <div style={{ fontWeight: 600 }}>{c?.name ?? "Unknown client"}</div>
            {c?.phone && <div className="small muted">{c.phone}</div>}
          </div>
          <button type="button" className="ghost" onClick={() => { setQ(""); onChange({ kind: "none" }); }}>Change</button>
        </div>
      </div>
    );
  }
  if (value.kind === "new") {
    const match = findClientByName(clients, value.name);
    const bad = phoneProblem(value);
    return (
      <div className="stack" style={{ gap: 8 }}>
        <div className="row"><span className="bk-label grow">New client</span>
          <button type="button" className="linkish" onClick={() => onChange({ kind: "none" })}>Pick an existing client instead</button>
        </div>
        <label className="field">Name
          <input value={value.name} placeholder="Full name…" autoComplete="off"
            onChange={(e) => onChange({ ...value, name: e.target.value })} />
        </label>
        {match && <p className="small" style={{ margin: 0 }}>{match.name} is already on file, so this booking will go on her existing record.</p>}
        {!match && (
          <label className="field">Phone
            <input value={value.phone} inputMode="tel" placeholder="0821234567" autoComplete="off"
              onChange={(e) => onChange({ ...value, phone: e.target.value })} />
            <span className="small muted" style={{ fontWeight: 400 }}>Optional, but handy for the Recall List and birthday reminders.</span>
          </label>
        )}
        {!match && bad && <div className="notice danger" style={{ margin: 0 }}>{bad}</div>}
      </div>
    );
  }
  const needle = q.trim().toLowerCase();
  const matches = needle ? clients.filter((c) => c.name.toLowerCase().includes(needle) || (c.phone || "").replace(/\D/g, "").includes(needle.replace(/\D/g, "") || "§")).slice(0, 6) : [];
  return (
    <div className="stack" style={{ gap: 6 }}>
      <span className="bk-label">Client</span>
      <input value={q} placeholder="Search by name or number…" autoComplete="off" aria-label="Search clients"
        onChange={(e) => setQ(e.target.value)} />
      {matches.length > 0 && (
        <div className="list bk-picklist">
          {matches.map((c) => (
            <button type="button" key={c.id} className="item" onClick={() => onChange({ kind: "existing", id: c.id })}>
              <span className="avatar">{c.name.trim().charAt(0).toUpperCase()}</span>
              <div className="grow"><div className="title">{c.name}</div>{c.phone && <div className="meta">{c.phone}</div>}</div>
            </button>
          ))}
        </div>
      )}
      {needle && !matches.length && <p className="small muted" style={{ margin: 0 }}>No client called that yet.</p>}
      <button type="button" className="ghost" onClick={() => onChange({ kind: "new", name: q.trim(), phone: "" })}>
        ＋ {q.trim() && !matches.some((c) => c.name.toLowerCase() === needle) ? `Add “${q.trim()}” as a new client` : "New client"}
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Page-local styles. Shared globals.css stays untouched; everything here is
// prefixed bk- so it can't leak into other screens.
// ---------------------------------------------------------------------------

export const BOOKINGS_CSS = `
.list.bk-rows > .item { flex-wrap: nowrap; }
.list.bk-rows > .item > .grow { flex: 1 1 auto; }
.bk-label { font-size: 13px; font-weight: 600; color: var(--ink-soft); }
.bk-line { display: flex; align-items: center; gap: 10px; background: var(--card); border: 1px solid var(--line); border-radius: 10px; padding: 6px 6px 6px 12px; }
.bk-picklist { background: var(--card); border: 1px solid var(--line); border-radius: 10px; padding: 0 8px; }
.badge.bk-new { background: #F5E4D9; color: #A2603A; }
.bk-legend { display: flex; flex-wrap: wrap; gap: 12px; font-size: 12.5px; color: var(--ink-soft); margin: 4px 0 10px; }
.bk-legend span { display: inline-flex; align-items: center; gap: 5px; }
.bk-legend i { width: 10px; height: 10px; border-radius: 50%; display: inline-block; }
.bk-nav { display: flex; align-items: center; gap: 6px; margin-bottom: 10px; }
.bk-nav h2 { flex: 1; min-width: 0; margin: 0; font-family: var(--serif); font-weight: 500; font-size: 20px; }
.bk-nav button { padding: 6px 10px; min-width: 44px; }
.bk-top { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; margin-bottom: 14px; }

/* Month: seven columns across at any width, no sideways scroll. */
.bk-month { display: grid; grid-template-columns: repeat(7, minmax(0, 1fr)); gap: 4px; }
.bk-month .dow { text-align: center; font-size: 11px; font-weight: 700; letter-spacing: 0.04em; text-transform: uppercase; color: var(--ink-soft); padding: 2px 0; }
.bk-month .other { min-height: 58px; border-radius: 10px; padding: 6px 2px; text-align: center; color: #C9C3B8; font-size: 13px; }
button.bk-mday { min-height: 58px; padding: 5px 1px; border-radius: 10px; background: var(--card); color: var(--ink); border: 1px solid var(--line);
  flex-direction: column; justify-content: flex-start; gap: 3px; font-weight: 600; font-size: 14px; min-width: 0; }
button.bk-mday:hover { background: var(--teal-soft); }
button.bk-mday.today { background: var(--teal); color: #fff; border-color: var(--teal); }
button.bk-mday.focus:not(.today) { border-color: var(--gold); border-width: 2px; }
.bk-load { display: block; width: 100%; font-size: 10px; line-height: 1.2; font-weight: 600; border-radius: 6px; padding: 2px 1px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.bk-load.busy { background: #1B5E59; color: #fff; }
.bk-load.moderate { background: #CFE1DD; color: #0E3B39; }
.bk-load.quiet { background: var(--gold-soft); color: #7A5A2A; }
.today .bk-load.moderate, .today .bk-load.quiet { background: rgba(255,255,255,0.85); }
.today .bk-load.busy { background: var(--gold); color: #241E17; }

/* Week: an hour grid, seven days across, narrow time column. */
.bk-week { display: grid; grid-template-columns: 30px repeat(7, minmax(0, 1fr)); gap: 3px; }
.bk-week .hr { font-size: 10px; color: var(--ink-soft); text-align: right; padding-right: 2px; padding-top: 2px; font-variant-numeric: tabular-nums; }
.bk-week .cell { min-height: 30px; background: var(--card); border: 1px solid #F0ECE4; border-radius: 6px; padding: 2px; display: flex; flex-direction: column; gap: 2px; min-width: 0; }
button.bk-whead { min-height: 48px; padding: 4px 1px; flex-direction: column; gap: 0; background: var(--card); color: var(--ink); border: 1px solid var(--line); font-size: 11px; min-width: 0; }
button.bk-whead b { font-size: 16px; }
button.bk-whead:hover { background: var(--teal-soft); }
button.bk-whead.today { background: var(--teal); color: #fff; border-color: var(--teal); }
button.bk-wadd { min-height: 36px; padding: 0; background: var(--gold-soft); color: #7A5A2A; border: 1px dashed var(--gold); font-size: 18px; min-width: 0; }
button.bk-wadd:hover { background: var(--gold); }
button.bk-blk { min-height: 0; padding: 2px 3px; border-radius: 5px; border: 0; color: #fff; font-size: 10px; line-height: 1.2; font-weight: 600;
  display: block; text-align: left; width: 100%; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
button.bk-blk span { display: block; overflow: hidden; text-overflow: ellipsis; font-weight: 400; opacity: 0.9; }
@media (max-width: 480px) { button.bk-blk span, button.bk-blk em { display: none; } }
button.bk-blk em { font-style: normal; }

/* Day timeline. */
.bk-tl { display: grid; grid-template-columns: 42px minmax(0, 1fr); gap: 6px; margin-bottom: 12px; }
.bk-tl .lbls { position: relative; }
.bk-tl .lbls span { position: absolute; right: 0; font-size: 11px; color: var(--ink-soft); transform: translateY(-50%); font-variant-numeric: tabular-nums; }
.bk-tl .track { position: relative; border-left: 1px solid var(--line); background-image: linear-gradient(var(--line) 1px, transparent 1px); }
button.bk-gap { position: absolute; left: 4px; right: 4px; min-height: 0; padding: 2px 8px; border-radius: 8px; background: rgba(183,139,78,0.08);
  border: 1.5px dashed var(--gold); color: #7A5A2A; font-size: 12.5px; font-weight: 600; justify-content: flex-start; align-items: flex-start; }
button.bk-gap:hover { background: var(--gold-soft); }
button.bk-appt { position: absolute; min-height: 0; padding: 3px 8px; border-radius: 8px; border: 1px solid rgba(255,255,255,0.6); color: #fff;
  flex-direction: column; align-items: flex-start; justify-content: flex-start; gap: 0; text-align: left; overflow: hidden; font-size: 13px; line-height: 1.25; }
button.bk-appt .w { font-weight: 400; font-size: 11.5px; opacity: 0.92; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 100%; }
button.bk-appt .n { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 100%; }
.bk-slots { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 6px; margin-bottom: 14px; }
button.bk-slot { flex-direction: column; gap: 0; padding: 6px 4px; background: var(--gold-soft); color: #5E4520; border: 1px solid var(--gold); min-width: 0; }
button.bk-slot small { font-weight: 400; font-size: 11.5px; }
button.bk-slot:hover { background: var(--gold); }

/* Obvious warnings inside the booking sheet. */
.bk-clash { border: 2px solid var(--danger); background: var(--danger-soft); color: #6B2415; border-radius: 12px; padding: 12px 14px; }
.bk-clash strong { display: block; font-size: 17px; margin-bottom: 2px; }
.bk-newc { border: 2px solid #A2603A; background: #F8EBE2; color: #5A3420; border-radius: 12px; padding: 12px 14px; }
.bk-newc strong { display: block; font-size: 16px; margin-bottom: 2px; }
.bk-loyal { border: 2px solid var(--gold); background: var(--gold-soft); border-radius: 12px; padding: 12px 14px; display: flex; gap: 10px; align-items: center; flex-wrap: wrap; }
.bk-total { background: var(--card); border: 1px solid var(--line); border-radius: 12px; padding: 12px 14px; }
.bk-total .big { font-family: var(--serif); font-size: 24px; }
.bk-foot { position: sticky; bottom: calc(-18px - env(safe-area-inset-bottom)); background: var(--cream); padding: 10px 0 calc(4px + env(safe-area-inset-bottom)); display: flex; flex-direction: column; gap: 8px; border-top: 1px solid var(--line); z-index: 3; }
.bk-actions { display: flex; gap: 8px; }
.bk-actions > * { flex: 1; }
.bk-segfull .seg { display: flex; flex-wrap: nowrap; width: 100%; }
.bk-segfull .seg button { flex: 1 1 auto; padding: 6px 4px; min-width: 0; min-height: 44px; }
.bk-top .seg button { padding: 6px 8px; }
`;
