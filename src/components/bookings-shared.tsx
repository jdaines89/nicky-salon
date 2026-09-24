"use client";

import { useMemo, useState } from "react";
import { ChevronDown, Package, Plus, RotateCcw, Search, Sparkles, UserPlus, X } from "lucide-react";
import { rand } from "@/components/ui";
import { firstVisitMap, isFirstVisit, PACKAGE_CATEGORY, toMinutes, validPhone } from "@/lib/salon";
import type { BookingWithServices, Client, Service } from "@/lib/types";

// ---------------------------------------------------------------------------
// Status colours and labels (same palette as the Streamlit calendar)
// ---------------------------------------------------------------------------

export const STATUS_COLOR: Record<string, string> = {
  confirmed: "var(--teal-3)", pending: "var(--gold)", cancelled: "#9AA3A1", "no-show": "var(--danger)", new: "var(--rose)",
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

/**
 * Services as a tappable list rather than a dropdown: search or pick a
 * category, tap a service, done. Most visits are one service, so the list
 * folds away after a pick and "Add another" brings it back.
 */
/**
 * Services fold into their categories, so she sees a handful of headings
 * rather than the whole price list: tap one open, tap a service, done. Search
 * cuts straight across them. When the client has been before, her usual
 * visit is one tap at the top.
 */
export function ServicePicker({ opts, lines, onChange, usual }: {
  opts: SvcOpt[]; lines: Line[]; onChange: (l: Line[]) => void; usual?: SvcOpt[];
}) {
  const [open, setOpen] = useState(lines.length === 0);
  const [q, setQ] = useState("");
  const [cat, setCat] = useState<string | null>(null);
  const chosenIds = new Set(lines.map((l) => l.service_id));
  const groups = useMemo(() => {
    const out = new Map<string, SvcOpt[]>();
    for (const o of opts) {
      const g = o.pkg ? PACKAGE_CATEGORY : o.category;
      out.set(g, [...(out.get(g) ?? []), o]);
    }
    return [...out.entries()];
  }, [opts]);
  const needle = q.trim().toLowerCase();
  const found = needle ? opts.filter((o) => !chosenIds.has(o.id) && (o.name.toLowerCase().includes(needle) || o.category.toLowerCase().includes(needle))) : [];
  const total = lines.reduce((s, l) => s + l.price, 0);
  const pick = (o: SvcOpt) => { onChange([...lines, lineFromOpt(o)]); setQ(""); setOpen(false); };
  const usualOk = !lines.length && usual && usual.length > 0;

  const option = (o: SvcOpt, showCat = false) => (
    <button type="button" key={o.id} className="sp-opt" onClick={() => pick(o)}>
      <div className="grow">
        <div className="sp-name">{o.pkg && <Package size={14} style={{ verticalAlign: -2, marginRight: 4, color: "var(--gold-2)" }} />}{o.name}</div>
        <div className="small muted">{o.duration} min{showCat ? ` · ${o.pkg ? PACKAGE_CATEGORY : o.category}` : ""}</div>
      </div>
      <span className="num sp-price">{rand(o.price)}</span>
      <span className="sp-add" aria-hidden><Plus size={16} /></span>
    </button>
  );

  return (
    <div>
      {lines.length > 0 && (
        <div className="sp-chosen">
          {lines.map((l) => (
            <div key={l.key} className="sp-line">
              <span className="sp-ico" aria-hidden>{l.pkg ? <Package size={17} /> : <Sparkles size={17} />}</span>
              <div className="grow">
                <div className="sp-name">{l.name}</div>
                <div className="small muted">{l.duration ? `${l.duration} min` : "Time not set"}</div>
              </div>
              <b className="num">{rand(l.price)}</b>
              <button type="button" className="sp-x" aria-label={`Remove ${l.name}`}
                onClick={() => { const next = lines.filter((x) => x.key !== l.key); onChange(next); if (!next.length) setOpen(true); }}><X size={16} /></button>
            </div>
          ))}
          {lines.length > 1 && <div className="sp-sum"><span>{lines.length} services</span><b className="num">{rand(total)}</b></div>}
        </div>
      )}
      {!open ? (
        <button type="button" className="soft pill" style={{ marginTop: 10 }} onClick={() => setOpen(true)}><Plus size={17} />Add another service</button>
      ) : (
        <div className="sp-panel">
          {usualOk && !needle && (
            <button type="button" className="sp-usual" onClick={() => { onChange(usual!.map(lineFromOpt)); setOpen(false); }}>
              <span className="sp-ico" aria-hidden><RotateCcw size={17} /></span>
              <div className="grow">
                <div className="small muted">Her usual</div>
                <div className="sp-name">{usual!.map((o) => o.name).join(" + ")}</div>
              </div>
              <span className="num sp-price">{rand(usual!.reduce((s, o) => s + o.price, 0))}</span>
            </button>
          )}
          <div className="search">
            <Search size={18} />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search services…" aria-label="Search services" autoComplete="off" />
          </div>
          {needle ? (
            <div className="sp-list">
              {found.map((o) => option(o, true))}
              {!found.length && <p className="small muted" style={{ padding: "10px 4px", margin: 0 }}>No service by that name.</p>}
            </div>
          ) : (
            <div className="sp-cats">
              {groups.map(([g, list]) => {
                const left = list.filter((o) => !chosenIds.has(o.id));
                const isOpen = cat === g || groups.length === 1;
                const from = Math.min(...list.map((o) => o.price));
                return (
                  <div key={g} className={`sp-cat${isOpen ? " open" : ""}`}>
                    <button type="button" className="sp-cat-h" aria-expanded={isOpen} onClick={() => setCat(isOpen ? null : g)}>
                      <span className="grow">
                        <span className="sp-name">{g === PACKAGE_CATEGORY && <Package size={15} style={{ verticalAlign: -2, marginRight: 6, color: "var(--gold-2)" }} />}{g}</span>
                        <span className="small muted">{list.length} {list.length === 1 ? "service" : "services"} · from {rand(from)}</span>
                      </span>
                      <ChevronDown size={20} className="sp-chev" />
                    </button>
                    {isOpen && (
                      <div className="sp-cat-b">
                        {left.map((o) => option(o))}
                        {!left.length && <p className="small muted" style={{ padding: "8px 4px", margin: 0 }}>Everything here is already added.</p>}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
          {lines.length > 0 && <button type="button" className="linkish" style={{ marginTop: 8 }} onClick={() => setOpen(false)}>Done</button>}
        </div>
      )}
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
      <div className="cp-picked">
        <span className="avatar">{(c?.name || "?").trim().charAt(0).toUpperCase()}</span>
        <div className="grow">
          <div className="sp-name">{c?.name ?? "Unknown client"}</div>
          {c?.phone && <div className="small muted">{c.phone}</div>}
        </div>
        <button type="button" className="ghost pill" style={{ minHeight: 40 }} onClick={() => { setQ(""); onChange({ kind: "none" }); }}>Change</button>
      </div>
    );
  }
  if (value.kind === "new") {
    const match = findClientByName(clients, value.name);
    const bad = phoneProblem(value);
    return (
      <div className="stack" style={{ gap: 10 }}>
        <div className="row"><span className="badge gold"><UserPlus size={12} />New client</span><span className="grow" />
          <button type="button" className="linkish small" onClick={() => onChange({ kind: "none" })}>Pick an existing client</button>
        </div>
        <input value={value.name} placeholder="Full name" autoComplete="off" aria-label="Name" autoFocus
          onChange={(e) => onChange({ ...value, name: e.target.value })} />
        {match && <p className="small" style={{ margin: 0 }}>{match.name} is already on file, so this booking will go on her existing record.</p>}
        {!match && (
          <input value={value.phone} inputMode="tel" placeholder="Phone (optional) e.g. 082 123 4567" autoComplete="off" aria-label="Phone"
            onChange={(e) => onChange({ ...value, phone: e.target.value })} />
        )}
        {!match && bad && <div className="notice danger" style={{ margin: 0 }}>{bad}</div>}
      </div>
    );
  }
  const needle = q.trim().toLowerCase();
  const digits = needle.replace(/\D/g, "");
  const matches = needle ? clients.filter((c) => c.name.toLowerCase().includes(needle) || (digits && (c.phone || "").replace(/\D/g, "").includes(digits))).slice(0, 6) : [];
  return (
    <div className="stack" style={{ gap: 8 }}>
      <div className="search">
        <Search size={18} />
        <input value={q} placeholder="Who's coming in?" autoComplete="off" aria-label="Search clients"
          onChange={(e) => setQ(e.target.value)} />
      </div>
      {matches.length > 0 && (
        <div className="list cp-list">
          {matches.map((c) => (
            <button type="button" key={c.id} className="item" onClick={() => onChange({ kind: "existing", id: c.id })}>
              <span className="avatar">{c.name.trim().charAt(0).toUpperCase()}</span>
              <div className="grow"><div className="title">{c.name}</div>{c.phone && <div className="meta">{c.phone}</div>}</div>
            </button>
          ))}
        </div>
      )}
      {needle && !matches.length && <p className="small muted" style={{ margin: 0 }}>No client called that yet.</p>}
      <button type="button" className="soft pill" style={{ alignSelf: "flex-start" }} onClick={() => onChange({ kind: "new", name: q.trim(), phone: "" })}>
        <UserPlus size={17} />{q.trim() && !matches.some((c) => c.name.toLowerCase() === needle) ? `Add “${q.trim()}” as new` : "New client"}
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Page-local styles. Shared globals.css stays untouched; everything here is
// prefixed bk- so it can't leak into other screens.
// ---------------------------------------------------------------------------

export const BOOKINGS_CSS = `
.sp-chosen { display: flex; flex-direction: column; gap: 8px; }
.sp-line { display: flex; align-items: center; gap: 12px; background: var(--paper); border-radius: 16px; padding: 10px 8px 10px 12px; animation: pop .2s var(--ease) both; }
.sp-ico { width: 34px; height: 34px; border-radius: 11px; display: grid; place-items: center; background: var(--gold-soft); color: var(--gold-2); flex: none; }
.sp-name { font-weight: 650; line-height: 1.3; }
button.sp-x { width: 34px; min-height: 34px; padding: 0; border-radius: 50%; background: none; color: var(--ink-soft); border: 0; }
button.sp-x:hover { background: var(--paper-2); color: var(--danger); }
.sp-sum { display: flex; justify-content: space-between; padding: 2px 12px; font-size: 15px; color: var(--ink-soft); }
.sp-sum b { color: var(--ink); }
.sp-panel { margin-top: 10px; }
.sp-chosen + .sp-panel { padding-top: 12px; border-top: 1px dashed var(--line-2); }
.sp-list { margin-top: 6px; }
button.sp-usual { width: 100%; display: flex; align-items: center; gap: 12px; min-height: 64px; padding: 10px 12px; margin-bottom: 10px; border-radius: 16px;
  background: var(--gold-soft); color: var(--ink); border: 1.5px solid color-mix(in srgb, var(--gold) 45%, transparent); text-align: left; font-weight: inherit; }
button.sp-usual .sp-ico { background: var(--card); }
button.sp-opt { width: 100%; display: flex; align-items: center; gap: 12px; min-height: 58px; padding: 8px 6px; background: none; color: var(--ink); border: 0;
  border-bottom: 1px solid var(--line); border-radius: 0; text-align: left; font-weight: 400; justify-content: flex-start; }
button.sp-opt:last-child { border-bottom: 0; }
button.sp-opt:hover { background: var(--teal-mist); }
button.sp-opt:active { transform: none; background: var(--teal-soft); }
.sp-price { font-weight: 650; color: var(--ink-2); }
.sp-add { width: 30px; height: 30px; border-radius: 50%; display: grid; place-items: center; background: var(--teal-soft); color: var(--teal); flex: none; }
.cp-picked { display: flex; align-items: center; gap: 12px; }
.cp-list { background: var(--paper); border-radius: 16px; padding: 0 8px; }
.list.bk-rows > .item { flex-wrap: nowrap; }
.list.bk-rows > .item > .grow { flex: 1 1 auto; }
.bk-label { font-size: 14.5px; font-weight: 600; color: var(--ink-soft); }
.bk-line { display: flex; align-items: center; gap: 10px; background: var(--card); border: 1px solid var(--line); border-radius: 10px; padding: 6px 6px 6px 12px; }
.bk-picklist { background: var(--card); border: 1px solid var(--line); border-radius: 10px; padding: 0 8px; }
.badge.bk-new { background: var(--rose-soft); color: color-mix(in srgb, var(--rose) 60%, var(--ink)); }
.bk-legend { display: flex; flex-wrap: wrap; gap: 12px; font-size: 14px; color: var(--ink-soft); margin: 4px 0 10px; }
.bk-legend span { display: inline-flex; align-items: center; gap: 5px; }
.bk-legend i { width: 10px; height: 10px; border-radius: 50%; display: inline-block; }
.bk-nav { display: flex; align-items: center; gap: 6px; margin-bottom: 10px; }
.bk-nav h2 { flex: 1; min-width: 0; margin: 0; font-family: var(--serif); font-weight: 450; font-size: 21px; letter-spacing: -0.01em; }
.bk-nav button { min-height: 42px; }
.bk-nav button.icon { width: 42px; }
.bk-top { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; margin-bottom: 14px; }
.bk-newbtn { display: none; }
@media (min-width: 900px) { .bk-newbtn { display: inline-flex; } }

/* Month: seven columns across at any width, no sideways scroll. */
.bk-month { display: grid; grid-template-columns: repeat(7, minmax(0, 1fr)); gap: 5px; }
.bk-month .dow { text-align: center; font-size: 12.5px; font-weight: 700; letter-spacing: 0.04em; text-transform: uppercase; color: var(--ink-soft); padding: 2px 0; }
.bk-month .other { min-height: 58px; border-radius: 10px; padding: 6px 2px; text-align: center; color: var(--ink-faint); font-size: 14.5px; }
button.bk-mday { min-height: 62px; padding: 6px 1px; border-radius: 14px; background: var(--paper); color: var(--ink); border: 0;
  flex-direction: column; justify-content: flex-start; gap: 3px; font-weight: 600; font-size: 15.5px; min-width: 0; }
button.bk-mday:hover { background: var(--teal-soft); }
button.bk-mday.today { background: var(--teal); color: var(--on-accent); border-color: var(--teal); }
button.bk-mday.focus:not(.today) { box-shadow: inset 0 0 0 2px var(--gold); }
.bk-load { display: block; width: calc(100% - 6px); font-size: 11.5px; line-height: 1.2; font-weight: 650; border-radius: 8px; padding: 2px 1px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.bk-load.busy { background: var(--teal-3); color: var(--on-accent); }
.bk-load.moderate { background: var(--teal-soft); color: var(--teal); }
.bk-load.quiet { background: var(--gold-soft); color: var(--gold-ink); }
.today .bk-load.moderate, .today .bk-load.quiet { background: color-mix(in srgb, var(--card) 85%, transparent); }
.today .bk-load.busy { background: var(--gold); color: var(--on-gold); }

/* Week: an hour grid, seven days across, narrow time column. */
.bk-week { display: grid; grid-template-columns: 30px repeat(7, minmax(0, 1fr)); gap: 3px; }
.bk-week .hr { font-size: 11.5px; color: var(--ink-soft); text-align: right; padding-right: 2px; padding-top: 2px; font-variant-numeric: tabular-nums; }
.bk-week .cell { min-height: 30px; background: var(--paper); border: 0; border-radius: 8px; padding: 2px; display: flex; flex-direction: column; gap: 2px; min-width: 0; }
button.bk-whead { min-height: 52px; padding: 4px 1px; flex-direction: column; gap: 0; background: var(--paper); color: var(--ink); border: 0; border-radius: 14px; font-size: 12.5px; min-width: 0; }
button.bk-whead b { font-size: 16px; }
button.bk-whead:hover { background: var(--teal-soft); }
button.bk-whead.today { background: var(--teal); color: var(--on-accent); border-color: var(--teal); }
button.bk-wadd { min-height: 34px; padding: 0; background: transparent; color: var(--gold-2); border: 1.5px dashed var(--line-2); border-radius: 10px; font-size: 18px; min-width: 0; }
button.bk-wadd:hover { background: var(--gold); }
button.bk-blk { min-height: 0; padding: 3px 4px; border-radius: 6px; border: 0; color: #fff; font-size: 11.5px; line-height: 1.2; font-weight: 600;
  display: block; text-align: left; width: 100%; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
button.bk-blk span { display: block; overflow: hidden; text-overflow: ellipsis; font-weight: 400; opacity: 0.9; }
@media (max-width: 480px) { button.bk-blk span, button.bk-blk em { display: none; } }
button.bk-blk em { font-style: normal; }

/* Day timeline. */
.bk-daysum { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 8px; margin: 12px 0 16px; }
.bk-daysum > div { background: var(--paper); border-radius: 14px; padding: 8px 10px; display: flex; flex-direction: column; }
.bk-daysum b { font-family: var(--serif); font-weight: 450; font-size: 20px; line-height: 1.2; font-variant-numeric: lining-nums; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.bk-daysum span { font-size: 13.5px; color: var(--ink-soft); font-weight: 600; }
.bk-tl { display: grid; grid-template-columns: 38px minmax(0, 1fr); gap: 6px; margin-bottom: 12px; }
.bk-tl .lbls { position: relative; }
.bk-tl .lbls span { position: absolute; right: 0; font-size: 12.5px; font-weight: 600; color: var(--ink-soft); transform: translateY(-50%); font-variant-numeric: tabular-nums; }
.bk-tl .track { position: relative; background-image: linear-gradient(var(--line) 1px, transparent 1px); }
button.bk-gap { position: absolute; left: 4px; right: 4px; min-height: 0; padding: 0 10px; border-radius: 12px; background: transparent;
  border: 1.5px dashed var(--line-2); color: var(--ink-soft); font-size: 14.5px; font-weight: 650; justify-content: flex-start; align-items: flex-start; padding-top: 6px; gap: 6px; overflow: hidden; }
button.bk-gap span { font-weight: 500; color: var(--ink-soft); }
button.bk-gap:hover { background: var(--gold-soft); border-color: var(--gold); color: var(--gold-ink); }
button.bk-appt { position: absolute; min-height: 0; padding: 6px 10px 6px 12px; border-radius: 12px; border: 0; color: var(--ink);
  background: color-mix(in srgb, var(--c) 16%, var(--card)); box-shadow: inset 4px 0 0 var(--c), 0 0 0 2px var(--card);
  flex-direction: column; align-items: flex-start; justify-content: flex-start; gap: 1px; text-align: left; overflow: hidden; font-size: 15.5px; line-height: 1.25; }
button.bk-appt:hover { background: color-mix(in srgb, var(--c) 24%, var(--card)); }
button.bk-appt.short { flex-direction: row; align-items: center; gap: 8px; padding-top: 0; padding-bottom: 0; }
button.bk-appt.off { opacity: 0.6; }
button.bk-appt.off .n { text-decoration: line-through; }
button.bk-appt .n { font-weight: 700; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 100%; display: flex; gap: 6px; align-items: center; }
button.bk-appt .n .nm { overflow: hidden; text-overflow: ellipsis; min-width: 0; }
button.bk-appt.short .w { flex: 1 1 0; min-width: 0; }
button.bk-appt .n em { font-style: normal; font-size: 12px; font-weight: 700; color: color-mix(in srgb, var(--c) 55%, var(--ink)); background: var(--card); padding: 0 6px; border-radius: 99px; flex: none; }
button.bk-appt .w { font-weight: 500; font-size: 13.5px; color: var(--ink-2); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 100%; }
button.bk-appt .nt { font-style: italic; color: var(--ink-soft); }
.bk-now { position: absolute; left: -6px; right: 0; height: 2px; background: var(--danger); z-index: 5; pointer-events: none; }
.bk-now i { position: absolute; left: -4px; top: -4px; width: 10px; height: 10px; border-radius: 50%; background: var(--danger); }
.bk-slots { display: none; }

/* Obvious warnings inside the booking sheet. */
.bk-clash { border: 1.5px solid color-mix(in srgb, var(--danger) 35%, transparent); background: var(--danger-soft); color: var(--danger); border-radius: 18px; padding: 14px 16px; font-size: 16px; animation: pop .2s var(--ease) both; }
.bk-clash strong { display: flex; align-items: center; gap: 6px; font-size: 16px; margin-bottom: 2px; }
.bk-newc { margin-top: 12px; background: var(--rose-soft); color: var(--ink-2); border-radius: 16px; padding: 12px 14px; font-size: 15.5px; }
.bk-newc strong { display: flex; align-items: center; gap: 6px; font-size: 16px; margin-bottom: 2px; color: color-mix(in srgb, var(--rose) 60%, var(--ink)); }
.bk-loyal { background: linear-gradient(135deg, var(--card), var(--gold-soft)); color: var(--gold-ink); border-radius: 20px; padding: 14px 16px; display: flex; gap: 12px; align-items: center; flex-wrap: wrap; box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--gold) 35%, transparent); }
.bk-loyal > svg { flex: none; color: var(--gold-2); }
.bk-foot { position: sticky; bottom: calc(-18px - env(safe-area-inset-bottom)); background: var(--paper); margin: 0 -16px; padding: 12px 16px calc(12px + env(safe-area-inset-bottom));
  display: flex; flex-direction: column; gap: 10px; z-index: 3; box-shadow: 0 -10px 24px -18px rgba(21,32,30,0.35); border-radius: 22px 22px 0 0; }
.bk-actions { display: flex; gap: 8px; }
.bk-actions > .bs-go { flex: 1; }
button.bs-go { min-height: 56px; font-size: 16.5px; border-radius: 18px; background: linear-gradient(150deg, var(--teal-2), var(--teal)); box-shadow: 0 10px 22px -10px rgba(15,59,56,0.8); }
button.bs-go.clash { background: var(--danger); box-shadow: none; }
.bk-actions > button.icon { width: 56px; min-height: 56px; border-radius: 18px; }
.bs-sum { display: flex; align-items: center; gap: 12px; }
.bs-when { font-weight: 700; font-size: 16px; }
.bs-total { font-family: var(--serif); font-size: 26px; font-weight: 450; letter-spacing: -0.02em; text-align: right; line-height: 1.1; font-variant-numeric: lining-nums; }
.bs-total s { display: block; font-family: var(--sans); font-size: 14px; color: var(--ink-soft); letter-spacing: 0; }
.bs-dur { margin-top: 14px; padding: 10px; border-radius: 16px; background: var(--paper); }
button.bs-toggle { width: 100%; background: none; color: var(--ink-2); border: 0; padding: 0; min-height: 40px; justify-content: flex-start; gap: 10px; font-weight: 400; }
button.bs-toggle:hover { background: none; }
button.bs-toggle:active { transform: none; }
.bs .section { padding: 16px; }
.bk-segfull .seg { display: grid; grid-template-columns: repeat(auto-fit, minmax(118px, 1fr)); width: 100%; gap: 4px; }
.bk-segfull .seg button { padding: 6px 8px; min-width: 0; min-height: 44px; }
.bk-top .seg button { padding: 6px 8px; }
`;
