"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useSalon } from "@/components/data";
import { rand, Seg, Sheet } from "@/components/ui";
import {
  ClientPicker, defaultServiceIds, endTime, lineFromOpt, phoneProblem, resolveClient, serviceOptions,
  ServicePicker, useFirstVisits, type ClientChoice, type Line,
} from "@/components/bookings-shared";
import { addBooking, addClient, deleteBooking, updateBooking, type PickedService } from "@/lib/db";
import {
  bookingTitle, completedVisitCount, findCollision, fmtWeekdayDayMonth, loyaltyDiscountDue,
  PACKAGE_CATEGORY, PAYMENT_LABELS, PAYMENT_METHODS, pyRound,
} from "@/lib/salon";
import type { BookingStatus, BookingWithServices, PaymentMethod } from "@/lib/types";

/** What a new booking can be pre-filled with (Day-view slot, Week "+", rebooking handoff). */
export interface NewBookingDraft {
  clientId?: string | null;
  date: string;
  time?: string; // 'HH:MM'
  serviceIds?: string[];
  duration?: number;
}

const STATUSES: [BookingStatus, string][] = [
  ["confirmed", "Confirmed"], ["pending", "Pending"], ["cancelled", "Cancelled"], ["no-show", "No-show"],
];
type PayChoice = "none" | PaymentMethod;
const PAY_OPTIONS: [PayChoice, string][] = [["none", "Not yet"], ...PAYMENT_METHODS.map((m) => [m, PAYMENT_LABELS[m]] as [PayChoice, string])];

const toInt = (s: string) => {
  const n = parseInt(s, 10);
  return Number.isFinite(n) ? n : 0;
};

/**
 * New and edit booking in one sheet. Nothing is lost to a stray tap: the sheet
 * only closes on Close, Cancel, Save or Delete.
 */
