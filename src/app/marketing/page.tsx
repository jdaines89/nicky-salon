"use client";

import { useState } from "react";
import { useSalon } from "@/components/data";
import { Seg } from "@/components/ui";
import { MarketingRow, MarketingTemplateEditor, renderTpl } from "@/components/marketing-outreach";
import { cadence, cadenceLine, quietSlotOffers, recallClientsOrdered } from "@/lib/insights";
import {
  addDays, bookingTitle, completedVisitCount, firstName, fmtDayMonth, fmtWeekdayDayMonth, loyaltyDiscountDue,
} from "@/lib/salon";

/**
 * Marketing: every list answers "who should Nicky message right now, and what
 * should it say?" One tap opens WhatsApp with a personalised message already
 * typed. No API, no per-message cost.
 */

const SECTIONS = ["Reminders", "Win-Back", "Birthdays", "Loyalty Rewards", "Fill a Quiet Slot"] as const;
type Section = (typeof SECTIONS)[number];

const DEFAULTS = {
  reminder: "Hi {name}! Just a friendly reminder of your appointment at Nicky's Beauty & Nails "
    + "{day} at {time} 💅 See you soon! — Nicky",
  winback: "Hi {name}! It's Nicky from Beauty & Nails 💅 It's been a little while since your last "
    + "visit — I'd love to book you in again. Is there a day this week that suits you?",
  birthday: "Hi {name}! 🎂 Happy birthday month! Come treat yourself at Nicky's Beauty & Nails — "
    + "I'll have a little birthday surprise waiting for you 💅 When can I book you in?",
  quietslot: "Hi {name}! I've kept {day} at {time} open for you at Nicky's Beauty & Nails "
    + "— and it's 20% OFF 💛 Want me to hold it?",
  loyalty: "Hi {name}! Great news — you've earned your loyalty reward at Nicky's Beauty & Nails: "
    + "20% OFF your next visit 💛 When can I book you in to use it?",
};
type TplKey = keyof typeof DEFAULTS;

const hhmm = (min: number) => `${String(Math.floor(min / 60)).padStart(2, "0")}:${String(min % 60).padStart(2, "0")}`;
const plural = (n: number, word: string) => `${n} ${word}${n !== 1 ? "s" : ""}`;

