"use client";

import { useState } from "react";
import { Check, ChevronDown, Pencil, Tag } from "lucide-react";
import { useSalon } from "@/components/data";
import { rand, Sheet, useToast } from "@/components/ui";
import { ServicesPromotionBuilder } from "@/components/services-promotion-builder";
import { DatePick, WHEN_CSS } from "@/components/when-picker";
import { addService, updateService } from "@/lib/db";
import { fmtDayMonShort, isPromo, PROMO_CATEGORY, promoState } from "@/lib/salon";
import type { Service } from "@/lib/types";

const NEW_CAT = "__new__";

function errText(e: unknown) {
  return e instanceof Error ? e.message : String(e);
}

/** One price-list line. In edit mode the whole row is a big tap target that opens the edit sheet. */
function promoDates(s: Service): string {
  const a = s.promo_start ? fmtDayMonShort(s.promo_start) : null, b = s.promo_end ? fmtDayMonShort(s.promo_end) : null;
  return a && b ? `${a} – ${b}` : a ? `From ${a}` : b ? `Until ${b}` : "No end date";
}

function ServiceRow({ s, editing, onEdit, today }: { s: Service; editing: boolean; onEdit: (s: Service) => void; today?: string }) {
  const state = today && isPromo(s) ? promoState(s, today) : null;
  const body = (
    <>
      <div className="grow">
        <div className="title">{s.name}</div>
        {state && (
          <div className="meta">
            {promoDates(s)}{state === "upcoming" ? " · starts soon" : state === "ended" ? " · ended" : ""}
          </div>
        )}
      </div>
      <span className="small muted" style={{ fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap" }}>
        {s.duration_minutes} min
      </span>
      <span className="price" style={{ minWidth: 58, textAlign: "right" }}>{rand(Number(s.price))}</span>
      {editing && <Pencil size={16} className="chev" aria-hidden />}
    </>
  );
  if (!editing) return <div className="item">{body}</div>;
  return (
    <button type="button" className="item" onClick={() => onEdit(s)} aria-label={`Edit ${s.name}`}>
      {body}
    </button>
  );
}

export default function Services() {
  const { services, reload, today } = useSalon();
  const [showEnded, setShowEnded] = useState(false);
  const [editing, setEditing] = useState(false);
  const [toast, say] = useToast();
  const [edit, setEdit] = useState<Service | null>(null);
  const [openCat, setOpenCat] = useState<string | null>(null);

  // Retired services stay in the table (past bookings snapshot their names and
  // prices) but never appear on the price list.
  const active = services.filter((s) => s.active === true);
  const promos = active.filter(isPromo);
  const current = promos.filter((s) => promoState(s, today) !== "ended");
  const ended = promos.filter((s) => promoState(s, today) === "ended");
  const grouped = new Map<string, Service[]>();
  for (const s of active) {
    if (isPromo(s)) continue;
    if (!grouped.has(s.category)) grouped.set(s.category, []);
    grouped.get(s.category)!.push(s);
  }
  const categories = [...grouped.keys()].sort();
  const regular = categories.flatMap((c) => grouped.get(c)!);

  return (
    <>
      <div className="page-head" style={{ alignItems: "center" }}>
        <h1 className="grow">Services</h1>
        <button className={`pill ${editing ? "" : "ghost"}`} onClick={() => setEditing(!editing)} style={{ marginBottom: 0 }}>
          {editing ? <><Check size={17} />Done</> : <><Pencil size={16} />Edit</>}
        </button>
      </div>
      <p className="sub">
        {editing
          ? "Tap a service to change its price or duration, or retire it. Add a new one at the bottom."
          : "Your price list. Changing a price later won't change past bookings. They keep the price that was in effect when they were made."}
      </p>

      {!categories.length && <div className="notice">No services yet. Tap Edit services and add your first one.</div>}

      {/* Promotions pinned first: what a client peeking at the screen, or Nicky quoting, sees first. */}
      <style>{WHEN_CSS}</style>
      <div className="card">
        <h2><Tag size={18} />Promotions</h2>
        <p className="sub">A special price for a set time. Each one shows up in the booking form only for appointments between its first and last day.</p>
        {current.length ? (
          <div className="list nw">
            {current.map((s) => <ServiceRow key={s.id} s={s} editing={editing} onEdit={setEdit} today={today} />)}
          </div>
        ) : (
          <p className="muted small" style={{ margin: 0 }}>
            {editing ? "No promotions running. Build one below." : "No promotions running. Tap Edit to build one."}
          </p>
        )}
        {ended.length > 0 && (
          <>
            <button type="button" className="linkish small" style={{ marginTop: 10 }} onClick={() => setShowEnded(!showEnded)}>
              {showEnded ? "Hide" : "Show"} {ended.length} ended {ended.length === 1 ? "promotion" : "promotions"}
            </button>
            {showEnded && (
              <div className="list nw" style={{ opacity: 0.75 }}>
                {ended.map((s) => <ServiceRow key={s.id} s={s} editing={editing} onEdit={setEdit} today={today} />)}
              </div>
            )}
          </>
        )}
        {editing && (
          <details open={!current.length} style={{ marginTop: 12 }}>
            <summary style={{ cursor: "pointer", fontWeight: 600, minHeight: 44, display: "flex", alignItems: "center" }}>
              Build a promotion
            </summary>
            <ServicesPromotionBuilder regular={regular} today={today}
              onCreated={async (name) => { await reload(); say(`${name} added. It's bookable on its dates.`); }} onError={(m) => say(m)} />
          </details>
        )}
      </div>

      {categories.length > 0 && (
        <div className="sp-cats" style={{ marginTop: 0, marginBottom: 14 }}>
          {categories.map((cat) => {
            const list = grouped.get(cat)!;
            const isOpen = openCat === cat || categories.length === 1;
            return (
              <div key={cat} className={`sp-cat${isOpen ? " open" : ""}`}>
                <button type="button" className="sp-cat-h" aria-expanded={isOpen} onClick={() => setOpenCat(isOpen ? null : cat)}>
                  <span className="grow">
                    <span className="sp-name">{cat}</span>
                    <span className="small muted">{list.length} {list.length === 1 ? "service" : "services"} · from {rand(Math.min(...list.map((s) => Number(s.price))))}</span>
                  </span>
                  <ChevronDown size={20} className="sp-chev" />
                </button>
                {isOpen && (
                  <div className="sp-cat-b">
                    <div className="list nw">
                      {list.map((s) => <ServiceRow key={s.id} s={s} editing={editing} onEdit={setEdit} />)}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {editing && (
        <AddServiceForm categories={categories} onSaved={async (msg) => { await reload(); say(msg); }} onError={say} />
      )}

      {edit && (
        <EditServiceSheet s={edit} today={today} onClose={() => setEdit(null)}
          onSaved={async (msg) => { setEdit(null); await reload(); say(msg); }} onError={say} />
      )}
      {toast}
    </>
  );
}

function EditServiceSheet({ s, today, onClose, onSaved, onError }: {
  s: Service; today: string; onClose: () => void; onSaved: (msg: string) => Promise<void>; onError: (m: string) => void;
}) {
  const promo = isPromo(s);
  const [start, setStart] = useState<string | null>(s.promo_start ?? null);
  const [end, setEnd] = useState<string | null>(s.promo_end ?? null);
  const [price, setPrice] = useState(String(Math.round(Number(s.price))));
  const [dur, setDur] = useState(String(s.duration_minutes));
  const [confirmRetire, setConfirmRetire] = useState(false);
  const [busy, setBusy] = useState(false);

  async function save() {
    const p = Number(price), d = Number(dur);
    if (!Number.isFinite(p) || p < 0 || price.trim() === "") return onError("Enter a price of R0 or more.");
    if (!Number.isInteger(d) || d < 5) return onError("Duration must be at least 5 minutes.");
    if (promo && start && end && end < start) return onError("The last day can't be before the first day.");
    setBusy(true);
    try {
      await updateService(s.id, { price: Math.round(p), duration_minutes: d, ...(promo ? { promo_start: start, promo_end: end } : {}) });
      await onSaved(`${s.name} updated.`);
    } catch (e) {
      onError(`Couldn't save: ${errText(e)}`);
    } finally {
      setBusy(false);
    }
  }

  // Soft delete: the row stays so past bookings keep their snapshot and history.
  async function retire() {
    setBusy(true);
    try {
      await updateService(s.id, { active: false });
      await onSaved(`${s.name} removed from the price list.`);
    } catch (e) {
      onError(`Couldn't remove it: ${errText(e)}`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Sheet title={s.name} onClose={onClose}>
      <div className="stack">
        <p className="small muted" style={{ margin: 0 }}>{promo ? "Promotion" : s.category}. Past bookings keep the price they were made at.</p>
        <div className="fields2">
          <label className="field">Price (R)
            <input type="number" inputMode="numeric" min={0} step={10} value={price} onChange={(e) => setPrice(e.target.value)} />
          </label>
          <label className="field">Duration (min)
            <input type="number" inputMode="numeric" min={5} step={5} value={dur} onChange={(e) => setDur(e.target.value)} />
          </label>
        </div>
        {promo && (
          <>
            <div className="field">Runs from
              <DatePick value={start} onChange={setStart} today={today} placeholder="No start date" />
            </div>
            <div className="field">Until (last day)
              <DatePick value={end} onChange={setEnd} today={today} placeholder="No end date" />
            </div>
            <p className="small muted" style={{ margin: "-4px 0 0" }}>Offered for appointments on these dates only. End it early by moving the last day to today.</p>
          </>
        )}
        <button onClick={save} disabled={busy}>Save</button>
        <hr style={{ border: 0, borderTop: "1px solid var(--line)", margin: "4px 0", width: "100%" }} />
        {!confirmRetire ? (
          <button className="danger" onClick={() => setConfirmRetire(true)} disabled={busy}>Remove from price list</button>
        ) : (
          <div className="notice danger" style={{ marginBottom: 0 }}>
            <p style={{ marginTop: 0 }}>Remove <b>{s.name}</b>? It disappears from the price list and the booking form. Past bookings of it stay exactly as they were.</p>
            <div className="row">
              <button className="danger" onClick={retire} disabled={busy}>Yes, remove it</button>
              <button className="ghost" onClick={() => setConfirmRetire(false)} disabled={busy}>Keep it</button>
            </div>
          </div>
        )}
      </div>
    </Sheet>
  );
}

function AddServiceForm({ categories, onSaved, onError }: {
  categories: string[]; onSaved: (msg: string) => Promise<void>; onError: (m: string) => void;
}) {
  const [cat, setCat] = useState<string>(categories[0] ?? NEW_CAT);
  const [newCat, setNewCat] = useState("");
  const [name, setName] = useState("");
  const [price, setPrice] = useState("0");
  const [dur, setDur] = useState("30");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const catValue = categories.includes(cat) ? cat : NEW_CAT;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const category = catValue === NEW_CAT ? newCat.trim() : catValue;
    const p = Number(price), d = Number(dur);
    if (!name.trim()) return setErr("Enter a service name.");
    if (!category) return setErr("Enter a category name.");
    // "Promotions" (and the old "Packages") are reserved: a promotion is a services row under that category.
    if (isPromo({ category }) || ["promotions", "packages"].includes(category.toLowerCase()))
      return setErr("“Promotions” is reserved. Use Build a promotion above instead.");
    if (!Number.isFinite(p) || p < 0 || price.trim() === "") return setErr("Enter a price of R0 or more.");
    if (!Number.isInteger(d) || d < 5) return setErr("Duration must be at least 5 minutes.");
    setErr(null);
    setBusy(true);
    try {
      await addService({ category, name: name.trim(), price: Math.round(p), duration_minutes: d });
      setName(""); setPrice("0"); setDur("30"); setNewCat("");
      if (catValue === NEW_CAT) setCat(category);
      await onSaved(`${name.trim()} added to ${category}.`);
    } catch (e2) {
      onError(`Couldn't add it: ${errText(e2)}`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="card stack" onSubmit={submit}>
      <h2 style={{ margin: 0 }}>Add a service</h2>
      <label className="field">Category
        <select value={catValue} onChange={(e) => setCat(e.target.value)}>
          {categories.map((c) => <option key={c} value={c}>{c}</option>)}
          <option value={NEW_CAT}>+ New category</option>
        </select>
      </label>
      {catValue === NEW_CAT && (
        <label className="field">New category name
          <input value={newCat} onChange={(e) => setNewCat(e.target.value)} autoCapitalize="words" />
        </label>
      )}
      <label className="field">Service name
        <input value={name} onChange={(e) => setName(e.target.value)} autoCapitalize="words" />
      </label>
      <div className="fields2">
        <label className="field">Price (R)
          <input type="number" inputMode="numeric" min={0} step={10} value={price} onChange={(e) => setPrice(e.target.value)} />
        </label>
        <label className="field">Duration (min)
          <input type="number" inputMode="numeric" min={5} step={5} value={dur} onChange={(e) => setDur(e.target.value)} />
        </label>
      </div>
      {err && <div className="notice danger" style={{ marginBottom: 0 }}>{err}</div>}
      <button type="submit" disabled={busy}>+ Add service</button>
    </form>
  );
}