export function BookingSheet({ booking, draft, onClose, onDone }: {
  booking?: BookingWithServices;
  draft?: NewBookingDraft;
  onClose: () => void;
  onDone: (msg: string) => void;
}) {
  const { clients, services, bookings, clientById, today, reload } = useSalon();
  const isEdit = Boolean(booking);
  const opts = useMemo(() => serviceOptions(services), [services]);
  const svcById = useMemo(() => new Map(services.map((s) => [s.id, s])), [services]);
  const fv = useFirstVisits(clients, bookings);

  // ---- initial state ----
  const initialLines = (): Line[] => {
    if (booking) {
      return booking.booking_services.map((bs, i) => {
        const s = bs.service_id ? svcById.get(bs.service_id) : undefined;
        return {
          key: `${bs.id}-${i}`, service_id: bs.service_id, name: bs.service_name, price: Number(bs.price_at_time),
          duration: s?.duration_minutes ?? 0, pkg: s?.category === PACKAGE_CATEGORY,
        };
      });
    }
    const ids = draft?.serviceIds?.length ? draft.serviceIds : defaultServiceIds(opts);
    return ids.map((id) => opts.find((o) => o.id === id)).filter((o) => o != null).map(lineFromOpt);
  };
  const [lines, setLines] = useState<Line[]>(initialLines);
  const [origLineSig] = useState(() => lines.map((l) => `${l.service_id}|${l.name}|${l.price}`).join(","));
  const sumDuration = (ls: Line[]) => ls.reduce((s, l) => s + l.duration, 0) || 30;

  const [choice, setChoice] = useState<ClientChoice>(() =>
    booking?.client_id ? { kind: "existing", id: booking.client_id }
      : draft?.clientId && clientById.has(draft.clientId) ? { kind: "existing", id: draft.clientId } : { kind: "none" });
  const [date, setDate] = useState(booking?.date ?? draft?.date ?? today);
  const [time, setTime] = useState((booking?.time ?? draft?.time ?? "09:00").slice(0, 5));
  // Duration follows the services until she types her own.
  const [durAuto, setDurAuto] = useState(() =>
    booking ? booking.duration_minutes === sumDuration(lines) : draft?.duration == null);
  const [durText, setDurText] = useState(String(booking?.duration_minutes ?? draft?.duration ?? sumDuration(lines)));
  const [status, setStatus] = useState<BookingStatus>(booking?.status ?? "confirmed");
  const [discount, setDiscount] = useState(String(Math.round(booking?.discount || 0)));
  const [tip, setTip] = useState(String(Math.round(booking?.tip || 0)));
  const [pay, setPay] = useState<PayChoice>(booking?.payment_method ?? "none");
  const [notes, setNotes] = useState(booking?.notes ?? "");
  const [error, setError] = useState<string | null>(null);
  const [confirmClash, setConfirmClash] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => { if (durAuto) setDurText(String(sumDuration(lines))); }, [lines, durAuto]);

  const duration = toInt(durText);
  const disc = Math.max(0, toInt(discount));
  const tipN = Math.max(0, toInt(tip));
  const gross = lines.reduce((s, l) => s + l.price, 0);
  const net = Math.max(0, gross - disc);

  // A changed date/time/length is a new question: ask about any overlap again.
  useEffect(() => { setConfirmClash(false); }, [date, time, duration]);

  const clash = date && /^\d{2}:\d{2}$/.test(time) ? findCollision(bookings, date, time, duration || 30, booking?.id ?? null) : null;
  const clashName = clash?.client_id ? clientById.get(clash.client_id)?.name ?? "someone" : "someone";

  const client = resolveClient(choice, clients, clientById);

  // Loyalty: tell her on the spot that this visit is the 20%-off one.
  let loyalty: { visits: number; reward: number } | null = null;
  if (client && lines.length && date >= today) {
    const visits = completedVisitCount(client, bookings, today);
    if (loyaltyDiscountDue(visits)) loyalty = { visits, reward: pyRound(gross * 0.2) };
  }

  // New Client: the client's first booking, so she can greet them as one.
  let newClient: { kind: "brand-new" | "no-history"; clientId?: string } | null = null;
  if (booking) {
    if (booking.status !== "cancelled" && booking.status !== "no-show" && fv.get(booking.client_id) === booking.date + booking.time) {
      newClient = { kind: "no-history", clientId: booking.client_id ?? undefined };
    }
  } else if (choice.kind === "new" && !client && choice.name.trim()) {
    newClient = { kind: "brand-new" };
  } else if (client && !(client.prior_visits || []).length) {
    const earliest = fv.get(client.id);
    const key = `${date}${time}`;
    if (!earliest || key < earliest.slice(0, key.length)) newClient = { kind: "no-history", clientId: client.id };
  }

  async function save() {
    setError(null);
    if (!isEdit && (choice.kind === "none" || (choice.kind === "new" && !choice.name.trim()))) {
      return setError("Pick a client, or add a new one.");
    }
    if (!lines.length) return setError("Choose at least one service.");
    const bad = !client ? phoneProblem(choice) : null;
    if (bad) return setError(bad);
    if (!date) return setError("Choose a date.");
    if (!/^\d{2}:\d{2}$/.test(time)) return setError("Choose a start time.");
    if (duration < 5) return setError("Duration must be at least 5 minutes.");
    if (clash && !confirmClash) {
      setConfirmClash(true);
      return;
    }
    const payload: PickedService[] = lines.map((l) => ({ service_id: l.service_id, service_name: l.name, price: l.price }));
    const fields = {
      date, time, duration_minutes: duration, status, notes: notes.trim() || null,
      discount: disc, tip: tipN, payment_method: pay === "none" ? null : pay,
    };
    setBusy(true);
    try {
      if (booking) {
        const sig = lines.map((l) => `${l.service_id}|${l.name}|${l.price}`).join(",");
        // Unchanged lines keep their original snapshot rows untouched.
        await updateBooking(booking.id, fields, sig === origLineSig ? undefined : payload);
        await reload();
        onDone("Booking updated.");
      } else {
        let c = client;
        if (!c && choice.kind === "new") c = await addClient({ name: choice.name.trim(), phone: choice.phone.trim() || null });
        if (!c) throw new Error("No client chosen.");
        await addBooking({ client_id: c.id, ...fields }, payload);
        await reload();
        onDone(`Booking saved for ${c.name}.`);
      }
      onClose();
    } catch (e) {
      setError(`Couldn't save: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (!booking) return;
    setBusy(true);
    try {
      await deleteBooking(booking.id);
      await reload();
      onDone("Booking deleted.");
      onClose();
    } catch (e) {
      setError(`Couldn't delete: ${e instanceof Error ? e.message : String(e)}`);
      setBusy(false);
    }
  }

  const clashBox = clash && (
    <div className="bk-clash" role="alert">
      <strong>⚠️ Double-booking: this overlaps {clashName}</strong>
      {clashName} is booked {clash.time.slice(0, 5)}–{endTime(clash)} on {fmtWeekdayDayMonth(clash.date)} ({bookingTitle(clash)}).
      {" "}This booking would run {time}–{/^\d{2}:\d{2}$/.test(time) ? endTime({ time, duration_minutes: duration || 30 }) : "?"}.
    </div>
  );

  return (
    <Sheet title={isEdit ? "Edit booking" : "New booking"} onClose={onClose}>
      <div className="stack">
        {isEdit ? (
          <div className="stack" style={{ gap: 6 }}>
            <span className="bk-label">Client</span>
            <div className="bk-line" style={{ padding: "10px 12px" }}>
              <div className="grow" style={{ fontWeight: 600 }}>{client?.name ?? "Unknown client"}</div>
              {client && <Link href={`/clients/?id=${client.id}`} className="small">Profile →</Link>}
            </div>
          </div>
        ) : (
          <ClientPicker clients={clients} byId={clientById} value={choice} onChange={setChoice} />
        )}

        {newClient && (
          <div className="bk-newc" role="status">
            <strong>✨ New Client{client ? `: ${client.name}` : choice.kind === "new" ? `: ${choice.name.trim()}` : ""}</strong>
            {isEdit ? "This is her first visit on record." : "This will be her first visit on record."} Give her the full welcome,
            and note her shape and shade afterwards.
            {newClient.clientId && (
              <div className="small" style={{ marginTop: 6 }}>
                Been coming for years? Add her past visits on{" "}
                <Link href={`/clients/?id=${newClient.clientId}`}>her profile</Link> so loyalty and recall count them.
              </div>
            )}
          </div>
        )}

        <div className="fields2">
          <label className="field">Date
            <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </label>
          <label className="field">Time
            <input type="time" step={300} value={time} onChange={(e) => setTime(e.target.value)} />
          </label>
        </div>

        {clashBox}

        <ServicePicker opts={opts} lines={lines} onChange={setLines} />

        <label className="field">Duration (minutes)
          <input type="number" inputMode="numeric" min={5} step={5} value={durText}
            onChange={(e) => { setDurAuto(false); setDurText(e.target.value); }} />
          {!durAuto && duration !== sumDuration(lines) && (
            <button type="button" className="linkish" style={{ alignSelf: "flex-start", fontSize: 13 }}
              onClick={() => setDurAuto(true)}>Use the services&apos; time ({sumDuration(lines)} min)</button>
          )}
        </label>

        {loyalty && (disc ? (
          <div className="bk-loyal">💛 <span className="grow">{client?.name}&apos;s loyalty reward: visit {loyalty.visits} done, discount is in.</span></div>
        ) : (
          <div className="bk-loyal" role="status">
            <span className="grow">💛 <b>Loyalty reward due</b>: {loyalty.visits} visits done, this one is 20% off ({rand(loyalty.reward)}).</span>
            <button type="button" className="gold" onClick={() => setDiscount(String(loyalty!.reward))}>Apply −R{loyalty.reward}</button>
          </div>
        ))}

        <div className="fields2">
          <label className="field">Discount (R)
            <input type="number" inputMode="numeric" min={0} step={10} value={discount} onChange={(e) => setDiscount(e.target.value)} />
            <span className="small muted" style={{ fontWeight: 400 }}>Reduces what the visit earned.</span>
          </label>
          <label className="field">Tip (R)
            <input type="number" inputMode="numeric" min={0} step={10} value={tip} onChange={(e) => setTip(e.target.value)} />
            <span className="small muted" style={{ fontWeight: 400 }}>Never counted as revenue.</span>
          </label>
        </div>

        {/* "Not yet" by default: a booking is usually made before she's paid, and a
            pre-ticked Cash would be a made-up fact. */}
        <div className="stack" style={{ gap: 6 }}>
          <span className="bk-label">Paid with</span>
          <div className="bk-segfull"><Seg value={pay} options={PAY_OPTIONS} onChange={setPay} /></div>
          <span className="small muted">Doesn&apos;t change what the visit earned, only where that money is until you settle up.</span>
        </div>

        <div className="stack" style={{ gap: 6 }}>
          <span className="bk-label">Status</span>
          <div className="bk-segfull"><Seg value={status} options={STATUSES} onChange={setStatus} /></div>
        </div>

        <label className="field">Comments
          <textarea value={notes} onChange={(e) => setNotes(e.target.value)}
            placeholder="Anything worth remembering: allergies, requests, running late, etc." />
        </label>

        <div className="bk-total">
          <div className="small muted">She pays</div>
          <div className="big">{rand(net + tipN)}</div>
          <div className="small">
            Services {rand(gross)}{disc ? ` − ${rand(disc)} discount` : ""} = <b>{rand(net)} earned</b>
            {tipN ? ` · + ${rand(tipN)} tip (yours, not revenue)` : ""}
          </div>
        </div>

        {/* The footer sticks to the bottom of the sheet, so an error or the
            double-booking question is always in view right beside Save. */}
        <div className="bk-foot">
          {error && <div className="notice danger" role="alert" style={{ margin: 0 }}>{error}</div>}
          {confirmClash && clash && !confirmDelete && (
            <div className="bk-clash" role="alert">
              <strong>⚠️ Save it anyway?</strong>
              It overlaps {clashName} at {clash.time.slice(0, 5)}–{endTime(clash)}. Change the time, or tap “Yes, double-book” if it&apos;s a genuine squeeze-in.
            </div>
          )}
          {confirmDelete ? (
            <div className="bk-clash">
              <strong>Delete this booking?</strong>
              This can&apos;t be undone.
              <div className="row" style={{ marginTop: 10 }}>
                <button type="button" className="danger" disabled={busy} onClick={remove}>Yes, delete</button>
                <button type="button" className="ghost" disabled={busy} onClick={() => setConfirmDelete(false)}>Keep it</button>
              </div>
            </div>
          ) : (
            <div className="bk-actions">
              {isEdit && <button type="button" className="danger" disabled={busy} onClick={() => setConfirmDelete(true)}>Delete</button>}
              <button type="button" className="ghost" disabled={busy} onClick={onClose}>Cancel</button>
              <button type="button" disabled={busy} onClick={save}
                style={confirmClash && clash ? { background: "var(--danger)", borderColor: "var(--danger)", color: "#fff" } : undefined}>
                {busy ? "Saving…" : confirmClash && clash ? "Yes, double-book" : "Save"}
              </button>
            </div>
          )}
        </div>
      </div>
    </Sheet>
  );
}
