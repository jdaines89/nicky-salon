"use client";

import Link from "next/link";
import { useState } from "react";
import { useSalon } from "@/components/data";
import { Contact, Kpi, rand, statusBadge, useToast } from "@/components/ui";
import { updateBooking } from "@/lib/db";
import { recallClientsOrdered } from "@/lib/insights";
import {
  addDays, bookingNet, bookingsAwaitingDecision, bookingTitle, clientInitial, clientVisits,
  firstName, fmtDayMonth, fmtWeekdayDayMonth, nowSa, weekday,
} from "@/lib/salon";

const PREVIEW = 5;

export default function Today() {
  const { clients, bookings, clientById, today, reload } = useSalon();
  const [showMoney, setShowMoney] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [toast, say] = useToast();

  const hour = nowSa().hour;
  const greeting = hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";
  const monthPrefix = today.slice(0, 7);
  const prevMonthPrefix = addDays(`${monthPrefix}-01`, -1).slice(0, 7);

  const todayAppts = bookings.filter((b) => b.date === today).sort((a, b) => a.time.localeCompare(b.time));
  const weekStart = addDays(today, -weekday(today));
  const weekEnd = addDays(weekStart, 6);
  const weekAppts = bookings.filter((b) => b.date >= weekStart && b.date <= weekEnd && b.status !== "cancelled");
  const month = bookings.filter((b) => b.date.startsWith(monthPrefix));
  const confirmedRev = month.filter((b) => b.status === "confirmed").reduce((s, b) => s + bookingNet(b), 0);
  const pendingRev = month.filter((b) => b.status === "pending").reduce((s, b) => s + bookingNet(b), 0);
  const prevRev = bookings.filter((b) => b.date.startsWith(prevMonthPrefix) && b.status === "confirmed")
    .reduce((s, b) => s + bookingNet(b), 0);
  const deltaPct = prevRev ? ((confirmedRev - prevRev) / prevRev) * 100 : null;

  const newClients = clients.filter((c) => {
    if (c.prior_visits?.length) return false;
    const mine = bookings.filter((b) => b.client_id === c.id);
    if (!mine.length) return false;
    const earliest = mine.reduce((a, b) => (b.date + b.time < a.date + a.time ? b : a));
    return earliest.date.startsWith(monthPrefix);
  });
  const recall = recallClientsOrdered(clients, bookings, today);
  const mm = today.slice(5, 7);
  const birthdays = clients.filter((c) => (c.birthday || "").startsWith(mm + "-"))
    .sort((a, b) => (a.birthday || "").localeCompare(b.birthday || ""));
  const undecided = bookingsAwaitingDecision(bookings, today);
  const pendingToday = todayAppts.filter((b) => b.status === "pending").length;

  const recent = clients
    .map((c) => ({ c, visits: clientVisits(c, bookings, today) }))
    .filter((t) => t.visits.length)
    .sort((a, b) => b.visits[0].date.localeCompare(a.visits[0].date))
    .slice(0, 4);

  // Every money and loyalty figure counts past *confirmed* bookings only, so one
  // left pending after its date counts for nothing. This list is the only guard.
  async function decide(id: string, status: "confirmed" | "no-show", name: string) {
    setBusy(id);
    try {
      await updateBooking(id, { status });
      await reload();
      say(status === "confirmed" ? `${name} counted as completed.` : "Marked as a no-show. It won't count toward revenue or loyalty.");
    } catch (e) {
      say(`Couldn't save: ${e instanceof Error ? e.message : e}`);
    } finally {
      setBusy(null);
    }
  }

  return (
    <>
      <h1>{greeting}, Nicky</h1>
      <p className="sub">{fmtWeekdayDayMonth(today)}</p>

      <div className="kpis">
        <Kpi label="Today" value={todayAppts.length}
          note={pendingToday ? `${pendingToday} awaiting confirmation` : todayAppts.length ? "all confirmed" : "nothing booked yet"} />
        <Kpi label="This week" value={weekAppts.length} note={`${fmtDayMonth(weekStart)} – ${fmtDayMonth(weekEnd)}`} />
        <Kpi label="New clients" value={newClients.length} note="this month" />
        <Kpi label="Recall list" value={recall.length} note="visited before, nothing booked" />
      </div>

      {/* Money stays a deliberate tap away: this screen is often open in front of a client. */}
      <div className="card tight">
        <button className="linkish" onClick={() => setShowMoney(!showMoney)}>
          💰 {showMoney ? "Hide" : "Show"} this month&apos;s takings
        </button>
        {showMoney && (
          <div className="kpis" style={{ marginTop: 10, marginBottom: 0 }}>
            <Kpi label="Confirmed" value={rand(confirmedRev)}
              note={deltaPct == null ? "nothing last month to compare" : `${deltaPct >= 0 ? "+" : ""}${deltaPct.toFixed(0)}% vs last month`}
              tone={deltaPct == null ? undefined : deltaPct >= 0 ? "up" : "down"} />
            <Kpi label="Pending" value={rand(pendingRev)} note={<Link href="/reports/">Full breakdown</Link>} />
          </div>
        )}
      </div>

      {undecided.length > 0 && (
        <div className="card">
          <h2>⏳ Did these happen?</h2>
          <p className="sub">
            {undecided.length} booking{undecided.length !== 1 ? "s" : ""} still pending after the day passed.
            They count for nothing until you say.
          </p>
          <div className="list">
            {undecided.slice(0, 6).map((b) => {
              const name = (b.client_id && clientById.get(b.client_id)?.name) || "Unknown";
              return (
                <div key={b.id} className="item" style={{ flexWrap: "wrap" }}>
                  <div className="grow">
                    <div className="title">{name}</div>
                    <div className="meta">{fmtDayMonth(b.date)} · {b.time.slice(0, 5)} · {bookingTitle(b)} · {rand(bookingNet(b))}</div>
                  </div>
                  <div className="row">
                    <button disabled={busy === b.id} onClick={() => decide(b.id, "confirmed", name)}>✓ Happened</button>
                    <button className="ghost" disabled={busy === b.id} onClick={() => decide(b.id, "no-show", name)}>✗ No-show</button>
                  </div>
                </div>
              );
            })}
          </div>
          {undecided.length > 6 && <p className="small muted">…and {undecided.length - 6} more. Resolve these first.</p>}
        </div>
      )}

      <div className="card">
        <div className="row"><h2 className="grow">Today&apos;s schedule</h2><Link href="/bookings/" className="btn ghost">+ Book</Link></div>
        {!todayAppts.length && <p className="muted">Nothing booked today yet. A good moment to work the recall list.</p>}
        <div className="list">
          {todayAppts.map((b) => {
            const c = b.client_id ? clientById.get(b.client_id) : undefined;
            return (
              <Link key={b.id} href={`/bookings/?day=${b.date}&open=${b.id}`} className="item" style={{ textDecoration: "none" }}>
                <span className="time">{b.time.slice(0, 5)}</span>
                <div className="grow">
                  <div className="title">{c?.name ?? "—"}</div>
                  <div className="meta">{bookingTitle(b)} · {rand(bookingNet(b))}{b.notes ? ` · ${b.notes}` : ""}</div>
                </div>
                {statusBadge(b.status)}
              </Link>
            );
          })}
        </div>
      </div>

      <div className="grid2">
        <div className="card">
          <h2>📞 Recall list</h2>
          <p className="sub">Visited before, nothing booked next. Most overdue first.</p>
          {!recall.length && <p className="muted">Nobody&apos;s overdue right now. Nice work.</p>}
          <div className="list">
            {recall.slice(0, PREVIEW).map((c) => {
              const v = clientVisits(c, bookings, today);
              return (
                <div key={c.id} className="item">
                  <div className="grow">
                    <Link href={`/clients/?id=${c.id}`} className="title">{c.name}</Link>
                    <div className="meta">Last visit {v[0] ? fmtDayMonth(v[0].date) : "a while back"}</div>
                  </div>
                  <Contact phone={c.phone} message={`Hi ${firstName(c.name)}! It's Nicky from Beauty & Nails 💅 It's been a little while since your last visit, I'd love to book you in again. Is there a day this week that suits you?`} />
                </div>
              );
            })}
          </div>
          {recall.length > PREVIEW && <Link href="/clients/?filter=recall">View all {recall.length} →</Link>}
        </div>

        <div className="card">
          <h2>🎂 Birthdays this month</h2>
          <p className="sub">A small treat earns more than it costs.</p>
          {!birthdays.length && <p className="muted">No birthdays this month.</p>}
          <div className="list">
            {birthdays.slice(0, PREVIEW).map((c) => {
              const [m, d] = (c.birthday || "01-01").split("-");
              return (
                <div key={c.id} className="item">
                  <div className="grow">
                    <Link href={`/clients/?id=${c.id}`} className="title">{c.name}</Link>
                    <div className="meta">{d}/{m}</div>
                  </div>
                  <Contact phone={c.phone} message={`Hi ${firstName(c.name)}! 🎂 Happy birthday month! Come treat yourself at Nicky's Beauty & Nails, I'll have a little birthday surprise waiting for you 💅 When can I book you in?`} />
                </div>
              );
            })}
          </div>
          {birthdays.length > PREVIEW && <Link href="/clients/?filter=birthdays">View all {birthdays.length} →</Link>}
        </div>
      </div>

      {recent.length > 0 && (
        <div className="card">
          <h2>Recent clients</h2>
          <div className="list">
            {recent.map(({ c, visits }) => (
              <Link key={c.id} href={`/clients/?id=${c.id}`} className="item" style={{ textDecoration: "none" }}>
                <span className="avatar">{clientInitial(c.name)}</span>
                <div className="grow">
                  <div className="title">{c.name}</div>
                  <div className="meta">Last visit {fmtDayMonth(visits[0].date)}</div>
                </div>
              </Link>
            ))}
          </div>
        </div>
      )}
      {toast}
    </>
  );
}
