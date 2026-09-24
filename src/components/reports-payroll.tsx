"use client";

import Link from "next/link";
import { useState } from "react";
import { Kpi, rand } from "@/components/ui";
import {
  defaultMonth, doneBookings, exportFilename, monthLabel, monthOptions, monthStart, PAYMENT_TITLES,
  paymentSplit, payrollRows, pendingBookings, rowsToCsv, rowsToXlsx, totals, upcomingBookings,
} from "@/lib/payroll";
import { bookingNet, fmtDayMonShort, monthBounds } from "@/lib/salon";
import type { BookingWithServices, Client } from "@/lib/types";

const rand2 = (n: number) =>
  "R " + n.toLocaleString("en-ZA", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).replace(/\s/g, " ");

function download(data: BlobPart, type: string, filename: string) {
  const url = URL.createObjectURL(new Blob([data], { type }));
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

/**
 * For My Boss: the one section whose output leaves the app. Nicky is paid
 * against a list of the services she performed, so this is a document someone
 * else acts on. It deliberately ignores the page's range picker: pay is settled
 * by calendar month, and a stray "This Week" exported as the month is a short
 * payslip, not a wrong chart.
 */
export function ReportsPayroll({ bookings, clients, today, onError }: {
  bookings: BookingWithServices[]; clients: Client[]; today: string; onError: (m: string) => void;
}) {
  const options = monthOptions(bookings, today);
  const preferred = defaultMonth(today);
  const [picked, setPicked] = useState<string>(options.includes(preferred) ? preferred : options[0]);
  const [busy, setBusy] = useState(false);

  const label = monthLabel(picked);
  const [pStart, pEnd] = monthBounds(monthStart(picked));
  const rows = payrollRows(bookings, clients, pStart, pEnd, today);
  const t = totals(rows);
  const stillPending = pendingBookings(bookings, pStart, pEnd, today);
  const later = upcomingBookings(bookings, pStart, pEnd, today);
  // Where the money went: card to the owner's machine, cash in her apron.
  const split = paymentSplit(doneBookings(bookings, pStart, pEnd, today), bookingNet);
  const unrec = split.find((s) => s.method === "unrecorded");

  async function xlsx() {
    setBusy(true);
    try {
      const bytes = await rowsToXlsx(rows, picked, today);
      download(bytes as BlobPart, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", exportFilename(picked, "xlsx"));
    } catch (e) {
      onError(`Couldn't build the Excel file: ${e instanceof Error ? e.message : String(e)}. The CSV still works.`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <h2>Services for your pay</h2>
      <p className="sub">
        One month of the work you actually did, as a spreadsheet you can edit before sending it on.
        Pick the month right here. The range buttons at the top of the page don&apos;t change it.
      </p>
      <label className="field" style={{ marginBottom: 14 }}>Month
        <select value={picked} onChange={(e) => setPicked(e.target.value)}>
          {options.map((k) => <option key={k} value={k}>{monthLabel(k)}</option>)}
        </select>
      </label>

      {stillPending.length > 0 && (
        <div className="notice warn">
          ⚠️ <b>{stillPending.length} appointment{stillPending.length === 1 ? "" : "s"} in {label} {stillPending.length === 1 ? "is" : "are"} still
          marked pending</b>, worth {rand(stillPending.reduce((s, b) => s + bookingNet(b), 0))}, and left out of this list.
          Say whether each one happened first, or you&apos;ll hand in a month that&apos;s short.{" "}
          <Link href="/">Sort them out on Today →</Link>
        </div>
      )}
      {later.length > 0 && (
        <div className="notice">
          🗓️ {later.length} confirmed booking{later.length === 1 ? "" : "s"} later in {label} {later.length === 1 ? "is" : "are"} not
          counted. That work hasn&apos;t happened yet. Export again once the month is over.
        </div>
      )}

      {!rows.length ? (
        <div className="notice">Nothing to export for {label} yet. No confirmed appointments in that month have happened.</div>
      ) : (
        <>
          <div className="kpis" style={{ gridTemplateColumns: "repeat(3, minmax(0, 1fr))" }}>
            <Kpi label="Appointments" value={t.appointments} />
            <Kpi label="Services done" value={t.services} />
            <Kpi label="Total" value={<span style={{ fontSize: 20 }}>{rand2(t.total)}</span>} />
          </div>

          <div className="card">
            <h3>How it was paid</h3>
            <p className="small muted" style={{ marginTop: 0 }}>Same money as above, grouped by where it went.</p>
            <div className="kpis" style={{ marginBottom: 0 }}>
              {split.map((s) => (
                <Kpi key={s.method} label={PAYMENT_TITLES[s.method] ?? s.method} value={rand(s.total)}
                  note={`${s.count} appointment${s.count !== 1 ? "s" : ""}`} tone={s.method === "unrecorded" ? "down" : undefined} />
              ))}
            </div>
            {unrec && (
              <p className="small muted" style={{ marginBottom: 0 }}>
                {rand(unrec.total)} has no payment method recorded. Open those bookings and tick how they paid, or your
                boss and you will be reconciling from memory.
              </p>
            )}
          </div>

          <div className="fields2" style={{ marginBottom: 8 }}>
            <button className="gold" onClick={xlsx} disabled={busy}>⬇️ Excel (.xlsx)</button>
            <button className="ghost" onClick={() => download(rowsToCsv(rows), "text/csv", exportFilename(picked, "csv"))}>
              ⬇️ CSV
            </button>
          </div>
          <p className="small muted">
            The Excel file has a <b>Summary</b> tab too, and live totals: change a line and the total follows. Take the
            CSV if your boss doesn&apos;t use Excel. For a PDF, open either one and print to PDF.
          </p>

          {/* Narrow on purpose: the year is noise inside one month, and on a phone the Amount column must stay on screen. */}
          <div className="card tight" style={{ maxHeight: 360, overflowY: "auto" }}>
            <table>
              <thead>
                <tr><th>Date</th><th>Client</th><th>Service</th><th className="num">Amount</th></tr>
              </thead>
              <tbody>
                {rows.map((r, i) => (
                  <tr key={i}>
                    <td style={{ whiteSpace: "nowrap" }}>{fmtDayMonShort(r.date)}</td>
                    <td style={{ wordBreak: "break-word" }}>{r.client}</td>
                    <td style={{ wordBreak: "break-word", color: r.kind === "discount" ? "var(--danger)" : undefined }}>{r.service}</td>
                    <td className="num">{r.amount.toFixed(2)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="small muted">
            A loyalty discount shows as its own “Discount” line rather than being smeared across that visit&apos;s
            services, so the total here is exactly the money the salon took, the same number Reports shows everywhere else.
          </p>
        </>
      )}
    </>
  );
}
