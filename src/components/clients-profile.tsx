"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { ClientPhotos } from "@/components/clients-photos";
import { CalendarPlus, ChevronRight, Gift, History, PartyPopper, Pencil, Sparkles } from "lucide-react";
import { Contact } from "@/components/ui";
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

  const stamps = Math.round((pct / 100) * 5);
  return (
    <>
      <style>{PROFILE_CSS}</style>
      <div className="card pf-head">
        <button className="ghost pill pf-edit" onClick={onEdit}><Pencil size={15} />Edit</button>
        <span className="avatar lg">{clientInitial(client.name)}</span>
        <h2 className="pf-name">{client.name}</h2>
        <div className="small muted">{client.phone || "No number on file"}{client.birthday ? ` · Birthday ${birthdayLabel(client.birthday)}` : ""}</div>
        {notes.length > 0 && <div className="pf-notes">{notes.map((n) => <span key={n} className="badge muted">{n}</span>)}</div>}
        {client.phone && <div className="pf-contact"><Contact phone={client.phone} message={`Hi ${firstName(client.name)}! It's Nicky from Beauty & Nails 💅 `} /></div>}
      </div>

      {nxt && (
        <button className="pf-next" onClick={bookNext}>
          <span className="pf-next-ico"><CalendarPlus size={22} /></span>
          <span className="grow">
            <span className="eyebrow" style={{ color: "#E7C995" }}>Book her next visit</span>
            <b>{fmtWeekdayDayMonth(nxt.date)} at {hhmm(nxt.startMin)}</b>
            <span>Every ~{nxt.gapDays} days{usual}. Opens filled in, change anything first.</span>
          </span>
          <ChevronRight size={20} />
        </button>
      )}

      <div className="pf-tiles">
        <div><span>Shape</span><b>{client.shape || "—"}</b></div>
        <div><span>Shade</span><b>{client.shade || "—"}</b></div>
        <div><span>Visits</span><b>{visitsCount}</b></div>
      </div>

      <div className="card">
        <div className="card-head"><h2><Gift size={18} />Loyalty card</h2>
          {kind === "progress" && <span className="small muted">{toNext} to go</span>}</div>
        <div className="pf-stamps" role="img" aria-label={`${stamps} of 5 stamps`}>
          {Array.from({ length: 5 }, (_, i) => (
            <span key={i} className={i < stamps ? "on" : ""}>{i === 4 ? <Gift size={18} /> : <Sparkles size={16} />}</span>
          ))}
        </div>
        {kind === "none" && (
          <p className="small muted" style={{ marginBottom: 0 }}>
            Stamps start once a confirmed booking&apos;s date has passed.
          </p>
        )}
        {kind === "due" && (
          <div className="notice warn" style={{ margin: "12px 0 0" }}>
            <PartyPopper size={18} /><span>Visit {visitsCount} done. <b>Her next visit is 20% off.</b></span>
          </div>
        )}
        {kind === "progress" && (
          <p className="small muted" style={{ marginBottom: 0 }}>
            Every 5th visit earns 20% off the next. {toNext} more visit{toNext !== 1 ? "s" : ""} to go.
          </p>
        )}
      </div>

      <ClientPhotos clientId={client.id} bookings={bookings} today={today} say={say} />

      <div className="card">
        <div className="card-head"><h2><History size={18} />Visit history</h2></div>
        {!visits.length && <p className="muted" style={{ margin: 0 }}>No visits on file yet.</p>}
        <div className="list nw">
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

const PROFILE_CSS = `
.pf-head { display: flex; flex-direction: column; align-items: center; text-align: center; gap: 4px; padding-top: 24px; position: relative; }
.pf-head .avatar.lg { width: 76px; height: 76px; font-size: 32px; background: linear-gradient(145deg, var(--teal-soft), #D3E5E1); margin-bottom: 6px; }
.pf-name { font-family: var(--serif); font-weight: 450; font-size: 26px; letter-spacing: -0.015em; margin: 0; overflow-wrap: anywhere; justify-content: center; }
.pf-edit { position: absolute; top: 12px; right: 12px; min-height: 38px; padding: 4px 12px; font-size: 13.5px; }
.pf-notes { display: flex; flex-wrap: wrap; gap: 6px; justify-content: center; margin-top: 6px; }
.pf-contact { margin-top: 12px; }
button.pf-next { width: 100%; display: flex; align-items: center; gap: 14px; text-align: left; padding: 16px; border-radius: 22px; margin-bottom: 14px; min-height: 0;
  background: radial-gradient(120% 140% at 100% 0%, #2B7169 0%, var(--teal) 60%); color: #fff; box-shadow: 0 14px 30px -18px rgba(15,59,56,0.8); font-weight: 400; }
button.pf-next .grow { display: flex; flex-direction: column; gap: 2px; }
button.pf-next b { font-family: var(--serif); font-weight: 450; font-size: 19px; }
button.pf-next .grow > span:last-child { font-size: 12.5px; color: rgba(255,255,255,0.75); }
.pf-next-ico { width: 44px; height: 44px; border-radius: 14px; background: rgba(255,255,255,0.12); display: grid; place-items: center; flex: none; color: #E7C995; }
.pf-tiles { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 8px; margin-bottom: 14px; }
.pf-tiles > div { background: var(--card); border-radius: 18px; padding: 12px; box-shadow: var(--shadow-1); min-width: 0; }
.pf-tiles span { display: block; font-size: 12px; font-weight: 650; color: var(--ink-soft); }
.pf-tiles b { display: block; font-family: var(--serif); font-weight: 450; font-size: 20px; overflow-wrap: anywhere; line-height: 1.2; margin-top: 2px; }
.pf-stamps { display: grid; grid-template-columns: repeat(5, minmax(0, 1fr)); gap: 8px; }
.pf-stamps span { aspect-ratio: 1; max-height: 56px; border-radius: 50%; display: grid; place-items: center; border: 2px dashed var(--line-2); color: var(--ink-faint); justify-self: center; width: 100%; max-width: 56px; }
.pf-stamps span.on { border: 0; background: linear-gradient(145deg, #CBA36A, var(--gold-2)); color: #fff; box-shadow: 0 6px 14px -8px rgba(166,122,63,0.9); animation: pop .3s var(--ease) both; }
`;
