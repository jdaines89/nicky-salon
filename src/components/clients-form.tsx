"use client";

import { ChevronDown, X } from "lucide-react";

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
import { useState } from "react";
import { Sheet } from "@/components/ui";
import { addClient, updateClient } from "@/lib/db";
import { estimatedPriorVisits, MAX_PRIOR_VISITS, validPhone } from "@/lib/salon";
import type { Client } from "@/lib/types";

/**
 * Add or edit a client. Birthday is stored as 'MM-DD' (no year); the date input
 * is only the friendliest way to pick a month and day on a phone.
 */
export function ClientForm({ editing, today, onClose, onSaved }: {
  editing: Client | null;
  today: string;
  onClose: () => void;
  onSaved: (client: Client | null, message: string) => void | Promise<void>;
}) {
  const [name, setName] = useState(editing?.name ?? "");
  const [phone, setPhone] = useState(editing?.phone ?? "");
  const [shape, setShape] = useState(editing?.shape ?? "");
  const [shade, setShade] = useState(editing?.shade ?? "");
  const bdayRaw = editing?.birthday && /^\d{2}-\d{2}$/.test(editing.birthday) ? editing.birthday : null;
  // A leap year, so 29 February survives the round trip.
  const [birthday, setBirthday] = useState(bdayRaw ? `2000-${bdayRaw}` : "");

  // Starting from an empty book makes the app confidently wrong about people
  // served for years: a long-standing regular gets badged "New Client", loyalty
  // reads 0 of 5, and she has no rhythm for months, so the Recall List and the
  // rebooking suggestion sit idle. Two remembered facts fix all of it at once.
  const existingPrior = editing?.prior_visits ?? [];
  const [priorOpen, setPriorOpen] = useState(false);
  const [priorCount, setPriorCount] = useState(String(existingPrior.length));
  const [priorEvery, setPriorEvery] = useState("4");

  const [err, setErr] = useState("");
  const [saving, setSaving] = useState(false);

  async function save() {
    const n = name.trim();
    if (!n) return setErr("Enter a name first.");
    if (phone.trim() && !validPhone(phone)) return setErr("Enter a valid 10-digit phone number (e.g. 0821234567).");
    const count = Math.max(0, Math.min(MAX_PRIOR_VISITS, Math.trunc(Number(priorCount) || 0)));
    const every = Math.max(1, Math.min(52, Math.trunc(Number(priorEvery) || 4)));
    const bday = birthday ? birthday.slice(5, 10) : null;
    // Only rebuild the estimate when the count actually changed — re-saving an
    // unrelated edit must not silently re-date someone's history under her.
    const prior = count !== existingPrior.length ? estimatedPriorVisits(count, every * 7, today) : existingPrior;
    const fields = {
      name: n, phone: phone.trim() || null, shape: shape.trim() || null, shade: shade.trim() || null,
      birthday: bday, prior_visits: prior,
    };
    setErr("");
    setSaving(true);
    try {
      if (editing) {
        await updateClient(editing.id, fields);
        await onSaved(null, `${n} updated.`);
      } else {
        const c = await addClient(fields);
        await onSaved(c, `${n} added to your client list.${count ? ` ${count} earlier visits recorded.` : ""}`);
      }
    } catch (e) {
      setErr(`Couldn't save: ${e instanceof Error ? e.message : e}`);
      setSaving(false);
    }
  }

  return (
    <Sheet title={editing ? "Edit client" : "Add client"} onClose={onClose}>
      <div className="stack">
        <label className="field">Full name
          <input value={name} onChange={(e) => setName(e.target.value)} autoComplete="off" autoFocus={!editing} />
        </label>
        <label className="field">Phone
          <input value={phone} onChange={(e) => setPhone(e.target.value)} type="tel" inputMode="tel" placeholder="082 123 4567" />
        </label>
        <div className="fields2">
          <label className="field">Preferred shape
            <input value={shape} onChange={(e) => setShape(e.target.value)} placeholder="e.g. Almond" />
          </label>
          <label className="field">Preferred shade
            <input value={shade} onChange={(e) => setShade(e.target.value)} placeholder="e.g. Nude pink" />
          </label>
        </div>
        {/* Day and month only: the year isn't kept, so asking for one (and
            scrolling a date picker back decades to find it) was wasted effort. */}
        <div className="field" role="group" aria-label="Birthday">Birthday
          <div className="row" style={{ flexWrap: "nowrap" }}>
            <select className="grow" aria-label="Birthday day" value={birthday ? String(Number(birthday.slice(8, 10))) : ""}
              onChange={(e) => setBirthday(e.target.value ? `2000-${birthday ? birthday.slice(5, 7) : "01"}-${e.target.value.padStart(2, "0")}` : "")}>
              <option value="">Day</option>
              {Array.from({ length: 31 }, (_, i) => <option key={i} value={i + 1}>{i + 1}</option>)}
            </select>
            <select style={{ flex: "2 1 0", minWidth: 0 }} aria-label="Birthday month" value={birthday ? birthday.slice(5, 7) : ""}
              onChange={(e) => setBirthday(e.target.value ? `2000-${e.target.value}-${birthday ? birthday.slice(8, 10) : "01"}` : "")}>
              <option value="">Month</option>
              {MONTHS.map((m, i) => <option key={m} value={String(i + 1).padStart(2, "0")}>{m}</option>)}
            </select>
            {birthday && <button type="button" className="ghost icon" onClick={() => setBirthday("")} aria-label="Clear birthday"><X size={18} /></button>}
          </div>
        </div>

        <div className="card tight" style={{ marginBottom: 0 }}>
          <button type="button" className="linkish" onClick={() => setPriorOpen(!priorOpen)}>
            <ChevronDown size={18} style={{ transform: priorOpen ? "none" : "rotate(-90deg)", transition: "transform .2s" }} /> Been here before this app?{existingPrior.length ? ` · ${existingPrior.length} recorded` : ""}
          </button>
          {priorOpen && (
            <div className="stack" style={{ marginTop: 10 }}>
              <p className="small muted" style={{ margin: 0 }}>
                Rough numbers are fine — they set her loyalty count and how often to expect her.
                Leave at 0 for someone genuinely new.
              </p>
              <div className="fields2">
                <label className="field">Visits before this app
                  <input type="number" inputMode="numeric" min={0} max={MAX_PRIOR_VISITS} step={1}
                    value={priorCount} onChange={(e) => setPriorCount(e.target.value)} />
                </label>
                <label className="field">Usually every … weeks
                  <input type="number" inputMode="numeric" min={1} max={52} step={1}
                    value={priorEvery} onChange={(e) => setPriorEvery(e.target.value)} />
                </label>
              </div>
              <p className="small muted" style={{ margin: 0 }}>
                These show as <b>estimates</b> in her visit history and count toward loyalty, never toward revenue.
                {existingPrior.length ? " Changing the number replaces what's recorded." : ""}
              </p>
            </div>
          )}
        </div>

        {err && <div className="notice danger" style={{ margin: 0 }}>{err}</div>}
        <div className="row end">
          <button className="ghost" onClick={onClose} disabled={saving}>Cancel</button>
          <button onClick={save} disabled={saving}>{saving ? "Saving…" : "Save client"}</button>
        </div>
      </div>
    </Sheet>
  );
}
