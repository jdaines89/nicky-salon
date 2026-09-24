"use client";

import { AlertTriangle, ChevronRight, Plus } from "lucide-react";
import { useMemo, useState } from "react";
import { useSalon } from "@/components/data";
import { rand, Seg, Sheet } from "@/components/ui";
import { DayStrip, DurationStepper, TimeSlots, WHEN_CSS } from "@/components/when-picker";
import {
  ClientPicker, phoneProblem, resolveClient, serviceOptions, ServicePicker,
  type ClientChoice, type Line,
} from "@/components/bookings-shared";
import { addClient, cancelSeries, createSeries, type PickedService } from "@/lib/db";
import { addDays, computeRecurringDates, findCollision, fmtDayMonShort, fmtDayMonth, freqLabel } from "@/lib/salon";
import type { BookingStatus, BookingWithServices, RecurringEndType } from "@/lib/types";

const FREQS: ["7" | "14" | "28", string][] = [["7", freqLabel(7)], ["14", freqLabel(14)], ["28", freqLabel(28)]];

/** A standing appointment: one series, every visit booked up front. */
export function RecurringSheet({ onClose, onDone }: { onClose: () => void; onDone: (msg: string) => void }) {
  const { clients, services, bookings, clientById, today, reload } = useSalon();
  const opts = useMemo(() => serviceOptions(services), [services]);
  const [choice, setChoice] = useState<ClientChoice>({ kind: "none" });
  const [start, setStart] = useState(today);
  const [time, setTime] = useState<string | null>(null);
  const [lines, setLines] = useState<Line[]>([]);
  const [durTouched, setDurTouched] = useState(false);
  const [durText, setDurText] = useState("");
  const [freq, setFreq] = useState<"7" | "14" | "28">("7");
  const [endType, setEndType] = useState<RecurringEndType>("count");
  const [count, setCount] = useState("6");
  const [endDate, setEndDate] = useState<string | null>(null);
  const [status, setStatus] = useState<BookingStatus>("confirmed");
  const [notes, setNotes] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const suggested = lines.reduce((s, l) => s + l.duration, 0) || 30;
  const duration = durTouched ? parseInt(durText, 10) || 0 : suggested;
  const perVisit = lines.reduce((s, l) => s + l.price, 0);
  const freqDays = Number(freq);
  const until = endDate ?? (start ? addDays(start, 90) : today);
  const nVisits = Math.min(24, Math.max(1, parseInt(count, 10) || 1));
  const dates = start ? computeRecurringDates(start, freqDays, endType, nVisits, until) : [];
  const timeOk = time != null && /^\d{2}:\d{2}$/.test(time);
  const clashes = timeOk ? dates.filter((d) => findCollision(bookings, d, time!, duration || 30)) : [];

  async function create() {
    setError(null);
    if (choice.kind === "none" || (choice.kind === "new" && !choice.name.trim())) return setError("Pick a client, or add a new one.");
    if (!lines.length) return setError("Choose at least one service.");
    let client = resolveClient(choice, clients, clientById);
    const bad = !client ? phoneProblem(choice) : null;
    if (bad) return setError(bad);
    if (!start || !timeOk) return setError("Choose the first visit's date and time.");
    if (duration < 5) return setError("Duration must be at least 5 minutes.");
    setBusy(true);
    try {
      if (!client && choice.kind === "new") client = await addClient({ name: choice.name.trim(), phone: choice.phone.trim() || null });
      if (!client) throw new Error("No client chosen.");
      const payload: PickedService[] = lines.map((l) => ({ service_id: l.service_id, service_name: l.name, price: l.price }));
      const created = await createSeries({
        client_id: client.id, start_date: start, time: time!, duration_minutes: duration, freq_days: freqDays, end_type: endType,
        end_count: endType === "count" ? nVisits : null, end_date: endType === "until" ? until : null,
        status, notes: notes.trim() || null,
      }, payload);
      await reload();
      onDone(`Recurring booking created: ${created.length} visits scheduled for ${client.name}.`);
      onClose();
    } catch (e) {
      setError(`Couldn't create the series: ${e instanceof Error ? e.message : String(e)}`);
      await reload().catch(() => undefined);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Sheet title="Recurring booking" onClose={onClose}>
      <style>{WHEN_CSS}</style>
      <div className="stack bs">
        <div className="section">
          <div className="section-label">Client</div>
          <ClientPicker clients={clients} byId={clientById} value={choice} onChange={setChoice} />
        </div>
        <div className="section">
          <div className="section-label">Services</div>
          <ServicePicker opts={opts} lines={lines} onChange={setLines} />
        </div>
        <div className="section">
          <div className="section-label">First visit</div>
          <DayStrip value={start} onChange={setStart} today={today} bookings={bookings} />
          <div className="bs-dur">
            <DurationStepper value={duration} onChange={(n) => { setDurTouched(true); setDurText(String(n)); }}
              auto={!durTouched || duration === suggested} onAuto={() => setDurTouched(false)} autoValue={suggested} />
          </div>
          <TimeSlots date={start} time={time} onChange={setTime} duration={duration || 30} bookings={bookings} today={today} />
        </div>
        <div className="stack" style={{ gap: 6 }}>
          <span className="bk-label">How often</span>
          <div className="bk-segfull"><Seg value={freq} options={FREQS} onChange={setFreq} /></div>
        </div>
        <div className="stack" style={{ gap: 6 }}>
          <span className="bk-label">Ends</span>
          <div className="bk-segfull"><Seg value={endType} options={[["count", "After N visits"], ["until", "On a date"]]} onChange={setEndType} /></div>
        </div>
        {endType === "count" ? (
          <label className="field">Number of visits
            <input type="number" inputMode="numeric" min={1} max={24} value={count} onChange={(e) => setCount(e.target.value)} />
          </label>
        ) : (
          <label className="field">Last visit by
            <input type="date" value={until} min={start} onChange={(e) => setEndDate(e.target.value)} />
          </label>
        )}
        <div className="notice" style={{ margin: 0 }}>
          <b>{dates.length} visit{dates.length !== 1 ? "s" : ""}:</b> {dates.map(fmtDayMonShort).join(", ")}
        </div>
        {clashes.length > 0 && (
          <div className="bk-clash" role="alert">
            <strong><AlertTriangle size={18} /> {clashes.length} of these overlap another booking</strong>
            {clashes.map(fmtDayMonth).join(", ")} at {time}. They&apos;ll still be booked; move those visits afterwards if needed.
          </div>
        )}
        <div className="stack" style={{ gap: 6 }}>
          <span className="bk-label">Status</span>
          <div className="bk-segfull"><Seg value={status} options={[["confirmed", "Confirmed"], ["pending", "Pending"]]} onChange={setStatus} /></div>
        </div>
        <label className="field">Comments
          <textarea value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Applies to every visit in the series." />
        </label>
        <div className="bk-foot">
          {error && <div className="notice danger" role="alert" style={{ margin: 0 }}>{error}</div>}
          <div className="bs-sum">
            <div className="grow">
              <div className="bs-when">{dates.length} visit{dates.length !== 1 ? "s" : ""}, {freqLabel(freqDays).toLowerCase()}{time ? ` at ${time}` : ""}</div>
              <div className="small muted">per visit</div>
            </div>
            <div className="bs-total">{rand(perVisit)}</div>
          </div>
          <div className="bk-actions">
            <button type="button" className="bs-go" disabled={busy} onClick={create}>{busy ? "Creating…" : "Create series"}</button>
          </div>
        </div>
      </div>
    </Sheet>
  );
}

/** Every series, with its upcoming visits one tap from editing. */
export function SeriesList({ onEdit, onNew, onDone }: {
  onEdit: (b: BookingWithServices) => void; onNew: () => void; onDone: (msg: string) => void;
}) {
  const { series, bookings, clientById, today, reload } = useSalon();
  const [confirm, setConfirm] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function cancel(id: string) {
    setBusy(true);
    try {
      await cancelSeries(id);
      await reload();
      onDone("Recurring series cancelled. Past visits stay on record.");
      setConfirm(null);
    } catch (e) {
      onDone(`Couldn't cancel: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBusy(false);
    }
  }

  const rows = series.filter((s) => s.client_id && clientById.has(s.client_id));
  return (
    <>
      <div className="row" style={{ marginBottom: 12 }}>
        <h2 className="grow" style={{ margin: 0 }}>Recurring bookings</h2>
        <button onClick={onNew}><Plus size={17} />New recurring</button>
      </div>
      {!rows.length && <div className="card"><p className="muted" style={{ margin: 0 }}>No recurring bookings yet. Start one above for a client who comes like clockwork.</p></div>}
      {rows.map((s) => {
        const client = clientById.get(s.client_id!)!;
        const appts = bookings.filter((b) => b.series_id === s.id).sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time));
        const future = appts.filter((b) => b.date >= today);
        const names = [...new Set(appts.flatMap((b) => b.booking_services.map((bs) => bs.service_name)))].sort().join(", ");
        const active = s.active !== false;
        return (
          <div key={s.id} className="card">
            <div className="row" style={{ alignItems: "flex-start" }}>
              <div className="grow">
                <h3 style={{ margin: 0 }}>{client.name} · {freqLabel(s.freq_days)}</h3>
                <div className="small muted">{names || "—"} · {appts.length} visit{appts.length !== 1 ? "s" : ""}</div>
              </div>
              <span className={`badge ${active ? "" : "muted"}`}>{active ? "Active" : "Cancelled"}</span>
            </div>
            {future.length > 0 && (
              <>
                <div className="small muted" style={{ marginTop: 10 }}>Upcoming visits</div>
                <div className="list bk-rows">
                  {future.map((b) => (
                    <button key={b.id} className="item" onClick={() => onEdit(b)}>
                      <span className="time">{b.time.slice(0, 5)}</span>
                      <div className="grow"><div className="title">{fmtDayMonth(b.date)}</div>
                        <div className="meta">{b.status === "cancelled" ? "Cancelled" : b.status === "pending" ? "Pending" : b.status === "no-show" ? "No-show" : "Confirmed"}</div></div>
                      <ChevronRight size={18} className="chev" />
                    </button>
                  ))}
                </div>
              </>
            )}
            {active && future.length > 0 && (confirm === s.id ? (
              <div className="bk-clash" style={{ marginTop: 10 }}>
                <strong>Cancel the remaining {future.length} visit{future.length !== 1 ? "s" : ""}?</strong>
                They&apos;ll be removed from the diary. Past visits stay on record.
                <div className="row" style={{ marginTop: 10 }}>
                  <button className="danger" disabled={busy} onClick={() => cancel(s.id)}>Yes, cancel them</button>
                  <button className="ghost" disabled={busy} onClick={() => setConfirm(null)}>Keep them</button>
                </div>
              </div>
            ) : (
              <div className="row end" style={{ marginTop: 10 }}>
                <button className="danger" onClick={() => setConfirm(s.id)}>Cancel remaining</button>
              </div>
            ))}
          </div>
        );
      })}
    </>
  );
}
