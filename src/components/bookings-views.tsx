"use client";

import { rand } from "@/components/ui";
import { bookingLook, freeText, hhmm, StatusLegend, type FvMap } from "@/components/bookings-shared";
import {
  addDays, bookingNet, bookingTitle, CLOSE_MIN, dayOfMonth, firstName, fmtDayMonShort, freeGaps,
  monthBounds, monthName, OPEN_MIN, toMinutes, weekday,
} from "@/lib/salon";
import type { BookingWithServices, Client } from "@/lib/types";

/** 'R850', 'R1.2k': fits a phone-width calendar cell. */
const shortRand = (n: number) => (n >= 1000 ? `R${(n / 1000).toFixed(n >= 10000 ? 0 : 1).replace(/\.0$/, "")}k` : `R${Math.round(n)}`);

const DOW = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

export const mondayOf = (d: string) => addDays(d, -weekday(d));

/** First-of-month shifted by `delta` months. */
export function shiftMonth(d: string, delta: number): string {
  const y = Number(d.slice(0, 4)), m = Number(d.slice(5, 7)) - 1 + delta;
  const yy = y + Math.floor(m / 12), mm = ((m % 12) + 12) % 12;
  return `${yy}-${String(mm + 1).padStart(2, "0")}-01`;
}

function Nav({ title, onPrev, onToday, onNext, prevLabel, nextLabel }: {
  title: string; onPrev: () => void; onToday: () => void; onNext: () => void; prevLabel: string; nextLabel: string;
}) {
  return (
    <div className="bk-nav">
      <h2>{title}</h2>
      <button className="ghost" onClick={onPrev} aria-label={prevLabel}>←</button>
      <button className="ghost" onClick={onToday}>Today</button>
      <button className="ghost" onClick={onNext} aria-label={nextLabel}>→</button>
    </div>
  );
}

interface ViewProps {
  focus: string;
  today: string;
  bookings: BookingWithServices[];
  clientById: Map<string, Client>;
  fv: FvMap;
  setFocus: (d: string) => void;
  onEdit: (b: BookingWithServices) => void;
}

const nameOf = (b: BookingWithServices, byId: Map<string, Client>) => (b.client_id && byId.get(b.client_id)?.name) || "—";

function BookingRow({ b, byId, fv, onEdit, showDate }: {
  b: BookingWithServices; byId: Map<string, Client>; fv: FvMap; onEdit: (b: BookingWithServices) => void; showDate?: boolean;
}) {
  const look = bookingLook(b, fv);
  return (
    <button className="item" onClick={() => onEdit(b)}>
      <span className="time">{showDate && <span className="small" style={{ display: "block", fontWeight: 600, color: "var(--ink-soft)" }}>{fmtDayMonShort(b.date)}</span>}{b.time.slice(0, 5)}</span>
      <div className="grow">
        <div className="title">{nameOf(b, byId)}</div>
        <div className="meta">{bookingTitle(b)} · {rand(bookingNet(b))}{b.notes ? ` · ${b.notes}` : ""}</div>
      </div>
      <span className={`badge ${look.badge}`}>{look.label}</span>
    </button>
  );
}

// ---------------------------------------------------------------- MONTH