export default function Marketing() {
  const { clients, bookings, clientById, today } = useSalon();
  const [section, setSection] = useState<Section>("Reminders");
  // Edited messages survive switching sections for the whole visit.
  const [tpls, setTpls] = useState<Record<TplKey, string>>({ ...DEFAULTS });
  const [remDay, setRemDay] = useState<"Tomorrow" | "Today" | "Pick a date">("Tomorrow");
  const [remDate, setRemDate] = useState(addDays(today, 1));

  const editor = (k: TplKey, placeholders: string) => (
    <MarketingTemplateEditor value={tpls[k]} placeholders={placeholders} isDefault={tpls[k] === DEFAULTS[k]}
      onChange={(v) => setTpls({ ...tpls, [k]: v })} onReset={() => setTpls({ ...tpls, [k]: DEFAULTS[k] })} />
  );

  let body: React.ReactNode;

  if (section === "Reminders") {
    const target = remDay === "Tomorrow" ? addDays(today, 1) : remDay === "Today" ? today : (remDate || addDays(today, 1));
    const dayWord = remDay === "Tomorrow" ? "tomorrow" : remDay === "Today" ? "today" : `on ${fmtDayMonth(target)}`;
    const appts = bookings.filter((b) => b.date === target && (b.status === "confirmed" || b.status === "pending"))
      .sort((a, b) => a.time.localeCompare(b.time));
    body = (
      <>
        <h2>📅 Appointment reminders</h2>
        <p className="sub">A reminder the day before is the cheapest no-show insurance there is.</p>
        <div className="row" style={{ marginBottom: 12 }}>
          <Seg value={remDay} options={["Tomorrow", "Today", "Pick a date"] as const} onChange={setRemDay} />
          {remDay === "Pick a date" && (
            <input type="date" value={remDate} onChange={(e) => setRemDate(e.target.value)} aria-label="Date" style={{ width: "auto" }} />
          )}
        </div>
        {editor("reminder", "{name}, {day}, {time}, {date}, {services}")}
        <div className="card">
          <p className="small" style={{ marginTop: 0 }}><b>{fmtWeekdayDayMonth(target)}</b> · {plural(appts.length, "appointment")}</p>
          {!appts.length && <p className="muted" style={{ margin: 0 }}>Nothing booked for this day.</p>}
          <div className="list">
            {appts.map((b) => {
              const c = b.client_id ? clientById.get(b.client_id) : undefined;
              if (!c) return null;
              const msg = renderTpl(tpls.reminder, {
                name: firstName(c.name), day: dayWord, time: b.time.slice(0, 5),
                date: fmtDayMonth(target), services: bookingTitle(b),
              });
              const tag = b.status === "pending" ? " · awaiting confirmation" : "";
              return <MarketingRow key={b.id} client={c} message={msg} context={`${b.time.slice(0, 5)} · ${bookingTitle(b)}${tag}`} />;
            })}
          </div>
        </div>
      </>
    );
  } else if (section === "Win-Back") {
    // Ordered by each client's own rhythm: most overdue first.
    const recall = recallClientsOrdered(clients, bookings, today);
    body = (
      <>
        <h2>📞 Win-back</h2>
        <p className="sub">Visited before, nothing booked next. A warm nudge brings most of them back. Most overdue by her own rhythm first.</p>
        {editor("winback", "{name}, {last_visit}")}
        <div className="card">
          {!recall.length && <p className="muted" style={{ margin: 0 }}>Nobody&apos;s overdue right now. Nice work.</p>}
          <div className="list">
            {recall.map((c) => {
              const cad = cadence(c, bookings, today);
              const last = cad ? fmtDayMonth(cad.lastVisit) : "a while back";
              const rhythm = cadenceLine(cad);
              return (
                <MarketingRow key={c.id} client={c}
                  message={renderTpl(tpls.winback, { name: firstName(c.name), last_visit: last })}
                  context={`Last visit ${last}${rhythm ? ` · ${rhythm}` : ""}`} />
              );
            })}
          </div>
        </div>
      </>
    );
  } else if (section === "Birthdays") {
    const mm = today.slice(5, 7);
    const list = clients.filter((c) => (c.birthday || "").startsWith(mm + "-"))
      .sort((a, b) => Number((a.birthday || "01-01").split("-")[1]) - Number((b.birthday || "01-01").split("-")[1]));
    body = (
      <>
        <h2>🎂 Birthdays this month</h2>
        <p className="sub">A free little extra on their birthday earns more than it costs, and they tell their friends.</p>
        {editor("birthday", "{name}, {birthday}")}
        <div className="card">
          {!list.length && <p className="muted" style={{ margin: 0 }}>No birthdays this month.</p>}
          <div className="list">
            {list.map((c) => {
              const [m, d] = (c.birthday || "01-01").split("-");
              return (
                <MarketingRow key={c.id} client={c} context={`Birthday ${d}/${m}`}
                  message={renderTpl(tpls.birthday, { name: firstName(c.name), birthday: `${d}/${m}` })} />
              );
            })}
          </div>
        </div>
      </>
    );
  } else if (section === "Fill a Quiet Slot") {
    const offers = quietSlotOffers(clients, bookings, today);
    body = (
      <>
        <h2>🕳️ Fill a quiet slot</h2>
        <p className="sub">
          An empty hour earns nothing. This points the reward you already give at the hours that are actually
          empty, and names the slot, so there&apos;s one decision to make instead of three.
        </p>
        {editor("quietslot", "{name}, {day}, {time}, {why}")}
        <div className="card">
          {!offers.length ? (
            <p className="muted" style={{ margin: 0 }}>
              Nothing to offer right now. Either the diary is full, or no one is due a reward or overdue a visit. Both are good news.
            </p>
          ) : (
            <p className="small muted" style={{ marginTop: 0 }}>
              {plural(offers.length, "suggestion")} · each client gets her own slot, so nothing is promised twice
            </p>
          )}
          <div className="list">
            {offers.map((o) => {
              const op = o.opening;
              const time = hhmm(op.startMin);
              const day = fmtWeekdayDayMonth(op.date);
              const why = o.reason === "loyalty" ? "your loyalty reward" : "it's been a while";
              const badge = o.reason === "loyalty"
                ? <span className="badge gold">💛 reward earned</span>
                : <span className="badge">📉 overdue</span>;
              return (
                <MarketingRow key={o.client.id} client={o.client} badge={badge}
                  message={renderTpl(tpls.quietslot, { name: firstName(o.client.name), day, time, why })}
                  context={<>{o.detail} → offer <b>{day} at {time}</b>{op.dayBooked === 0 ? " · nothing else booked that day" : ""}</>} />
              );
            })}
          </div>
        </div>
      </>
    );
  } else {
    const due = clients
      .map((c) => ({ c, visits: completedVisitCount(c, bookings, today) }))
      .filter((t) => loyaltyDiscountDue(t.visits))
      .sort((a, b) => (a.c.name < b.c.name ? -1 : a.c.name > b.c.name ? 1 : 0));
    body = (
      <>
        <h2>💛 Loyalty rewards due</h2>
        <p className="sub">These clients have earned 20% off their next visit. Telling them is the easiest booking you&apos;ll ever make.</p>
        {editor("loyalty", "{name}, {visits}")}
        <div className="card">
          {!due.length && <p className="muted" style={{ margin: 0 }}>No rewards due right now. They&apos;re earned on every 5th completed visit.</p>}
          <div className="list">
            {due.map(({ c, visits }) => (
              <MarketingRow key={c.id} client={c} context={`${visits} completed visits · reward unlocked`}
                message={renderTpl(tpls.loyalty, { name: firstName(c.name), visits })} />
            ))}
          </div>
        </div>
      </>
    );
  }

  return (
    <>
      <h1>Marketing</h1>
      <p className="sub">Tap 💬 WhatsApp and the message is already written. Read it, tweak it, send it.</p>
      <div style={{ marginBottom: 16 }}>
        <Seg value={section} options={SECTIONS} onChange={setSection} />
      </div>
      {body}
    </>
  );
}
