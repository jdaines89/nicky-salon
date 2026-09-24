"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { CalendarDays, ChevronLeft, ChevronRight, Minus, Plus, Sparkles } from "lucide-react";
import {
  addDays, CLOSE_MIN, dayOfMonth, findCollision, freeGaps, monthBounds, monthName, nowSa, OPEN_MIN, toMinutes, weekday,
} from "@/lib/salon";
import type { BookingWithServices } from "@/lib/types";

/*
 * Picking when, without a native date or time control. The phone's own time
 * picker is a clock face or a fiddly wheel; here every choice is a tap on
 * something big: a day from a strip, then a free time from a grid of times
 * that are already known to fit. Busy times simply aren't offered, so a
 * double-booking takes deliberate effort (Another time) instead of a slip.
 */

const DOW1 = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const DOW_LETTER = ["M", "T", "W", "T", "F", "S", "S"];
export const hhmm = (min: number) => `${String(Math.floor(min / 60)).padStart(2, "0")}:${String(min % 60).padStart(2, "0")}`;
const STEP = 15;

type Live = (b: BookingWithServices) => boolean;
const blocks: Live = (b) => b.status !== "cancelled" && b.status !== "no-show";

function useDayCounts(bookings: BookingWithServices[], excludeId?: string | null) {
  return useMemo(() => {
    const m = new Map<string, number>();
    for (const b of bookings) if (blocks(b) && b.id !== excludeId) m.set(b.date, (m.get(b.date) ?? 0) + 1);
    return m;
  }, [bookings, excludeId]);
}

// ------------------------------------------------------------------ day strip

