"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, CalendarClock, ChevronDown, Gift, Sparkles, Trash2, UserRound } from "lucide-react";
import { useSalon } from "@/components/data";
import { rand, Seg, Sheet } from "@/components/ui";
import {
  ClientPicker, endTime, lineFromOpt, phoneProblem, resolveClient, serviceOptions,
  ServicePicker, useFirstVisits, type ClientChoice, type Line,
} from "@/components/bookings-shared";
import { DayGlance, DayStrip, DurationStepper, TimeSlots, WHEN_CSS } from "@/components/when-picker";
import { addBooking, addClient, deleteBooking, updateBooking, type PickedService } from "@/lib/db";
import {
  bookingTitle, completedVisitCount, dayOfMonth, findCollision, fmtWeekdayDayMonth, loyaltyDiscountDue, monthName, weekday,
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
    // A new booking starts with no service picked (unless handed one): a
    // pre-ticked guess is one more thing to notice and undo.
    const ids = draft?.serviceIds ?? [];
    return ids.map((id) => opts.find((o) => o.id === id)).filter((o) => o != null).map(lineFromOpt);
  };
  const [lines, setLines] = useState<Line[]>(initialLines);
  const [origLineSig] = useState(() => lines.map((l) => `${l.service_id}|${l.name}|${l.price}`).join(","));
  const sumDuration = (ls: Line[]) => ls.reduce((s, l) => s + l.duration, 0) || 30;

  const [choice, setChoice] = useState<ClientChoice>(() =>
    booking?.client_id ? { kind: "existing", id: booking.client_id }
      : draft?.clientId && clientById.has(draft.clientId) ? { kind: "existing", id: draft.clientId } : { kind: "none" });
  const [date, setDate] = useState(booking?.date ?? draft?.date ?? today);
  const [time, setTime] = useState<string | null>((booking?.time ?? draft?.time)?.slice(0, 5) ?? null);
  // Duration follows the services until she types her own.
  const [durAuto, setDurAuto] = useState(() =>
    booking ? booking.duration_minutes === sumDuration(lines) : draft?.duration == null);
  const [duration, setDuration] = useState<number>(booking?.duration_minutes ?? draft?.duration ?? sumDuration(lines));
  const [details, setDetails] = useState(isEdit);
  const [status, setStatus] = useState<BookingStatus>(booking?.status ?? "confirmed");
  const [discount, setDiscount] = useState(String(Math.round(booking?.discount || 0)));
  const [tip, setTip] = useState(String(Math.round(booking?.tip || 0)));
  const [pay, setPay] = useState<PayChoice>(booking?.payment_method ?? "none");
  const [notes, setNotes] = useState(booking?.notes ?? "");
  const [error, setError] = useState<string | null>(null);
  const [confirmClash, setConfirmClash] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => { if (durAuto) setDuration(sumDuration(lines)); }, [lines, durAuto]);

  const disc = Math.max(0, toInt(discount));
  const tipN = Math.max(0, toInt(tip));
  const gross = lines.reduce((s, l) => s + l.price, 0);
  const net = Math.max(0, gross - disc);

  // A changed date/time/length is a new question: ask about any overlap again.
  useEffect(() => { setConfirmClash(false); }, [date, time, duration]);

  const clash = date && time ? findCollision(bookings, date, time, duration || 30, booking?.id ?? null) : null;
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
    const key = `${date}${time ?? ""}`;
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
    if (!time) return setError("Pick a time.");
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

  const endLabel = time ? endTime({ time, duration_minutes: duration || 30 }) : null;
  const clashBox = clash && (
    <div className="bk-clash" role="alert">
      <strong><AlertTriangle size={18} /> Overlaps {clashName}</strong>
      {clashName} is booked {clash.time.slice(0, 5)}–{endTime(clash)} on {fmtWeekdayDayMonth(clash.date)} ({bookingTitle(clash)}).
      {" "}This one would run {time}–{endLabel}.
    </div>
  );
  const whenLabel = `${["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"][weekday(date)]} ${dayOfMonth(date)} ${monthName(date).slice(0, 3)}`;
  const statusLabel = STATUSES.find(([v]) => v === status)?.[1] ?? status;
  const payLabel = PAY_OPTIONS.find(([v]) => v === pay)?.[1] ?? "";

  return (
    <Sheet title={isEdit ? "Edit booking" : "New booking"} onClose={onClose}>
      <style>{WHEN_CSS}</style>
      <div className="stack bs">
        <div className="section">
          <div className="section-label"><UserRound size={14} />Client
            {isEdit && client && <Link href={`/clients/?id=${client.id}`} className="aside">Profile</Link>}</div>
          {isEdit ? (
            <div className="cp-picked">
              <span className="avatar">{(client?.name || "?").trim().charAt(0).toUpperCase()}</span>
              <div className="grow"><div className="sp-name">{client?.name ?? "Unknown client"}</div>{client?.phone && <div className="small muted">{client.phone}</div>}</div>
            </div>
          ) : (
            <ClientPicker clients={clients} byId={clientById} value={choice} onChange={setChoice} />
          )}
          {newClient && (
            <div className="bk-newc" role="status">
              <strong><Sparkles size={16} /> New client{client ? `: ${client.name}` : choice.kind === "new" && choice.name.trim() ? `: ${choice.name.trim()}` : ""}</strong>
              {isEdit ? "Her first visit on record." : "This will be her first visit on record."} Give her the full welcome, and note her shape and shade afterwards.
              {newClient.clientId && (
                <div className="small" style={{ marginTop: 6 }}>
                  Been coming for years? Add her past visits on{" "}
                  <Link href={`/clients/?id=${newClient.clientId}`}>her profile</Link> so loyalty and recall count them.
                </div>
              )}
            </div>
          )}
        </div>

        <div className="section">
          <div className="section-label"><Sparkles size={14} />Services</div>
          <ServicePicker opts={opts} lines={lines} onChange={setLines} />
        </div>

        <div className="section">
          <div className="section-label"><CalendarClock size={14} />When</div>
          <DayStrip value={date} onChange={setDate} today={today} bookings={bookings} excludeId={booking?.id} pastDays={isEdit ? 14 : 7} />
          <DayGlance date={date} time={time} duration={duration || 30} bookings={bookings} excludeId={booking?.id} clash={Boolean(clash)} />
          <div className="bs-dur">
            <DurationStepper value={duration} onChange={(n) => { setDurAuto(false); setDuration(n); }}
              auto={durAuto || duration === sumDuration(lines)} onAuto={() => setDurAuto(true)} autoValue={sumDuration(lines)} />
          </div>
          <TimeSlots date={date} time={time} onChange={setTime} duration={duration || 30} bookings={bookings}
            excludeId={booking?.id} today={today} allowPast={isEdit} />
        </div>

        {clashBox}

        {loyalty && (disc ? (
          <div className="bk-loyal"><Gift size={20} /><span className="grow">{client?.name}&apos;s loyalty reward is applied. Visit {loyalty.visits} done.</span></div>
        ) : (
          <div className="bk-loyal" role="status">
            <Gift size={22} />
            <span className="grow"><b>Loyalty reward due.</b> {loyalty.visits} visits done, so this one is 20% off ({rand(loyalty.reward)}).</span>
            <button type="button" className="gold pill" onClick={() => { setDiscount(String(loyalty!.reward)); setDetails(true); }}>Apply</button>
          </div>
        ))}

        <div className="section">
          <button type="button" className="bs-toggle" aria-expanded={details} onClick={() => setDetails(!details)}>
            <div className="grow" style={{ textAlign: "left" }}>
              <div className="section-label" style={{ margin: 0 }}>Status, payment &amp; notes</div>
              {!details && <div className="small muted" style={{ marginTop: 2 }}>{statusLabel} · {pay === "none" ? "Not paid yet" : `Paid by ${payLabel.toLowerCase()}`}{disc ? ` · ${rand(disc)} off` : ""}{notes.trim() ? " · has a note" : ""}</div>}
            </div>
            <ChevronDown size={20} style={{ transform: details ? "rotate(180deg)" : "none", transition: "transform .2s" }} />
          </button>
          {details && (
            <div className="stack" style={{ marginTop: 12 }}>
              <div className="stack" style={{ gap: 6 }}>
                <span className="bk-label">Status</span>
                <div className="bk-segfull"><Seg value={status} options={STATUSES} onChange={setStatus} /></div>
              </div>
              {/* "Not yet" by default: a booking is usually made before she's paid, and a
                  pre-ticked Cash would be a made-up fact. */}
              <div className="stack" style={{ gap: 6 }}>
                <span className="bk-label">Paid with</span>
                <div className="bk-segfull"><Seg value={pay} options={PAY_OPTIONS} onChange={setPay} /></div>
              </div>
              <div className="fields2">
                <label className="field">Discount
                  <div className="money"><span>R</span><input type="number" inputMode="numeric" min={0} step={10} value={discount} onChange={(e) => setDiscount(e.target.value)} /></div>
                </label>
                <label className="field">Tip
                  <div className="money"><span>R</span><input type="number" inputMode="numeric" min={0} step={10} value={tip} onChange={(e) => setTip(e.target.value)} /></div>
                </label>
              </div>
              <p className="small muted" style={{ margin: "-4px 0 0" }}>A discount reduces what the visit earned. Tips are yours and never count as revenue.</p>
              <label className="field">Notes
                <textarea value={notes} onChange={(e) => setNotes(e.target.value)}
                  placeholder="Allergies, requests, shade, running late…" />
              </label>
            </div>
          )}
        </div>

        {/* The footer sticks to the bottom of the sheet, so the summary, any
            error and the double-booking question are always beside Save. */}
        <div className="bk-foot">
          {error && <div className="notice danger" role="alert" style={{ margin: 0 }}>{error}</div>}
          {confirmClash && clash && !confirmDelete && (
            <div className="bk-clash" role="alert">
              <strong><AlertTriangle size={18} /> Book it anyway?</strong>
              It overlaps {clashName} at {clash.time.slice(0, 5)}–{endTime(clash)}. Pick another time, or double-book if it&apos;s a genuine squeeze-in.
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
            <>
              <div className="bs-sum">
                <div className="grow">
                  <div className="bs-when">{whenLabel}{time ? ` · ${time}–${endLabel}` : ""}</div>
                  <div className="small muted">{lines.length ? `${lines[0].name}${lines.length > 1 ? ` +${lines.length - 1} more` : ""}` : "No service yet"}{tipN ? ` · ${rand(tipN)} tip` : ""}</div>
                </div>
                <div className="bs-total">{rand(net)}{disc > 0 && <s>{rand(gross)}</s>}</div>
              </div>
              <div className="bk-actions">
                {isEdit && <button type="button" className="danger icon" aria-label="Delete booking" disabled={busy} onClick={() => setConfirmDelete(true)}><Trash2 size={19} /></button>}
                <button type="button" className={confirmClash && clash ? "bs-go clash" : "bs-go"} disabled={busy} onClick={save}>
                  {busy ? "Saving…" : confirmClash && clash ? "Yes, double-book" : isEdit ? "Save changes" : time ? `Book for ${time}` : "Book"}
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </Sheet>
  );
}