export function MonthView({ focus, today, bookings, setFocus, openWeek }: ViewProps & { openWeek: (d: string) => void }) {
  const [first, last] = monthBounds(focus);
  const gridStart = mondayOf(first);
  const gridEnd = addDays(last, 6 - weekday(last));
  const days: string[] = [];
  for (let d = gridStart; d <= gridEnd; d = addDays(d, 1)) days.push(d);

  const prefix = first.slice(0, 7);
  const monthAppts = bookings.filter((b) => b.date.startsWith(prefix));
  const monthRev = monthAppts.filter((b) => b.status === "confirmed").reduce((s, b) => s + bookingNet(b), 0);
  const byDay = new Map<string, BookingWithServices[]>();
  for (const b of monthAppts) byDay.set(b.date, [...(byDay.get(b.date) ?? []), b]);
  const dayRev = (d: string) => (byDay.get(d) ?? []).filter((b) => b.status !== "cancelled").reduce((s, b) => s + bookingNet(b), 0);
  let maxRev = 1;
  for (const d of byDay.keys()) maxRev = Math.max(maxRev, dayRev(d));

  return (
    <div className="card">
      <Nav title={`${monthName(first)} ${first.slice(0, 4)}`} prevLabel="Previous month" nextLabel="Next month"
        onPrev={() => setFocus(shiftMonth(first, -1))} onToday={() => setFocus(today)} onNext={() => setFocus(shiftMonth(first, 1))} />
      <p className="small muted" style={{ marginTop: 0 }}>
        Tap a day to see its week · <b>{monthAppts.length}</b> booking{monthAppts.length !== 1 ? "s" : ""} this month ·{" "}
        <b>{rand(monthRev)}</b> confirmed
      </p>
      <div className="bk-month">
        {DOW.map((d) => <div key={d} className="dow">{d}</div>)}
        {days.map((d) => {
          if (!d.startsWith(prefix)) return <div key={d} className="other">{dayOfMonth(d)}</div>;
          const appts = byDay.get(d) ?? [];
          const rev = dayRev(d);
          const ratio = rev / maxRev;
          const tier = ratio >= 0.66 ? "busy" : ratio >= 0.33 ? "moderate" : "quiet";
          return (
            <button key={d} className={`bk-mday${d === today ? " today" : ""}${d === focus ? " focus" : ""}`}
              aria-label={`${fmtDayMonShort(d)}: ${appts.length} booking${appts.length !== 1 ? "s" : ""}`}
              onClick={() => openWeek(d)}>
              {dayOfMonth(d)}
              {appts.length > 0 && (
                <span className={`bk-load ${tier}`}>{appts.length}<br />{shortRand(rev)}</span>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- WEEK

export function WeekView({ focus, today, bookings, clientById, fv, setFocus, onEdit, openDay, addOn }: ViewProps & {
  openDay: (d: string) => void; addOn: (d: string) => void;
}) {
  const start = mondayOf(focus);
  const end = addDays(start, 6);
  const days = Array.from({ length: 7 }, (_, i) => addDays(start, i));
  const weekAppts = bookings.filter((b) => b.date >= start && b.date <= end)
    .sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time));
  const hours = Array.from({ length: 12 }, (_, i) => 8 + i);
  const hourOf = (b: BookingWithServices) => Math.floor(toMinutes(b.time) / 60);
  // Anything outside 08:00–19:59 still gets shown, in the first/last row.
  const rowOf = (b: BookingWithServices) => Math.min(19, Math.max(8, hourOf(b)));

  return (
    <>
      <div className="card">
        <Nav title={`${fmtDayMonShort(start)} – ${fmtDayMonShort(end)}`} prevLabel="Previous week" nextLabel="Next week"
          onPrev={() => setFocus(addDays(start, -7))} onToday={() => setFocus(today)} onNext={() => setFocus(addDays(start, 7))} />
        <p className="small muted" style={{ marginTop: 0 }}>Tap a day to open its Day view · tap ＋ to book straight into that day · tap a booking to edit it.</p>
        <StatusLegend />
        <div className="bk-week">
          <div />
          {days.map((d, i) => (
            <button key={d} className={`bk-whead${d === today ? " today" : ""}`} onClick={() => openDay(d)} aria-label={`Open ${fmtDayMonShort(d)}`}>
              {DOW[i]}<b>{dayOfMonth(d)}</b>
            </button>
          ))}
          <div />
          {days.map((d) => (
            <button key={d} className="bk-wadd" onClick={() => addOn(d)} aria-label={`New booking on ${fmtDayMonShort(d)}`}>＋</button>
          ))}
          {hours.map((h) => (
            <HourRow key={h} h={h} days={days} appts={weekAppts} rowOf={rowOf} byId={clientById} fv={fv} onEdit={onEdit} />
          ))}
        </div>
      </div>
      <div className="card">
        <h2>This week&apos;s bookings</h2>
        {!weekAppts.length && <p className="muted" style={{ margin: 0 }}>Nothing booked this week.</p>}
        <div className="list bk-rows">
          {weekAppts.map((b) => <BookingRow key={b.id} b={b} byId={clientById} fv={fv} onEdit={onEdit} showDate />)}
        </div>
      </div>
    </>
  );
}

function HourRow({ h, days, appts, rowOf, byId, fv, onEdit }: {
  h: number; days: string[]; appts: BookingWithServices[]; rowOf: (b: BookingWithServices) => number;
  byId: Map<string, Client>; fv: FvMap; onEdit: (b: BookingWithServices) => void;
}) {
  return (
    <>
      <div className="hr">{String(h).padStart(2, "0")}</div>
      {days.map((d) => (
        <div key={d} className="cell">
          {appts.filter((b) => b.date === d && rowOf(b) === h).map((b) => {
            const look = bookingLook(b, fv);
            return (
              <button key={b.id} className="bk-blk" style={{ background: look.color }} onClick={() => onEdit(b)}
                title={`${b.time.slice(0, 5)} ${nameOf(b, byId)} · ${bookingTitle(b)}`}>
                <em>{b.time.slice(0, 5)} </em>{firstName(nameOf(b, byId))}
                <span>{bookingTitle(b)}</span>
              </button>
            );
          })}
        </div>
      ))}
    </>
  );
}

// ---------------------------------------------------------------- DAY

const PX = 1.2; // px per minute

/** Side-by-side lanes for overlapping bookings, so a double-booking is visible, not hidden underneath. */
function lanes(items: { id: string; s: number; e: number }[]): Map<string, { lane: number; of: number }> {
  const out = new Map<string, { lane: number; of: number }>();
  let cluster: { id: string; s: number; e: number; lane: number }[] = [];
  let clusterEnd = -1;
  const flush = () => {
    const of = Math.max(1, ...cluster.map((c) => c.lane + 1));
    for (const c of cluster) out.set(c.id, { lane: c.lane, of });
    cluster = [];
  };
  for (const it of [...items].sort((a, b) => a.s - b.s || a.e - b.e)) {
    if (it.s >= clusterEnd && cluster.length) flush();
    const used = new Set(cluster.filter((c) => c.e > it.s).map((c) => c.lane));
    let lane = 0;
    while (used.has(lane)) lane++;
    cluster.push({ ...it, lane });
    clusterEnd = Math.max(clusterEnd, it.e);
  }
  if (cluster.length) flush();
  return out;
}

export function DayView({ focus, today, bookings, clientById, fv, setFocus, onEdit, bookSlot }: ViewProps & {
  bookSlot: (date: string, startMin: number) => void;
}) {
  const appts = bookings.filter((b) => b.date === focus).sort((a, b) => a.time.localeCompare(b.time));
  const gaps = freeGaps(appts).filter(([s, e]) => e - s >= 20);
  const height = (CLOSE_MIN - OPEN_MIN) * PX;
  const items = appts.map((b) => {
    const s0 = toMinutes(b.time);
    return { b, id: b.id, s: Math.max(s0, OPEN_MIN), e: Math.min(s0 + (b.duration_minutes || 30), CLOSE_MIN) };
  }).filter((x) => x.e > x.s);
  const laneOf = lanes(items);
  const outside = appts.length - items.length;
  const heading = focus === today ? "Today" : focus === addDays(today, 1) ? "Tomorrow" : null;

  return (
    <>
      <div className="card">
        <Nav title={`${heading ? heading + ", " : ""}${["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"][weekday(focus)]} ${fmtDayMonShort(focus)}`}
          prevLabel="Previous day" nextLabel="Next day"
          onPrev={() => setFocus(addDays(focus, -1))} onToday={() => setFocus(today)} onNext={() => setFocus(addDays(focus, 1))} />
        <p className="small muted" style={{ marginTop: 0 }}>
          {appts.length} booking{appts.length !== 1 ? "s" : ""}
          {gaps.length ? ` · ${freeText(gaps.reduce((s, [a, b]) => s + b - a, 0))} open` : " · fully booked"}
        </p>
        {gaps.length > 0 && (
          <>
            <div className="small" style={{ fontWeight: 600, marginBottom: 6 }}>Tap an open slot to book it:</div>
            <div className="bk-slots">
              {gaps.slice(0, 6).map(([s, e]) => (
                <button key={s} className="bk-slot" onClick={() => bookSlot(focus, s)} aria-label={`Book ${hhmm(s)}, ${freeText(e - s)} free until ${hhmm(e)}`}>
                  ＋ {hhmm(s)}<small>{freeText(e - s)} free</small>
                </button>
              ))}
            </div>
          </>
        )}
        <StatusLegend />
        <div className="bk-tl">
          <div className="lbls" style={{ height }}>
            {Array.from({ length: 12 }, (_, i) => 8 + i).map((h) => (
              <span key={h} style={{ top: Math.max(6, (h * 60 - OPEN_MIN) * PX) }}>{String(h).padStart(2, "0")}:00</span>
            ))}
          </div>
          <div className="track" style={{ height, backgroundSize: `100% ${60 * PX}px` }}>
            {gaps.map(([s, e]) => (
              <button key={`g${s}`} className="bk-gap" style={{ top: (s - OPEN_MIN) * PX + 1, height: (e - s) * PX - 2 }}
                onClick={() => bookSlot(focus, s)}>
                ＋ {freeText(e - s)} free from {hhmm(s)}
              </button>
            ))}
            {items.map(({ b, s, e }) => {
              const look = bookingLook(b, fv);
              const l = laneOf.get(b.id) ?? { lane: 0, of: 1 };
              const faded = b.status === "cancelled" || b.status === "no-show";
              return (
                <button key={b.id} className="bk-appt" onClick={() => onEdit(b)}
                  style={{
                    top: (s - OPEN_MIN) * PX, height: Math.max((e - s) * PX, 26), background: look.color,
                    left: `calc(4px + (100% - 8px) * ${l.lane / l.of})`,
                    width: `calc((100% - 8px) / ${l.of} - 2px)`, opacity: faded ? 0.55 : 1, zIndex: faded ? 1 : 2,
                  }}>
                  <span className="n">{nameOf(b, clientById)}</span>
                  <span className="w">{b.time.slice(0, 5)}–{hhmm(toMinutes(b.time) + (b.duration_minutes || 30))} · {bookingTitle(b)}</span>
                </button>
              );
            })}
          </div>
        </div>
        {outside > 0 && <p className="small muted">{outside} booking{outside !== 1 ? "s are" : " is"} outside 08:00–19:00; see the list below.</p>}
      </div>
      <div className="card">
        <h2>Bookings list</h2>
        {!appts.length && <p className="muted" style={{ margin: 0 }}>No bookings on this day.</p>}
        <div className="list bk-rows">
          {appts.map((b) => <BookingRow key={b.id} b={b} byId={clientById} fv={fv} onEdit={onEdit} />)}
        </div>
      </div>
    </>
  );
}
