"use client";

import { useMemo, useState } from "react";
import { Coffee, Trash2 } from "lucide-react";
import { useSalon } from "@/components/data";
import { Seg, Sheet } from "@/components/ui";
import { DayStrip, DurationStepper, fmtDuration, TimeSlots, WHEN_CSS } from "@/components/when-picker";
import { addLocks, deleteLock, updateLock, type LockFields } from "@/lib/db";
import { addDays, CLOSE_MIN, fmtWeekdayDayMonth, LOCK_PREFIX, OPEN_MIN, weekday } from "@/lib/salon";
import type { TimeLock } from "@/lib/types";

const LABELS = ["Lunch", "Break", "Errand", "Personal", "Closed"];
type Repeat = "once" | "week" | "weekly";
const REPEATS: [Repeat, string][] = [["once", "Just this day"], ["week", "Rest of the week"], ["weekly", "Weekly, 4 weeks"]];
const ALL_DAY = CLOSE_MIN - OPEN_MIN;
const hhmm = (m: number) => `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;

/** The dates a new block covers: one day, the rest of that week (to Saturday), or the same weekday for four weeks. */
export function lockDates(date: string, repeat: Repeat): string[] {
  if (repeat === "weekly") return [0, 7, 14, 21].map((n) => addDays(date, n));
  if (repeat === "week") {
    const out: string[] = [];
    for (let d = date; weekday(d) <= 5 && out.length < 7; d = addDays(d, 1)) { out.push(d); if (weekday(d) === 5) break; }
    return out.length ? out : [date];
  }
  return [date];
}

/**
 * Block out time: lunch, a break, an errand, a day off. Blocked time isn't
 * offered when she books, and it shows in the diary like a booking, so the
 * day reads true at a glance.
 */
export function LockSheet({ lock, date: startDate, time: startTime, onClose, onDone }: {
  lock?: TimeLock; date: string; time?: string; onClose: () => void; onDone: (msg: string) => void;
}) {
  const { bookings, busy: busyTimes, today, reload } = useSalon();
  const [label, setLabel] = useState(lock?.label ?? "Lunch");
  const [date, setDate] = useState(lock?.date ?? startDate);
  const [time, setTime] = useState<string | null>(lock?.time.slice(0, 5) ?? startTime ?? null);
  const [duration, setDuration] = useState(lock?.duration_minutes ?? 60);
  const [repeat, setRepeat] = useState<Repeat>("once");
  const [error, setError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [busy, setBusy] = useState(false);
  const allDay = time === hhmm(OPEN_MIN) && duration === ALL_DAY;
  const others = useMemo(() => busyTimes.filter((b) => b.id !== (lock ? LOCK_PREFIX + lock.id : "")), [busyTimes, lock]);
  const dates = lock ? [date] : lockDates(date, repeat);

  async function save() {
    setError(null);
    if (!label.trim()) return setError("Say what the time is for, e.g. Lunch.");
    if (!time) return setError("Pick a start time.");
    const f: LockFields = { date, time, duration_minutes: duration, label: label.trim() };
    setBusy(true);
    try {
      if (lock) await updateLock(lock.id, f);
      else await addLocks(dates.map((d) => ({ ...f, date: d })));
      await reload();
      onDone(lock ? `${f.label} updated.` : dates.length > 1 ? `${f.label} blocked on ${dates.length} days.` : `${f.label} blocked on ${fmtWeekdayDayMonth(date)}.`);
      onClose();
    } catch (e) {
      setError(`Couldn't save: ${e instanceof Error ? e.message : String(e)}`);
      setBusy(false);
    }
  }

  async function remove() {
    if (!lock) return;
    setBusy(true);
    try {
      await deleteLock(lock.id);
      await reload();
      onDone(`${lock.label} removed. That time is free again.`);
      onClose();
    } catch (e) {
      setError(`Couldn't remove it: ${e instanceof Error ? e.message : String(e)}`);
      setBusy(false);
    }
  }

  return (
    <Sheet title={lock ? "Blocked time" : "Block out time"} onClose={onClose}>
      <style>{WHEN_CSS}</style>
      <div className="stack bs">
        <div className="section">
          <div className="section-label"><Coffee size={14} />What for</div>
          <div className="lk-chips">
            {LABELS.map((l) => (
              <button type="button" key={l} className={`ts-slot${label === l ? " on" : ""}`} aria-pressed={label === l} onClick={() => setLabel(l)}>{l}</button>
            ))}
          </div>
          <input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Or type your own" aria-label="What for" style={{ marginTop: 10 }} />
        </div>

        <div className="section">
          <div className="section-label">When</div>
          <DayStrip value={date} onChange={setDate} today={today} bookings={bookings} pastDays={lock ? 14 : 0} />
          <div className="bs-dur">
            {allDay ? (
              <div className="dur"><div className="dur-v"><b>All day</b><button type="button" className="linkish" onClick={() => { setDuration(60); setTime(null); }}>Just part of the day</button></div></div>
            ) : (
              <DurationStepper value={duration} onChange={setDuration} auto onAuto={() => setDuration(60)} autoValue={60} autoText="how long" />
            )}
          </div>
          {!allDay && (
            <>
              <TimeSlots date={date} time={time} onChange={setTime} duration={duration} bookings={others} today={today} allowPast />
              <button type="button" className="soft pill" style={{ marginTop: 6 }} onClick={() => { setTime(hhmm(OPEN_MIN)); setDuration(ALL_DAY); }}>Block the whole day</button>
            </>
          )}
        </div>

        {!lock && (
          <div className="stack" style={{ gap: 6 }}>
            <span className="bk-label">Repeat</span>
            <div className="bk-segfull"><Seg value={repeat} options={REPEATS} onChange={setRepeat} /></div>
            {dates.length > 1 && <p className="small muted" style={{ margin: 0 }}>{dates.length} days: {dates.map((d) => fmtWeekdayDayMonth(d).split(" ").slice(0, 2).join(" ")).join(", ")}. You can lift any one of them later.</p>}
          </div>
        )}

        <div className="bk-foot">
          {error && <div className="notice danger" role="alert" style={{ margin: 0 }}>{error}</div>}
          {confirmDelete ? (
            <div className="bk-clash">
              <strong>Remove this block?</strong>
              The time opens up for bookings again.
              <div className="row" style={{ marginTop: 10 }}>
                <button type="button" className="danger" disabled={busy} onClick={remove}>Yes, remove</button>
                <button type="button" className="ghost" disabled={busy} onClick={() => setConfirmDelete(false)}>Keep it</button>
              </div>
            </div>
          ) : (
            <div className="bk-actions">
              {lock && <button type="button" className="danger icon" aria-label="Remove blocked time" disabled={busy} onClick={() => setConfirmDelete(true)}><Trash2 size={19} /></button>}
              <button type="button" className="bs-go" disabled={busy} onClick={save}>
                {busy ? "Saving…" : lock ? "Save changes" : time ? `Block ${allDay ? "the day" : `${time}, ${fmtDuration(duration)}`}` : "Block time"}
              </button>
            </div>
          )}
        </div>
      </div>
    </Sheet>
  );
}

export const LOCKS_CSS = `
.lk-chips { display: grid; grid-template-columns: repeat(auto-fit, minmax(92px, 1fr)); gap: 8px; }
button.bk-lock { position: absolute; min-height: 0; padding: 6px 10px; border-radius: 12px; border: 1.5px dashed var(--line-2); color: var(--ink-2);
  background: repeating-linear-gradient(135deg, var(--paper) 0 8px, var(--paper-2) 8px 16px);
  flex-direction: column; align-items: flex-start; justify-content: flex-start; gap: 1px; text-align: left; overflow: hidden; font-size: 15px; line-height: 1.25; z-index: 1; }
button.bk-lock.short { flex-direction: row; align-items: center; gap: 8px; padding-top: 0; padding-bottom: 0; }
button.bk-lock b { display: flex; align-items: center; gap: 6px; font-weight: 700; }
button.bk-lock span { font-size: 13.5px; color: var(--ink-soft); font-weight: 600; }
`;