export function DayStrip({ value, onChange, today, bookings, excludeId, pastDays = 0 }: {
  value: string; onChange: (d: string) => void; today: string; bookings: BookingWithServices[];
  excludeId?: string | null; pastDays?: number;
}) {
  const counts = useDayCounts(bookings, excludeId);
  const [calOpen, setCalOpen] = useState(false);
  const start = value < addDays(today, -pastDays) ? value : addDays(today, -pastDays);
  const end = value > addDays(today, 90) ? value : addDays(today, 90);
  const days = useMemo(() => {
    const out: string[] = [];
    for (let d = start; d <= end; d = addDays(d, 1)) out.push(d);
    return out;
  }, [start, end]);
  const scroller = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = scroller.current?.querySelector<HTMLElement>(`[data-day="${value}"]`);
    if (el && scroller.current) {
      const box = scroller.current;
      box.scrollTo({ left: el.offsetLeft - box.clientWidth / 2 + el.clientWidth / 2, behavior: "smooth" });
    }
  }, [value]);

  const label = value === today ? "Today" : value === addDays(today, 1) ? "Tomorrow" : `${DOW1[weekday(value)]} ${dayOfMonth(value)} ${monthName(value).slice(0, 3)}`;
  return (
    <div className="wp">
      <div className="wp-head">
        <span className="wp-month">{monthName(value)} <span className="muted">{value.slice(0, 4)}</span></span>
        <span className="wp-sel">{label}</span>
        <button type="button" className="ghost icon pill" style={{ width: 40, minHeight: 40 }} aria-label="Pick from a calendar" aria-expanded={calOpen}
          onClick={() => setCalOpen(!calOpen)}><CalendarDays size={18} /></button>
      </div>
      {calOpen ? (
        <MonthGrid value={value} today={today} counts={counts} onPick={(d) => { onChange(d); setCalOpen(false); }} />
      ) : (
        <div className="wp-strip" ref={scroller} role="listbox" aria-label="Day">
          {days.map((d) => {
            const n = counts.get(d) ?? 0;
            const cls = ["wp-day", d === value && "on", d === today && "today", d < today && "past", weekday(d) === 6 && "sun"].filter(Boolean).join(" ");
            return (
              <button type="button" key={d} data-day={d} role="option" aria-selected={d === value} className={cls} onClick={() => onChange(d)}
                aria-label={`${DOW1[weekday(d)]} ${dayOfMonth(d)} ${monthName(d)}, ${n ? `${n} booked` : "free"}`}>
                <span className="dow">{d === today ? "Today" : DOW1[weekday(d)]}</span>
                <span className="dn">{dayOfMonth(d)}</span>
                <span className="dots" aria-hidden>
                  {n === 0 ? <i className="free" /> : Array.from({ length: Math.min(n, 4) }, (_, i) => <i key={i} />)}
                </span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

function MonthGrid({ value, today, counts, onPick }: { value: string; today: string; counts: Map<string, number>; onPick: (d: string) => void }) {
  const [anchor, setAnchor] = useState(value.slice(0, 7) + "-01");
  const [first, last] = monthBounds(anchor);
  const gridStart = addDays(first, -weekday(first));
  const cells: string[] = [];
  for (let d = gridStart; d <= last || weekday(d) !== 0; d = addDays(d, 1)) cells.push(d);
  const shift = (n: number) => {
    const y = Number(anchor.slice(0, 4)), m = Number(anchor.slice(5, 7)) - 1 + n;
    setAnchor(`${y + Math.floor(m / 12)}-${String((((m % 12) + 12) % 12) + 1).padStart(2, "0")}-01`);
  };
  return (
    <div className="wp-cal">
      <div className="wp-calnav">
        <button type="button" className="ghost icon pill" style={{ width: 40, minHeight: 40 }} aria-label="Previous month" onClick={() => shift(-1)}><ChevronLeft size={18} /></button>
        <b className="grow" style={{ textAlign: "center" }}>{monthName(anchor)} {anchor.slice(0, 4)}</b>
        <button type="button" className="ghost icon pill" style={{ width: 40, minHeight: 40 }} aria-label="Next month" onClick={() => shift(1)}><ChevronRight size={18} /></button>
      </div>
      <div className="wp-grid">
        {DOW_LETTER.map((l, i) => <span key={i} className="h">{l}</span>)}
        {cells.map((d) => d.slice(0, 7) !== anchor.slice(0, 7) ? <span key={d} /> : (
          <button type="button" key={d} onClick={() => onPick(d)}
            className={["c", d === value && "on", d === today && "today", d < today && "past"].filter(Boolean).join(" ")}>
            {dayOfMonth(d)}{(counts.get(d) ?? 0) > 0 && <i />}
          </button>
        ))}
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ the day at a glance

/** A slim bar of the working day: what's booked, and where this booking would land. */
export function DayGlance({ date, time, duration, bookings, excludeId, clash }: {
  date: string; time: string | null; duration: number; bookings: BookingWithServices[]; excludeId?: string | null; clash?: boolean;
}) {
  const span = CLOSE_MIN - OPEN_MIN;
  const pct = (m: number) => `${(Math.min(Math.max(m - OPEN_MIN, 0), span) / span) * 100}%`;
  const day = bookings.filter((b) => b.date === date && b.id !== excludeId && blocks(b));
  const s = time ? toMinutes(time) : null;
  return (
    <div className="wp-glance" aria-hidden>
      <div className="track">
        {day.map((b) => {
          const a = toMinutes(b.time), e = a + (b.duration_minutes || 30);
          return <span key={b.id} className="busy" style={{ left: pct(a), width: `calc(${pct(e)} - ${pct(a)})` }} />;
        })}
        {s != null && <span className={`me${clash ? " clash" : ""}`} style={{ left: pct(s), width: `calc(${pct(s + duration)} - ${pct(s)})` }} />}
      </div>
      <div className="ticks"><span>8am</span><span>11</span><span>2pm</span><span>5</span><span>7pm</span></div>
    </div>
  );
}

// ------------------------------------------------------------------ times

interface Slot { min: number; snug: boolean }

/** Every start time on the quarter hour that fits `duration` without touching another booking. */
export function freeStarts(bookings: BookingWithServices[], date: string, duration: number, excludeId: string | null, notBefore: number | null): Slot[] {
  const day = bookings.filter((b) => b.date === date && b.id !== excludeId);
  const gaps = freeGaps(day);
  // "Snug" starts butt against existing work, keeping her day in one block
  // rather than leaving her an unsellable 45 minutes between two clients.
  const edges = new Set<number>();
  for (const [a, b] of gaps) {
    if (a !== OPEN_MIN) edges.add(a);
    if (b !== CLOSE_MIN) edges.add(b - duration);
  }
  const out: Slot[] = [];
  for (const [a, b] of gaps) {
    const first = Math.ceil(a / STEP) * STEP;
    const cands = new Set<number>();
    for (let m = first; m + duration <= b; m += STEP) cands.add(m);
    // A gap that starts or ends off the quarter hour still offers its exact edge.
    if (a + duration <= b) cands.add(a);
    if (b - duration >= a && b !== CLOSE_MIN) cands.add(b - duration);
    for (const m of cands) {
      if (notBefore != null && m < notBefore) continue;
      if (findCollision(day, date, hhmm(m), duration, excludeId)) continue;
      out.push({ min: m, snug: day.some(blocks) && edges.has(m) });
    }
  }
  return out.sort((x, y) => x.min - y.min);
}

const PARTS: [string, number, number][] = [["Morning", 0, 12 * 60], ["Afternoon", 12 * 60, 17 * 60], ["Evening", 17 * 60, 24 * 60]];

export function TimeSlots({ date, time, onChange, duration, bookings, excludeId, today, allowPast }: {
  date: string; time: string | null; onChange: (t: string) => void; duration: number;
  bookings: BookingWithServices[]; excludeId?: string | null; today: string; allowPast?: boolean;
}) {
  const now = nowSa();
  // Today only offers what's still ahead, less an hour: a walk-in who sat
  // down twenty minutes ago still needs her booking entered.
  const notBefore = !allowPast && date === today ? now.hour * 60 + now.minute - 60 : null;
  const slots = useMemo(() => freeStarts(bookings, date, duration, excludeId ?? null, notBefore), [bookings, date, duration, excludeId, notBefore]);
  const chosen = time ? toMinutes(time) : null;
  const chosenListed = chosen != null && slots.some((s) => s.min === chosen);
  const [custom, setCustom] = useState(false);
  useEffect(() => { if (chosen != null && !chosenListed) setCustom(true); }, [chosen, chosenListed]);

  return (
    <div className="ts">
      {slots.length === 0 && (
        <p className="ts-none">
          {notBefore != null && notBefore >= CLOSE_MIN ? "The day's done. Pick another day, or use Another time." : `No ${duration}-minute gap left on this day. Pick another day, or use Another time for a squeeze-in.`}
        </p>
      )}
      {PARTS.map(([label, from, to]) => {
        const here = slots.filter((s) => s.min >= from && s.min < to);
        if (!here.length) return null;
        return (
          <div key={label} className="ts-part">
            <div className="ts-label">{label}<span>{here.length} free</span></div>
            <div className="ts-grid">
              {here.map((s) => (
                <button type="button" key={s.min} className={`ts-slot${s.min === chosen ? " on" : ""}${s.snug ? " snug" : ""}`}
                  aria-pressed={s.min === chosen} onClick={() => { setCustom(false); onChange(hhmm(s.min)); }}>
                  {hhmm(s.min)}{s.snug && <Sparkles size={11} className="spark" aria-label="fits right next to another booking" />}
                </button>
              ))}
            </div>
          </div>
        );
      })}
      <div className="ts-foot">
        {slots.some((s) => s.snug) && <span className="small muted"><Sparkles size={12} style={{ verticalAlign: -1, color: "var(--gold)" }} /> keeps your day in one block</span>}
        <button type="button" className="linkish" style={{ marginLeft: "auto" }} onClick={() => setCustom(!custom)}>{custom ? "Hide other times" : "Another time…"}</button>
      </div>
      {custom && <ClockChips value={time} onChange={onChange} />}
    </div>
  );
}

/** Any time at all, in two taps: an hour, then the minutes. For squeeze-ins and odd starts. */
export function ClockChips({ value, onChange }: { value: string | null; onChange: (t: string) => void }) {
  const h = value ? Number(value.slice(0, 2)) : null;
  const m = value ? Number(value.slice(3, 5)) : null;
  const hours = Array.from({ length: 15 }, (_, i) => i + 6); // 06:00–20:00
  const mins = Array.from({ length: 12 }, (_, i) => i * 5);
  const set = (hh: number, mm: number) => onChange(hhmm(hh * 60 + mm));
  return (
    <div className="cc">
      <div className="ts-label">Hour</div>
      <div className="cc-grid h">
        {hours.map((x) => (
          <button type="button" key={x} className={`ts-slot${x === h ? " on" : ""}`} onClick={() => set(x, m ?? 0)}>
            {x > 12 ? x - 12 : x}<small>{x < 12 ? "am" : "pm"}</small>
          </button>
        ))}
      </div>
      <div className="ts-label">Minutes</div>
      <div className="cc-grid m">
        {mins.map((x) => (
          <button type="button" key={x} className={`ts-slot${x === m ? " on" : ""}`} onClick={() => set(h ?? 9, x)}>:{String(x).padStart(2, "0")}</button>
        ))}
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ duration

export function fmtDuration(min: number): string {
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60), m = min % 60;
  return m ? `${h} h ${m}` : `${h} hour${h > 1 ? "s" : ""}`;
}

/** Plus and minus in 15s: no keyboard, no typing minutes into a box. */
export function DurationStepper({ value, onChange, auto, onAuto, autoValue }: {
  value: number; onChange: (n: number) => void; auto: boolean; onAuto: () => void; autoValue: number;
}) {
  return (
    <div className="dur">
      <button type="button" className="ghost icon pill" aria-label="15 minutes shorter" disabled={value <= 15} onClick={() => onChange(Math.max(15, value - 15))}><Minus size={18} /></button>
      <div className="dur-v">
        <b>{fmtDuration(value)}</b>
        {auto ? <span>from the services</span>
          : <button type="button" className="linkish" onClick={onAuto}>Reset to {fmtDuration(autoValue)}</button>}
      </div>
      <button type="button" className="ghost icon pill" aria-label="15 minutes longer" disabled={value >= 480} onClick={() => onChange(Math.min(480, value + 15))}><Plus size={18} /></button>
    </div>
  );
}

export const WHEN_CSS = `
.wp-head { display: flex; align-items: center; gap: 10px; margin-bottom: 10px; }
.wp-month { font-family: var(--serif); font-size: 19px; font-weight: 450; letter-spacing: -0.01em; }
.wp-sel { margin-left: auto; font-size: 13px; font-weight: 700; color: var(--teal-2); background: var(--teal-soft); padding: 4px 10px; border-radius: 999px; white-space: nowrap; }
.wp-strip { display: flex; gap: 8px; overflow-x: auto; scroll-snap-type: x proximity; scrollbar-width: none; padding: 2px 2px 6px; margin: 0 -14px; padding-left: 14px; padding-right: 14px; }
.wp-strip::-webkit-scrollbar { display: none; }
button.wp-day { flex: none; scroll-snap-align: center; width: 58px; min-height: 76px; padding: 8px 0 7px; border-radius: 18px; flex-direction: column; gap: 2px;
  background: var(--paper); color: var(--ink); border: 1.5px solid transparent; }
button.wp-day:hover { background: var(--teal-mist); }
button.wp-day .dow { font-size: 11.5px; font-weight: 700; color: var(--ink-soft); letter-spacing: 0.02em; }
button.wp-day .dn { font-family: var(--serif); font-size: 23px; font-weight: 450; line-height: 1.05; font-variant-numeric: lining-nums; }
button.wp-day .dots { display: flex; gap: 3px; height: 6px; align-items: center; }
button.wp-day .dots i { width: 5px; height: 5px; border-radius: 50%; background: var(--teal-3); }
button.wp-day .dots i.free { background: transparent; border: 1px solid var(--ink-faint); }
button.wp-day.today .dow { color: var(--gold-2); }
button.wp-day.past { opacity: 0.55; }
button.wp-day.sun .dow { color: var(--rose); }
button.wp-day.on { background: var(--teal); color: var(--on-accent); border-color: var(--teal); box-shadow: 0 8px 18px -8px rgba(15,59,56,0.7); }
button.wp-day.on .dow { color: color-mix(in srgb, var(--on-accent) 75%, transparent); }
button.wp-day.on .dots i { background: var(--gold); }
button.wp-day.on .dots i.free { border-color: color-mix(in srgb, var(--on-accent) 60%, transparent); background: transparent; }

.wp-cal { animation: pop .18s var(--ease) both; }
.wp-calnav { display: flex; align-items: center; gap: 8px; margin-bottom: 6px; }
.wp-grid { display: grid; grid-template-columns: repeat(7, minmax(0, 1fr)); gap: 4px; }
.wp-grid .h { text-align: center; font-size: 11px; font-weight: 700; color: var(--ink-soft); padding: 4px 0; }
.wp-grid button.c { min-height: 44px; padding: 0; border-radius: 14px; background: none; color: var(--ink); border: 0; font-weight: 600; position: relative; flex-direction: column; gap: 0; }
.wp-grid button.c:hover { background: var(--teal-mist); }
.wp-grid button.c i { width: 4px; height: 4px; border-radius: 50%; background: var(--teal-3); position: absolute; bottom: 6px; }
.wp-grid button.c.today { color: var(--gold-2); font-weight: 800; }
.wp-grid button.c.past { color: var(--ink-faint); }
.wp-grid button.c.on { background: var(--teal); color: var(--on-accent); }
.wp-grid button.c.on i { background: var(--gold); }

.wp-glance { margin: 14px 0 4px; }
.wp-glance .track { position: relative; height: 12px; border-radius: 99px; background: repeating-linear-gradient(90deg, var(--paper-2) 0 1px, var(--teal-mist) 1px calc(100% / 11)); overflow: hidden; }
.wp-glance .busy { position: absolute; top: 0; bottom: 0; background: var(--busy); border-radius: 3px; }
.wp-glance .me { position: absolute; top: 0; bottom: 0; background: var(--gold); border-radius: 3px; box-shadow: 0 0 0 2px var(--card); transition: left .25s var(--ease), width .25s var(--ease); }
.wp-glance .me.clash { background: var(--danger); }
.wp-glance .ticks { display: flex; justify-content: space-between; font-size: 10.5px; color: var(--ink-soft); margin-top: 4px; font-weight: 600; }

.ts { margin-top: 12px; }
.ts-part { margin-bottom: 12px; }
.ts-label { display: flex; align-items: baseline; gap: 8px; font-size: 12px; font-weight: 700; color: var(--ink-2); margin: 0 0 8px; letter-spacing: 0.02em; }
.ts-label span { font-weight: 600; color: var(--ink-soft); font-size: 11.5px; }
.ts-grid { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 8px; }
@media (min-width: 480px) { .ts-grid { grid-template-columns: repeat(5, minmax(0, 1fr)); } }
button.ts-slot { position: relative; min-height: 48px; padding: 0 2px; border-radius: 14px; background: var(--paper); color: var(--ink); border: 1.5px solid transparent;
  font-size: 15.5px; font-weight: 650; font-variant-numeric: tabular-nums; min-width: 0; gap: 1px; }
button.ts-slot small { font-size: 11px; font-weight: 600; color: var(--ink-soft); }
button.ts-slot:hover { background: var(--teal-mist); border-color: var(--teal-soft); }
button.ts-slot.snug { background: var(--gold-soft); }
button.ts-slot .spark { position: absolute; top: 5px; right: 6px; color: var(--gold-2); }
button.ts-slot.on { background: var(--teal); color: var(--on-accent); border-color: var(--teal); box-shadow: 0 8px 18px -8px rgba(15,59,56,0.7); }
button.ts-slot.on small, button.ts-slot.on .spark { color: color-mix(in srgb, var(--on-accent) 80%, transparent); }
.ts-none { margin: 4px 0 12px; padding: 14px; border-radius: 14px; background: var(--paper); color: var(--ink-2); font-size: 14px; text-align: center; }
.ts-foot { display: flex; align-items: center; gap: 8px; min-height: 32px; }
.cc { margin-top: 12px; padding-top: 12px; border-top: 1px dashed var(--line-2); animation: pop .18s var(--ease) both; }
.cc-grid { display: grid; gap: 6px; margin-bottom: 12px; }
.cc-grid.h { grid-template-columns: repeat(5, minmax(0, 1fr)); }
.cc-grid.m { grid-template-columns: repeat(6, minmax(0, 1fr)); }
.cc-grid button.ts-slot { min-height: 44px; font-size: 15px; }

.dur { display: flex; align-items: center; gap: 10px; }
.dur-v { flex: 1; text-align: center; display: flex; flex-direction: column; line-height: 1.2; }
.dur-v b { font-family: var(--serif); font-size: 21px; font-weight: 450; }
.dur-v span, .dur-v button { font-size: 12px; color: var(--ink-soft); }
.dur-v button.linkish { color: var(--teal-2); font-size: 12.5px; align-self: center; }
`;
