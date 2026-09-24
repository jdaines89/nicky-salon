"use client";

import { useState } from "react";
import { addService } from "@/lib/db";
import { PACKAGE_CATEGORY } from "@/lib/salon";
import type { Service } from "@/lib/types";

function label(s: Service) {
  return `${s.name} — R${Math.round(Number(s.price))} · ${s.duration_minutes} min`;
}

/**
 * Build a package deal: add services one at a time (a multi-select is unusable
 * on a phone, the keyboard covers the options), see what they cost separately,
 * and price the bundle. The price is fixed at creation: it is a plain services
 * row under "Packages" and never follows its components afterwards, so repricing
 * a component never silently reprices a package.
 */
export function ServicesPackageBuilder({ regular, onCreated, onError }: {
  regular: Service[];
  onCreated: (name: string) => Promise<void>;
  onError: (msg: string) => void;
}) {
  const [ids, setIds] = useState<string[]>([]);
  const [name, setName] = useState("");
  // The suggested price/duration follow the chosen services until she types her
  // own; a typed value is kept only for the selection it was typed against.
  const [priceEdit, setPriceEdit] = useState<{ key: string; v: string } | null>(null);
  const [durEdit, setDurEdit] = useState<{ key: string; v: string } | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const byId = new Map(regular.map((s) => [s.id, s]));
  const chosen = ids.map((i) => byId.get(i)).filter((s): s is Service => !!s);
  const remaining = regular.filter((s) => !ids.includes(s.id));
  const indivTotal = chosen.reduce((a, s) => a + Number(s.price), 0);
  const indivDur = chosen.reduce((a, s) => a + s.duration_minutes, 0);
  // ~10% off, rounded to a friendly R10. She can type any price she likes.
  const suggested = Math.max(0, Math.round((indivTotal * 0.9) / 10) * 10);
  const selKey = `${chosen.length}_${indivTotal}_${indivDur}`;
  const price = priceEdit?.key === selKey ? priceEdit.v : String(suggested);
  const dur = durEdit?.key === selKey ? durEdit.v : String(Math.max(5, indivDur || 30));

  async function create() {
    const p = Number(price), d = Number(dur);
    if (chosen.length < 2) return setErr("Pick at least two services to make a package.");
    if (!name.trim()) return setErr("Give the package a name.");
    if (!Number.isFinite(p) || p < 0 || price.trim() === "") return setErr("Enter a package price of R0 or more.");
    if (!Number.isInteger(d) || d < 5) return setErr("Duration must be at least 5 minutes.");
    setErr(null);
    setBusy(true);
    try {
      const n = name.trim();
      await addService({ category: PACKAGE_CATEGORY, name: n, price: Math.round(p), duration_minutes: d });
      setIds([]); setName(""); setPriceEdit(null); setDurEdit(null);
      await onCreated(n);
    } catch (e) {
      onError(`Couldn't create the package: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="stack" style={{ marginTop: 8 }}>
      <div>
        <h3>Services in this package</h3>
        {chosen.length ? (
          <div className="list">
            {chosen.map((s) => (
              <div key={s.id} className="item" style={{ minHeight: 48, padding: "6px 4px" }}>
                <div className="grow small">{label(s)}</div>
                <button type="button" className="ghost" aria-label={`Remove ${s.name}`}
                  onClick={() => setIds(ids.filter((i) => i !== s.id))}>✕</button>
              </div>
            ))}
          </div>
        ) : (
          <p className="small muted" style={{ margin: 0 }}>Nothing yet. Add services one at a time below.</p>
        )}
      </div>
      <label className="field">Add a service
        <select value="" onChange={(e) => { if (e.target.value) setIds([...ids, e.target.value]); }}>
          <option value="">— add a service —</option>
          {remaining.map((s) => <option key={s.id} value={s.id}>{label(s)}</option>)}
        </select>
      </label>
      {chosen.length > 0 && (
        <p className="small muted" style={{ margin: 0 }}>
          Individually: <b>R{Math.round(indivTotal)}</b> · {indivDur} min. Price the bundle below it and the deal sells itself.
        </p>
      )}
      <div className="fields2">
        <label className="field">Package price (R)
          <input type="number" inputMode="numeric" min={0} step={10} value={price}
            onChange={(e) => setPriceEdit({ key: selKey, v: e.target.value })} />
        </label>
        <label className="field">Duration (min)
          <input type="number" inputMode="numeric" min={5} step={5} value={dur}
            onChange={(e) => setDurEdit({ key: selKey, v: e.target.value })} />
        </label>
      </div>
      <label className="field">Package name
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Gel Mani + Pedi Combo" autoCapitalize="words" />
      </label>
      {err && <div className="notice danger" style={{ marginBottom: 0 }}>{err}</div>}
      <button type="button" className="gold" onClick={create} disabled={busy}>+ Create package</button>
    </div>
  );
}
