"use client";

import { useState } from "react";
import { useSalon } from "@/components/data";
import { Kpi, rand, Seg, useToast } from "@/components/ui";
import { ReportsBarList, ReportsColumns } from "@/components/reports-bars";
import { ReportsPayroll } from "@/components/reports-payroll";
import {
  capacityStats, listEarningRate, occupancyByWeekday, realisedEarningRate, retentionStats, weekdayCounts,
} from "@/lib/insights";
import { monthLabel } from "@/lib/payroll";
import { addDays, bookingNet, fmtDayMonShort, fmtDayMonth, monthBounds, weekday } from "@/lib/salon";

const RANGES = ["This Week", "This Month", "Last Month", "Pick a Month", "Custom", "All Time"] as const;
type Range = (typeof RANGES)[number];
const SECTIONS = ["Overview", "Trends", "Top Services", "Clients", "For My Boss"] as const;
type Section = (typeof SECTIONS)[number];
const DAY_NAMES = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

const mondayOf = (d: string) => addDays(d, -weekday(d));
const signedRand = (n: number) => (n >= 0 ? "+" : "−") + rand(Math.abs(n));

/**
 * How business is actually going: not just what's booked, what's been earned.
 * Every revenue figure sums bookingNet() (services minus discount); tips never count.
 */
