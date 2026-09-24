"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { ClientPhotos } from "@/components/clients-photos";
import { Contact, Kpi } from "@/components/ui";
import { cadence, reliability, suggestNextVisit } from "@/lib/insights";
import {
  clientHasUpcoming, clientInitial, clientVisits, completedVisitCount, firstName, fmtDayMonth,
  fmtWeekdayDayMonth, isEstimatedVisit, loyaltyProgress,
} from "@/lib/salon";
import type { BookingWithServices, Client } from "@/lib/types";

const HISTORY_PREVIEW = 12;

function hhmm(min: number): string {
  return `${String(Math.floor(min / 60)).padStart(2, "0")}:${String(min % 60).padStart(2, "0")}`;
}

function birthdayLabel(b: string | null): string {
  if (!b || !/^\d{2}-\d{2}$/.test(b)) return "—";
  return fmtDayMonth(`2000-${b}`);
}

export function ClientProfile({ client, bookings, today, onEdit, say }: {
  client: Client;
  bookings: BookingWithServices[];
  today: string;
  onEdit: () => void;
  say: (msg: string) => void;
}) {
  const router = useRouter();
  const [allHistory, setAllHistory] = useState(false);

  const visitsCount = completedVisitCount(client, bookings, today);
  const [pct, toNext, kind] = loyaltyProgress(visitsCount);
  const cad = cadence(client, bookings, today);
  const rel = reliability(client, bookings, today);
  const visits = clientVisits(client, bookings, today);
  const estimated = visits.filter((v) => isEstimatedVisit(v)).length;

  // Booking the next visit before she stands up is the strongest retention
  // lever there is, and unlike a discount it costs nothing — which matters when
  // prices aren't Nicky's to set. One tap, pre-filled with her own rhythm, her
  // usual time and what she just had.
  const nxt = clientHasUpcoming(client, bookings, today) ? null : suggestNextVisit(client, bookings, today);
  const usual = nxt?.atUsualTime ? " (her usual time)" : "";
  function bookNext() {
    if (!nxt) return;
    const q = new URLSearchParams({
      new: "1", client: client.id, date: nxt.date, time: hhmm(nxt.startMin),
      services: nxt.serviceIds.join(","), duration: String(nxt.duration),
    });
    router.push(`/bookings/?${q.toString()}`);
  }

  // Quiet, factual lines she sees but a client looking over her shoulder won't
  // be confronted by — rhythm always, no-shows only when there are any.
  const notes: string[] = [];
  if (cad?.typicalGapDays) notes.push(`Usually visits every ~${cad.typicalGapDays} days`);
  if (rel.noShows) {
    notes.push(`${rel.noShows} no-show${rel.noShows !== 1 ? "s" : ""} in ${rel.held} kept booking${rel.held !== 1 ? "s" : ""}`);
  }

  const shown = allHistory ? visits : visits.slice(0, HISTORY_PREVIEW);

  return (
    <>
      <div className="card">
        <div className="row" style={{ flexWrap: "nowrap", alignItems: "flex-start" }}>
          <span className="avatar" style={{ width: 48, height: 48, fontSize: 19 }}>{clientInitial(client.name)}</span>
          <div className="grow">
            <h2 style={{ fontFamily: "var(--serif)", fontWeight: 500, fontSize: 22, margin: 0, overflowWrap: "anywhere" }}>{client.name}</h2>
            <div className="small muted">{client.phone || "No number"} · Birthday {birthdayLabel(client.birthday)}</div>
          </div>
          <button className="ghost" onClick={onEdit}>Edit</button>
        </div>

        <div style={{ marginTop: 12 }}>
          <Contact phone={client.phone} message={`Hi ${firstName(client.name)}! It's Nicky from Beauty & Nails 💅 `} />
        </div>

        {nxt && (
          <div style={{ marginTop: 12 }}>
            <button className="gold" style={{ width: "100%" }} onClick={bookNext}>
              📅 Book next visit — {fmtWeekdayDayMonth(nxt.date)} at {hhmm(nxt.startMin)}
            </button>
            <div className="small muted" style={{ marginTop: 4 }}>
              Comes in about every {nxt.gapDays} days{usual} · nothing booked yet. Opens the booking already
              filled in — change anything before saving.
            </div>
          </div>
        )}
      </div>

      <div className="kpis" style={{ gridTemplateColumns: "repeat(3, minmax(0, 1fr))" }}>
        <Kpi label="Shape" value={<span style={{ fontSize: 18, overflowWrap: "anywhere" }}>{client.shape || "—"}</span>} />
        <Kpi label="Shade" value={<span style={{ fontSize: 18, overflowWrap: "anywhere" }}>{client.shade || "—"}</span>} />
        <Kpi label="Visits" value={visitsCount} note="completed" />
      </div>

      <div className="card">
        <h3>Loyalty progress</h3>
        <div className="bar" role="progressbar" aria-valuenow={Math.round(pct)} aria-valuemin={0} aria-valuemax={100}>
          <span style={{ width: `${pct}%` }} />
        </div>
        {kind === "none" && (
          <p className="small muted" style={{ marginBottom: 0 }}>
            No completed visits yet — loyalty tracking starts once a booking is confirmed and the date has passed.
          </p>
        )}
        {kind === "due" && (
          <div className="notice" style={{ margin: "10px 0 0" }}>
            🎉 Visit {visitsCount} complete — <b>20% off is due on her next visit!</b>
          </div>
        )}
        {kind === "progress" && (
          <p className="small muted" style={{ marginBottom: 0 }}>
            {toNext} more visit{toNext !== 1 ? "s" : ""} until 20% off (every 5th visit).
          </p>
        )}
        {notes.length > 0 && <p className="small muted" style={{ marginBottom: 0 }}>{notes.join(" · ")}</p>}
      </div>

      <ClientPhotos clientId={client.id} bookings={bookings} today={today} say={say} />

      <div className="card">
        <h2>Visit history</h2>
        {!visits.length && <p className="muted" style={{ margin: 0 }}>No visits on file yet.</p>}
        <div className="list">
          {shown.map((v, i) => {
            // Estimated visits carry a made-up date by construction, so never
            // show one as though it were a real appointment.
            const est = isEstimatedVisit(v);
            return (
              <div key={`${v.date}-${i}`} className="item" style={{ minHeight: 44, padding: "8px 2px" }}>
                <div className="grow">
                  <div className={est ? "muted" : "title"} style={est ? { fontStyle: "italic" } : undefined}>{v.label}</div>
                  <div className="meta">{est ? `~${fmtDayMonth(v.date)} ${v.date.slice(0, 4)}` : `${fmtDayMonth(v.date)} ${v.date.slice(0, 4)}`}</div>
                </div>
                {est ? <span className="badge muted">Estimated</span> : (
                  <>
                    {v.status !== "confirmed" && (
                      <span className={`badge ${v.status === "no-show" ? "danger" : v.status === "pending" ? "gold" : "muted"}`}>
                        {v.status === "no-show" ? "No-show" : v.status[0].toUpperCase() + v.status.slice(1)}
                      </span>
                    )}
                    <span style={{ fontWeight: 700, whiteSpace: "nowrap" }}>{v.priceLabel}</span>
                  </>
                )}
              </div>
            );
          })}
        </div>
        {visits.length > HISTORY_PREVIEW && (
          <button className="linkish" onClick={() => setAllHistory(!allHistory)}>
            {allHistory ? "Show fewer" : `Show all ${visits.length} visits`}
          </button>
        )}
        {estimated > 0 && (
          <p className="small muted" style={{ marginBottom: 0 }}>
            {estimated} visit{estimated !== 1 ? "s" : ""} from before this app — dates are estimated from how often she
            comes, and count toward loyalty but never toward revenue.
          </p>
        )}
      </div>
    </>
  );
}
