"use client";

import Link from "next/link";
import { useState } from "react";
import { useSalon } from "@/components/data";
import {
  Cake, CalendarDays, CalendarHeart, Check, ChevronRight, Clock, EyeOff, Heart, Hourglass, PhoneCall, Plus, StickyNote, TrendingDown, TrendingUp,
} from "lucide-react";
import { Contact, Empty, rand, statusBadge, useToast } from "@/components/ui";
import { updateBooking } from "@/lib/db";
import type { BookingWithServices } from "@/lib/types";
import { recallClientsOrdered } from "@/lib/insights";
import {
  addDays, bookingNet, bookingsAwaitingDecision, bookingTitle, clientInitial, clientVisits,
  firstName, fmtDayMonShort, fmtDayMonth, fmtWeekdayDayMonth, monthName, nowSa, toMinutes, weekday,
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

  const nowMin = nowSa().hour * 60 + nowSa().minute;
  const live = todayAppts.filter((b) => b.status !== "cancelled" && b.status !== "no-show");
  const next = live.find((b) => toMinutes(b.time) + (b.duration_minutes || 30) > nowMin);
  const nextIn = next ? toMinutes(next.time) - nowMin : null;
  const doneCount = live.filter((b) => toMinutes(b.time) + (b.duration_minutes || 30) <= nowMin).length;
  const nextClient = next?.client_id ? clientById.get(next.client_id) : undefined;

  return (
    <>
      <div className="eyebrow" style={{ marginTop: 6 }}>{fmtWeekdayDayMonth(today)}</div>
      <h1>{greeting}, <em>Nicky</em></h1>
      <p className="sub">{live.length ? `${live.length} ${live.length === 1 ? "client" : "clients"} today${doneCount ? `, ${doneCount} done` : ""}.` : "A clear book today."}</p>

      {next ? (
        <Link href={`/bookings/?day=${next.date}&open=${next.id}`} className="hero">
          <div className="hero-top">
            <span className="hero-tag">{nextIn != null && nextIn <= 0 ? "On stage now" : "Next on stage"}</span>
            <span className="hero-in">{nextIn != null && nextIn > 0 ? (nextIn < 60 ? `in ${nextIn} min` : `in ${Math.floor(nextIn / 60)} h ${nextIn % 60 ? `${nextIn % 60} min` : ""}`) : `until ${hhmm(toMinutes(next.time) + (next.duration_minutes || 30))}`}</span>
          </div>
          <div className="hero-main">
            <span className="hero-time">{next.time.slice(0, 5)}</span>
            <div className="grow">
              <div className="hero-name">{nextClient?.name ?? "Walk-in"}</div>
              <div className="hero-svc">{bookingTitle(next)} · {rand(bookingNet(next))}</div>
            </div>
            <ChevronRight size={22} />
          </div>
          {next.notes && <div className="hero-note"><StickyNote size={14} />{next.notes}</div>}
          {live.length > 1 && (
            <div className="hero-progress" aria-label={`${doneCount} of ${live.length} done`}>
              {live.map((b) => <i key={b.id} className={b === next ? "now" : toMinutes(b.time) + (b.duration_minutes || 30) <= nowMin ? "done" : ""} />)}
            </div>
          )}
        </Link>
      ) : (
        live.length ? (
          <DayWrap today={today} live={live} bookings={bookings} />
        ) : (
          <div className="hero quiet">
            <div className="hero-top"><span className="hero-tag">Nothing booked today</span></div>
            <div className="hero-name" style={{ marginTop: 4 }}>A slow day. A good moment to work the recall list.</div>
            <Link href="/bookings/?new=1" className="btn gold pill" style={{ marginTop: 14, alignSelf: "flex-start" }}><Plus size={18} />New booking</Link>
          </div>
        )
      )}

      <div className="stats">
        <Link href="/bookings/" className="stat"><b>{weekAppts.length}</b><span>this week</span></Link>
        <Link href="/clients/?filter=recall" className="stat"><b>{recall.length}</b><span>to recall</span></Link>
        <div className="stat"><b>{newClients.length}</b><span>new this month</span></div>
        {/* Money stays a deliberate tap away: this screen is often open in front of a client. */}
        <button type="button" className="stat money-toggle" onClick={() => setShowMoney(!showMoney)} aria-expanded={showMoney}>
          {showMoney ? <b>{shortRand(confirmedRev)}</b> : <b><EyeOff size={20} /></b>}<span>{showMoney ? "this month" : "takings"}</span>
        </button>
      </div>
      {showMoney && (
        <div className="card money-card">
          <div className="row" style={{ alignItems: "flex-end" }}>
            <div className="grow">
              <div className="small muted">Earned in {monthName(today)}</div>
              <div className="big-money">{rand(confirmedRev)}</div>
              <div className="small muted">
                {deltaPct == null ? "Nothing last month to compare" : <>{deltaPct >= 0 ? <TrendingUp size={14} /> : <TrendingDown size={14} />} {deltaPct >= 0 ? "+" : ""}{deltaPct.toFixed(0)}% on last month</>}
              </div>
            </div>
            <div style={{ textAlign: "right" }}>
              <div className="small muted">Still pending</div>
              <div style={{ fontWeight: 700 }}>{rand(pendingRev)}</div>
              <Link href="/reports/" className="see-all">Reports <ChevronRight size={14} /></Link>
            </div>
          </div>
        </div>
      )}

      {undecided.length > 0 && (
        <div className="card attention">
          <div className="card-head"><h2><Hourglass size={18} />Did these happen?</h2><span className="badge gold">{undecided.length}</span></div>
          <p className="sub" style={{ marginBottom: 6 }}>Past bookings still marked pending count for nothing until you say.</p>
          <div className="list">
            {undecided.slice(0, 6).map((b) => {
              const name = (b.client_id && clientById.get(b.client_id)?.name) || "Unknown";
              return (
                <div key={b.id} className="item">
                  <span className="avatar">{clientInitial(name)}</span>
                  <div className="grow">
                    <div className="title">{name}</div>
                    <div className="meta">{fmtDayMonShort(b.date)}, {b.time.slice(0, 5)} · {bookingTitle(b)} · {rand(bookingNet(b))}</div>
                  </div>
                  <div className="row decide" style={{ flexWrap: "nowrap" }}>
                    <button type="button" className="ok pill" disabled={busy === b.id} onClick={() => decide(b.id, "confirmed", name)}><Check size={17} />Happened</button>
                    <button type="button" className="ghost pill" disabled={busy === b.id} onClick={() => decide(b.id, "no-show", name)}>No-show</button>
                  </div>
                </div>
              );
            })}
          </div>
          {undecided.length > 6 && <p className="small muted" style={{ marginBottom: 0 }}>…and {undecided.length - 6} more after these.</p>}
        </div>
      )}

      <div className="card">
        <div className="card-head"><h2><CalendarDays size={18} />Today&apos;s lineup</h2><Link href={`/bookings/?day=${today}`} className="see-all">Diary <ChevronRight size={14} /></Link></div>
        {!todayAppts.length && <Empty icon={CalendarHeart} title="Nothing booked today">Tap the gold + to add someone.</Empty>}
        <div className="tl">
          {todayAppts.map((b) => {
            const c = b.client_id ? clientById.get(b.client_id) : undefined;
            const end = toMinutes(b.time) + (b.duration_minutes || 30);
            const state = b.status === "cancelled" || b.status === "no-show" ? "off" : end <= nowMin ? "done" : b === next ? "now" : "";
            return (
              <Link key={b.id} href={`/bookings/?day=${b.date}&open=${b.id}`} className={`tl-row ${state}`}>
                <div className="tl-time"><b>{b.time.slice(0, 5)}</b><span>{hhmm(end)}</span></div>
                <div className="tl-dot" aria-hidden />
                <div className="grow tl-body">
                  <div className="title">{c?.name ?? "—"}</div>
                  <div className="meta">{bookingTitle(b)} · {rand(bookingNet(b))}</div>
                  {b.notes && <div className="meta tl-note"><StickyNote size={12} />{b.notes}</div>}
                </div>
                {b.status !== "confirmed" && statusBadge(b.status)}
              </Link>
            );
          })}
        </div>
      </div>

      <div className="grid2">
        <div className="card">
          <div className="card-head"><h2><PhoneCall size={18} />Recall list</h2>
            {recall.length > PREVIEW && <Link href="/clients/?filter=recall" className="see-all">All {recall.length} <ChevronRight size={14} /></Link>}</div>
          <p className="sub" style={{ marginBottom: 6 }}>Visited before, nothing booked next. Most overdue first.</p>
          {!recall.length && <Empty icon={Heart} title="Nobody's overdue">Everyone who&apos;s been in has something booked. Nice work.</Empty>}
          <div className="list">
            {recall.slice(0, PREVIEW).map((c) => {
              const v = clientVisits(c, bookings, today);
              return (
                <div key={c.id} className="item">
                  <span className="avatar">{clientInitial(c.name)}</span>
                  <div className="grow">
                    <Link href={`/clients/?id=${c.id}`} className="title">{c.name}</Link>
                    <div className="meta">Last in {v[0] ? fmtDayMonth(v[0].date) : "a while back"}</div>
                  </div>
                  <Contact phone={c.phone} message={`Hi ${firstName(c.name)}! It's Nicky from Beauty & Nails 💅 It's been a little while since your last visit, I'd love to book you in again. Is there a day this week that suits you?`} />
                </div>
              );
            })}
          </div>
        </div>

        <div className="card">
          <div className="card-head"><h2><Cake size={18} />Birthdays in {monthName(today)}</h2>
            {birthdays.length > PREVIEW && <Link href="/clients/?filter=birthdays" className="see-all">All {birthdays.length} <ChevronRight size={14} /></Link>}</div>
          <p className="sub" style={{ marginBottom: 6 }}>A small treat earns more than it costs.</p>
          {!birthdays.length && <Empty icon={Cake} title="No birthdays this month" />}
          <div className="list">
            {birthdays.slice(0, PREVIEW).map((c) => {
              const [m, d] = (c.birthday || "01-01").split("-");
              return (
                <div key={c.id} className="item">
                  <span className="avatar bday"><b>{Number(d)}</b></span>
                  <div className="grow">
                    <Link href={`/clients/?id=${c.id}`} className="title">{c.name}</Link>
                    <div className="meta">{Number(d)} {monthName(`2000-${m}-01`)}</div>
                  </div>
                  <Contact phone={c.phone} message={`Hi ${firstName(c.name)}! 🎂 Happy birthday month! Come treat yourself at Nicky's Beauty & Nails, I'll have a little birthday surprise waiting for you 💅 When can I book you in?`} />
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {recent.length > 0 && (
        <div className="card">
          <div className="card-head"><h2><Clock size={18} />Recently in</h2><Link href="/clients/" className="see-all">Clients <ChevronRight size={14} /></Link></div>
          <div className="recent">
            {recent.map(({ c, visits }) => (
              <Link key={c.id} href={`/clients/?id=${c.id}`} className="recent-c">
                <span className="avatar lg">{clientInitial(c.name)}</span>
                <b>{firstName(c.name)}</b>
                <span>{fmtDayMonShort(visits[0].date)}</span>
              </Link>
            ))}
          </div>
        </div>
      )}
      <style>{TODAY_CSS}</style>
      {toast}
    </>
  );
}

/**
 * The end of her day, said back to her: who she saw, what it earned, and how
 * many are already booked to come back. The money blurs until tapped, like
 * the takings above: a client may still be in the chair.
 */
function DayWrap({ today, live, bookings }: { today: string; live: BookingWithServices[]; bookings: BookingWithServices[] }) {
  const [reveal, setReveal] = useState(false);
  const confirmed = live.filter((b) => b.status === "confirmed");
  const earned = confirmed.reduce((s, b) => s + bookingNet(b), 0);
  const tips = confirmed.reduce((s, b) => s + (Number(b.tip) || 0), 0);
  const pending = live.length - confirmed.length;
  const seen = [...new Set(live.map((b) => b.client_id).filter((id): id is string => !!id))];
  const rebooked = seen.filter((id) => bookings.some((b) => b.client_id === id && b.date > today && b.status !== "cancelled")).length;
  const line = rebooked && rebooked === seen.length ? "Encore: every one of them is booked to come back."
    : rebooked ? `Encore: ${rebooked} of ${seen.length} already booked to come back.`
    : "Nobody's booked their next visit yet. Worth a message tomorrow.";
  return (
    <div className="hero wrap">
      <div className="hero-top"><span className="hero-tag">Curtain call</span><span className="hero-in">{live.length} {live.length === 1 ? "client" : "clients"}</span></div>
      <button type="button" className={`wrap-money${reveal ? " on" : ""}`} onClick={() => setReveal(!reveal)} aria-label={reveal ? "Hide today's takings" : "Show today's takings"}>
        <span className="wrap-big">{rand(earned)}</span>
        <span className="wrap-sub">{reveal ? `earned today${tips ? ` · plus ${rand(tips)} in tips` : ""}` : "tap to see today's takings"}</span>
      </button>
      <div className="hero-svc"><Heart size={14} style={{ verticalAlign: -2, color: "var(--hero-gold)" }} /> {line}</div>
      {pending > 0 && <div className="hero-note"><Hourglass size={14} />{pending} still pending. Confirm {pending === 1 ? "it" : "them"} so {pending === 1 ? "it counts" : "they count"}.</div>}
    </div>
  );
}

const shortRand = (n: number) => (n >= 10000 ? `R${(n / 1000).toFixed(0)}k` : n >= 1000 ? `R${(n / 1000).toFixed(1).replace(/\.0$/, "")}k` : `R${Math.round(n)}`);
const hhmm = (m: number) => `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;

const TODAY_CSS = `
.hero { display: flex; flex-direction: column; gap: 6px; text-decoration: none; color: #fff; border-radius: 26px; padding: 18px 18px 16px; margin-bottom: 12px;
  background: radial-gradient(120% 140% at 100% 0%, var(--hero-a) 0%, var(--teal) 55%, var(--hero-c) 100%); box-shadow: 0 18px 40px -20px rgba(15,59,56,0.8); position: relative; overflow: hidden; }
.hero::after { content: ""; position: absolute; right: -40px; top: -40px; width: 160px; height: 160px; border-radius: 50%; background: radial-gradient(circle, rgba(203,163,106,0.35), transparent 70%); pointer-events: none; }
.hero:active { transform: scale(0.99); }
.hero-top { display: flex; align-items: center; gap: 8px; }
.hero-tag { font-size: 11.5px; font-weight: 700; letter-spacing: 0.14em; text-transform: uppercase; color: var(--hero-gold); }
.hero-in { margin-left: auto; font-size: 13px; font-weight: 650; background: rgba(255,255,255,0.12); padding: 3px 10px; border-radius: 999px; }
.hero-main { display: flex; align-items: center; gap: 14px; }
.hero-time { font-family: var(--serif); font-size: 38px; font-weight: 400; letter-spacing: -0.03em; font-variant-numeric: lining-nums; }
.hero-name { font-family: var(--serif); font-size: 22px; font-weight: 450; line-height: 1.15; }
.hero-svc { font-size: 14px; color: rgba(255,255,255,0.78); }
.hero-note { display: flex; align-items: center; gap: 6px; font-size: 13px; color: var(--hero-gold); background: rgba(255,255,255,0.08); border-radius: 12px; padding: 6px 10px; }
.hero-progress { display: flex; gap: 4px; margin-top: 6px; }
.hero-progress i { flex: 1; height: 4px; border-radius: 99px; background: rgba(255,255,255,0.18); }
.hero-progress i.done { background: rgba(255,255,255,0.6); }
.hero-progress i.now { background: var(--hero-gold); }
.wrap-money { display: flex; flex-direction: column; align-items: flex-start; gap: 0; background: none; border: 0; padding: 4px 0 2px; min-height: 0; color: inherit; text-align: left; }
.wrap-money:hover { background: none; }
.wrap-big { font-family: var(--serif); font-size: 44px; font-weight: 400; letter-spacing: -0.03em; line-height: 1.05; filter: blur(9px); opacity: 0.85; transition: filter .35s var(--ease); font-variant-numeric: lining-nums; }
.wrap-money.on .wrap-big { filter: none; opacity: 1; }
.wrap-sub { font-size: 13px; font-weight: 600; color: rgba(255,255,255,0.75); }
.hero.quiet { background: linear-gradient(145deg, var(--card), var(--gold-soft)); color: var(--ink); box-shadow: var(--shadow-1); }
.hero.quiet .hero-tag { color: var(--gold-2); }

.stats { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 8px; margin-bottom: 14px; }
.stat { background: var(--card); border-radius: 18px; padding: 12px 6px 10px; text-align: center; text-decoration: none; color: var(--ink); box-shadow: var(--shadow-1);
  display: flex; flex-direction: column; align-items: center; gap: 0; min-width: 0; min-height: 0; border: 0; font-weight: 400; }
.stat b { font-family: var(--serif); font-size: 26px; font-weight: 450; line-height: 1.15; min-height: 30px; display: flex; align-items: center; font-variant-numeric: lining-nums; }
.stat span { font-size: 11.5px; color: var(--ink-soft); font-weight: 600; line-height: 1.25; }
button.stat:hover { background: var(--card); }
.money-toggle b svg { color: var(--gold-2); }
.money-card { animation: pop .2s var(--ease) both; }
.big-money { font-family: var(--serif); font-size: 34px; font-weight: 420; letter-spacing: -0.02em; line-height: 1.15; }
.up { color: var(--ok); } .down { color: var(--danger); }
.up svg, .down svg { vertical-align: -2px; }

.card.attention { box-shadow: var(--shadow-1), inset 0 0 0 1.5px color-mix(in srgb, var(--gold) 40%, transparent); }
button.ok { background: var(--ok); color: var(--on-ok); }
button.ok:hover { background: color-mix(in srgb, var(--ok) 88%, black); }
.decide button { min-height: 42px; padding: 6px 14px; font-size: 14px; }

.tl { display: flex; flex-direction: column; }
.tl-row { display: flex; align-items: flex-start; gap: 12px; padding: 10px 4px; text-decoration: none; color: inherit; border-radius: 14px; position: relative; }
.tl-row:hover { background: var(--teal-mist); }
.tl-time { width: 48px; flex: none; display: flex; flex-direction: column; font-variant-numeric: tabular-nums; line-height: 1.25; padding-top: 1px; }
.tl-time b { font-size: 15px; color: var(--ink); }
.tl-time span { font-size: 12px; color: var(--ink-soft); }
.tl-dot { width: 12px; height: 12px; margin-top: 5px; border-radius: 50%; border: 2.5px solid var(--teal-3); background: var(--card); flex: none; position: relative; }
.tl-row:not(:last-child) .tl-dot::after { content: ""; position: absolute; left: 50%; top: 12px; width: 2px; height: 56px; transform: translateX(-50%); background: var(--line); }
.tl-row.done .tl-dot { background: var(--teal-3); }
.tl-row.done .title, .tl-row.done .tl-time b { color: var(--ink-soft); }
.tl-row.now .tl-dot { border-color: var(--gold); background: var(--gold); box-shadow: 0 0 0 4px var(--gold-soft); }
.tl-row.off { opacity: 0.55; }
.tl-row.off .title { text-decoration: line-through; }
.tl .title { font-weight: 650; }
.tl .meta { font-size: 13px; color: var(--ink-soft); }
.tl-note { display: flex; align-items: center; gap: 4px; font-style: italic; }

.avatar.bday { background: var(--rose-soft); color: var(--rose); font-family: var(--serif); }
.recent { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 8px; }
.recent-c { display: flex; flex-direction: column; align-items: center; gap: 4px; text-decoration: none; color: var(--ink); padding: 6px 2px; border-radius: 16px; min-width: 0; }
.recent-c:hover { background: var(--teal-mist); }
.recent-c b { font-size: 14px; max-width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.recent-c span { font-size: 12px; color: var(--ink-soft); }
`;