export default function Reports() {
  const { bookings, clients, services, today } = useSalon();
  const [toast, say] = useToast();
  const [range, setRange] = useState<Range>("This Week");
  const [section, setSection] = useState<Section>("Overview");
  const [pickedYm, setPickedYm] = useState(today.slice(0, 7));
  const [customFrom, setCustomFrom] = useState(monthBounds(today)[0]);
  const [customTo, setCustomTo] = useState(today);

  // ---- range ----
  let start: string | null = null, end: string | null = null, caption = "";
  const lastMonthDay = addDays(`${today.slice(0, 7)}-01`, -1);
  const monthsWithData = [...new Set(bookings.map((b) => b.date.slice(0, 7)))].sort().reverse();
  if (!monthsWithData.includes(today.slice(0, 7))) monthsWithData.unshift(today.slice(0, 7));
  if (range === "This Week") {
    start = mondayOf(today); end = addDays(start, 6);
    caption = `${fmtDayMonth(start)} – ${fmtDayMonth(end)}`;
  } else if (range === "This Month") {
    [start, end] = monthBounds(today);
    caption = monthLabel(today.slice(0, 7));
  } else if (range === "Last Month") {
    [start, end] = monthBounds(lastMonthDay);
    caption = monthLabel(lastMonthDay.slice(0, 7));
  } else if (range === "Pick a Month") {
    const ym = monthsWithData.includes(pickedYm) ? pickedYm : monthsWithData[0];
    [start, end] = monthBounds(`${ym}-01`);
    caption = monthLabel(ym);
  } else if (range === "Custom") {
    let f = customFrom || monthBounds(today)[0], t = customTo || today;
    const swapped = f > t;
    if (swapped) [f, t] = [t, f];
    start = f; end = t;
    caption = f === t ? fmtDayMonth(f) : `${fmtDayMonth(f)} – ${fmtDayMonth(t)}${swapped ? " (swapped: From was after To)" : ""}`;
  } else {
    caption = "Every booking on record";
  }

  const filtered = bookings.filter((b) => !start || (start <= b.date && b.date <= end!));
  const confirmed = filtered.filter((b) => b.status === "confirmed");
  const pending = filtered.filter((b) => b.status === "pending");
  const lost = filtered.filter((b) => b.status === "cancelled" || b.status === "no-show");
  const confirmedRevenue = confirmed.reduce((s, b) => s + bookingNet(b), 0);
  const pendingRevenue = pending.reduce((s, b) => s + bookingNet(b), 0);
  const avgValue = confirmed.length ? Math.round(confirmedRevenue / confirmed.length) : 0;
  const lostRate = filtered.length ? Math.round((lost.length / filtered.length) * 100) : 0;

  const monthRevenue = (prefix: string) => bookings
    .filter((b) => b.date.startsWith(prefix) && b.status === "confirmed")
    .reduce((s, b) => s + bookingNet(b), 0);

  let body: React.ReactNode = null;

  if (section === "Overview") {
    const thisRev = monthRevenue(today.slice(0, 7));
    const prevRev = monthRevenue(lastMonthDay.slice(0, 7));
    const delta = thisRev - prevRev;
    const pct = prevRev ? (delta / prevRev) * 100 : null;
    const cap = capacityStats(bookings, start, end, today);
    const monthTotals = new Map<string, number>();
    for (const b of bookings) {
      if (b.status !== "confirmed") continue;
      const ym = b.date.slice(0, 7);
      monthTotals.set(ym, (monthTotals.get(ym) || 0) + bookingNet(b));
    }
    const months = [...monthTotals.entries()].sort(([a], [b]) => (a < b ? -1 : 1));
    const maxMonth = Math.max(1, ...months.map(([, v]) => v));
    body = (
      <>
        <div className="card">
          <h2>This month vs last month</h2>
          <div className="kpis" style={{ gridTemplateColumns: "repeat(3, minmax(0, 1fr))", marginBottom: 0 }}>
            <Kpi label={monthLabel(today.slice(0, 7))} value={rand(thisRev)} />
            <Kpi label={monthLabel(lastMonthDay.slice(0, 7))} value={rand(prevRev)} />
            <Kpi label="Change" value={<span style={{ fontSize: 20 }}>{signedRand(delta)}</span>}
              note={pct == null ? "n/a" : `${pct >= 0 ? "+" : ""}${pct.toFixed(0)}%`}
              tone={pct == null ? undefined : pct >= 0 ? "up" : "down"} />
          </div>
        </div>

        {/* Occupancy decides where effort is worth spending: prices are the employer's,
            so revenue is available hours x occupancy x what fills the hour. */}
        <div className="card">
          <h2>How full the chair was</h2>
          <p className="sub">Of the hours you were open in this range. The number that says whether to chase bookings or change what fills them.</p>
          {!cap.availableMinutes ? (
            <div className="notice" style={{ marginBottom: 0 }}>No open days have passed in this range yet.</div>
          ) : (
            <>
              <div className="kpis" style={{ gridTemplateColumns: "repeat(3, minmax(0, 1fr))", marginBottom: 8 }}>
                <Kpi label="Booked & earned" value={`${cap.earnedPct}%`}
                  note={`${Math.floor(cap.earnedMinutes / 60)}h of ${Math.floor(cap.availableMinutes / 60)}h open, ${cap.workingDays} working days`} />
                <Kpi label="Hours free" value={`${Math.floor((cap.availableMinutes - cap.promisedMinutes) / 60)}h`}
                  note="open hours nobody booked" />
                <Kpi label="Lost to no-shows" value={`${Math.floor(cap.noShowMinutes / 60)}h`}
                  note="held too late to resell" />
              </div>
              <p className="small muted" style={{ margin: 0 }}>
                Cancellations aren&apos;t counted as lost: those freed the slot in time.
                {cap.earnedPct >= 80 && " Nearly full: more bookings won't help much. What fills the hours matters more than how many you fill (see Top Services → Earning per hour)."}
                {cap.earnedPct <= 50 && " Plenty of open time: filling it is worth more than anything else here (see Marketing → Fill a Quiet Slot)."}
              </p>
            </>
          )}
        </div>

        <div className="card">
          <h2>Revenue by month</h2>
          <p className="sub">Confirmed revenue, every month you&apos;ve had bookings.</p>
          {!months.length ? <div className="notice" style={{ marginBottom: 0 }}>No confirmed bookings yet.</div> : (
            <ReportsBarList rows={months.map(([ym, v]) => ({
              key: ym, label: monthLabel(ym), frac: v / maxMonth, text: rand(v),
            }))} />
          )}
        </div>
      </>
    );
  } else if (section === "Trends") {
    const monday = mondayOf(today);
    const buckets = [-1, 0, 1, 2, 3].map((i) => addDays(monday, 7 * i));
    const weeks = buckets.map((ws) => {
      const we = addDays(ws, 6);
      const wb = bookings.filter((b) => ws <= b.date && b.date <= we);
      return {
        key: ws, label: fmtDayMonShort(ws),
        rev: wb.filter((b) => b.status === "confirmed").reduce((s, b) => s + bookingNet(b), 0),
        count: wb.filter((b) => b.status !== "cancelled").length,
      };
    });
    body = (
      <>
        <div className="card">
          <h2>Weekly revenue</h2>
          <p className="sub">Confirmed revenue, last week through 3 weeks ahead. This week in teal.</p>
          <ReportsColumns highlight={monday} format={(v) => `R${Math.round(v).toLocaleString("en-ZA").replace(/\s/g, " ")}`}
            points={weeks.map((w) => ({ key: w.key, label: w.label, value: w.rev }))} />
        </div>
        <div className="card">
          <h2>Weekly bookings</h2>
          <p className="sub">Volume: confirmed, pending and no-show (cancelled excluded).</p>
          <ReportsColumns highlight={monday} format={(v) => String(v)}
            points={weeks.map((w) => ({ key: w.key, label: w.label, value: w.count }))} />
        </div>
      </>
    );
  } else if (section === "Top Services") {
    const tally = new Map<string, { count: number; revenue: number }>();
    for (const b of confirmed) {
      for (const bs of b.booking_services || []) {
        const t = tally.get(bs.service_name) || { count: 0, revenue: 0 };
        t.count += 1;
        t.revenue += Number(bs.price_at_time);
        tally.set(bs.service_name, t);
      }
    }
    const ranked = [...tally.entries()].sort((a, b) => b[1].revenue - a[1].revenue).slice(0, 6);
    const maxRev = Math.max(1, ...ranked.map(([, v]) => v.revenue));
    // Total revenue always ranks the longest service first, which is the wrong
    // question for one person with one chair: the scarce thing is hours.
    const listed = listEarningRate(services.filter((s) => s.active === true));
    const realised = new Map(realisedEarningRate(bookings, today).map((r) => [r.name, r]));
    const top = Math.max(1, ...listed.map((r) => r.ratePerHour));
    body = (
      <>
        <div className="card">
          <h2>Top services</h2>
          <p className="sub">By revenue, within the range above: what&apos;s actually earning.</p>
          {!ranked.length ? <div className="notice" style={{ marginBottom: 0 }}>No confirmed bookings in this range yet.</div> : (
            <ReportsBarList rows={ranked.map(([name, v]) => ({
              key: name, label: name, frac: v.revenue / maxRev, text: `R${Math.round(v.revenue)} · ${v.count}×`,
            }))} />
          )}
        </div>
        <div className="card">
          <h2>Earning per hour</h2>
          <p className="sub">What an hour in the chair is worth: the number to promote on.</p>
          {!listed.length ? <div className="notice" style={{ marginBottom: 0 }}>Add durations to your services to see this.</div> : (
            <>
              <ReportsBarList rows={listed.slice(0, 8).map((r) => {
                const act = realised.get(r.name);
                return {
                  key: r.name, label: r.name, frac: r.ratePerHour / top,
                  text: <>R{Math.round(r.ratePerHour)}/hr · R{Math.round(r.price)} / {r.minutes}min
                    {act && act.bookings >= 3 && <><br />actual R{Math.round(act.ratePerHour)}/hr</>}</>,
                };
              })} />
              <p className="small muted" style={{ marginBottom: 0 }}>
                From your price list. “actual” appears once a service has 3+ past bookings on its own. Bookings with several
                services can&apos;t say which minutes belonged to which, so those are left out rather than guessed at.
              </p>
            </>
          )}
        </div>
      </>
    );
  } else if (section === "Clients") {
    // Retention uses all history (a rhythm doesn't fit in a week); only Busiest Days follows the range.
    const stats = retentionStats(clients, bookings, today);
    const counts = weekdayCounts(filtered);
    const occ = occupancyByWeekday(bookings, start, end, today);
    const maxCount = Math.max(1, ...counts);
    body = (
      <>
        <div className="card">
          <h2>Client loyalty</h2>
          <p className="sub">All time: do clients come back, and who&apos;s slipping away right now.</p>
          <div className="kpis" style={{ gridTemplateColumns: "repeat(3, minmax(0, 1fr))", marginBottom: 0 }}>
            <Kpi label="Returning" value={`${stats.returningPct}%`} note={`${stats.returning} of ${stats.visited} came back`} />
            <Kpi label="Avg. visits" value={stats.avgVisits} note="per client who's visited" />
            <Kpi label="At risk now" value={stats.atRisk} note="past their rhythm, nothing booked (Marketing → Win-Back)" />
          </div>
        </div>
        <div className="card">
          <h2>Busiest days</h2>
          <p className="sub">Bookings per weekday in the range above, and how full that day ran. A day that&apos;s quiet every week is the one to aim a reward at.</p>
          {!counts.some(Boolean) ? <div className="notice" style={{ marginBottom: 0 }}>No bookings in this range yet.</div> : (
            <ReportsBarList rows={DAY_NAMES.map((day, i) => {
              const n = counts[i];
              const o = occ[i];
              // "1 booking · 0% full" reads as broken; it's an hour rounding away across many weeks.
              const pct = o === 0 && n ? "<1%" : `${o}%`;
              return o === null
                ? { key: day, label: day, frac: 0, text: "closed", muted: true }
                : { key: day, label: day, frac: n / maxCount, text: `${n} booking${n !== 1 ? "s" : ""} · ${pct} full` };
            })} />
          )}
        </div>
      </>
    );
  } else {
    body = <ReportsPayroll bookings={bookings} clients={clients} today={today} onError={say} />;
  }

  return (
    <>
      <h1>Reports</h1>
      <p className="sub">How business is actually going: not just what&apos;s booked, what&apos;s been earned.</p>

      <div className="stack" style={{ gap: 8, marginBottom: 14 }}>
        <Seg value={range} options={RANGES} onChange={setRange} />
        {range === "Pick a Month" && (
          <select aria-label="Month" value={monthsWithData.includes(pickedYm) ? pickedYm : monthsWithData[0]}
            onChange={(e) => setPickedYm(e.target.value)}>
            {monthsWithData.map((ym) => <option key={ym} value={ym}>{monthLabel(ym)}</option>)}
          </select>
        )}
        {range === "Custom" && (
          <div className="fields2">
            <label className="field">From<input type="date" value={customFrom} onChange={(e) => setCustomFrom(e.target.value)} /></label>
            <label className="field">To<input type="date" value={customTo} onChange={(e) => setCustomTo(e.target.value)} /></label>
          </div>
        )}
        <span className="small muted">📅 {caption}</span>
      </div>

      <div className="kpis">
        <Kpi label="Confirmed revenue" value={rand(confirmedRevenue)}
          note={pendingRevenue ? `+ ${rand(pendingRevenue)} pending confirmation` : "nothing pending"} />
        <Kpi label="Total bookings" value={filtered.length} note={lost.length ? `${lost.length} cancelled/no-show` : "none lost"} />
        <Kpi label="Avg. confirmed value" value={rand(avgValue)} note="confirmed bookings only" />
        <Kpi label="Lost bookings" value={`${lostRate}%`}
          note={filtered.length ? `${lost.length} of ${filtered.length} bookings` : "no bookings yet"} />
      </div>

      <div style={{ marginBottom: 14 }}>
        <Seg value={section} options={SECTIONS} onChange={setSection} />
      </div>
      {body}
      {toast}
    </>
  );
}
