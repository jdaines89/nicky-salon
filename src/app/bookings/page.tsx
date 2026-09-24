"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useRef, useState } from "react";
import { useSalon } from "@/components/data";
import { Seg, useToast } from "@/components/ui";
import { BookingSheet, type NewBookingDraft } from "@/components/bookings-dialog";
import { RecurringSheet, SeriesList } from "@/components/bookings-recurring";
import { BOOKINGS_CSS, hhmm, useFirstVisits } from "@/components/bookings-shared";
import { DayView, MonthView, WeekView } from "@/components/bookings-views";
import type { BookingWithServices } from "@/lib/types";

type View = "Month" | "Week" | "Day" | "Recurring";
type SheetKind =
  | { kind: "edit"; id: string }
  | { kind: "new"; draft: NewBookingDraft }
  | { kind: "recurring" };
/** `n` keys the sheet, so every opening starts from a fresh form. */
type SheetState = SheetKind & { n: number };

const isDate = (s: string | null): s is string => !!s && /^\d{4}-\d{2}-\d{2}$/.test(s);

export default function BookingsPage() {
  return (
    <Suspense fallback={<p className="loading">Loading your book&hellip;</p>}>
      <Bookings />
    </Suspense>
  );
}

function Bookings() {
  const { clients, bookings, services, clientById, today } = useSalon();
  const params = useSearchParams();
  const router = useRouter();
  const [toast, say] = useToast();
  const fv = useFirstVisits(clients, bookings);

  // One focus date shared by Month, Week and Day, so switching views never
  // snaps back to today while she's browsing another month.
  const [view, setView] = useState<View>("Month");
  const [focus, setFocus] = useState(today);
  const [sheet, setSheet] = useState<SheetState | null>(null);
  const counter = useRef(0);
  const handled = useRef<string | null>(null);

  const open = (s: SheetKind) => setSheet({ ...s, n: ++counter.current });

  // Deep links: ?day=YYYY-MM-DD&open=<id> from the dashboard, and the
  // "Book next visit" handoff from a client profile (?new=1&client=…).
  useEffect(() => {
    const qs = params.toString();
    if (!qs || handled.current === qs) return;
    handled.current = qs;
    const day = params.get("day");
    const openId = params.get("open");
    if (params.get("new") === "1") {
      const date = isDate(params.get("date")) ? params.get("date")! : isDate(day) ? day : today;
      const t = params.get("time");
      const dur = parseInt(params.get("duration") || "", 10);
      const svc = (params.get("services") || "").split(",").map((s) => s.trim())
        .filter((id) => services.some((s) => s.id === id && s.active !== false));
      setFocus(date);
      setView("Day");
      open({ kind: "new", draft: {
        clientId: params.get("client"), date,
        time: t && /^\d{1,2}:\d{2}/.test(t) ? t.padStart(5, "0").slice(0, 5) : undefined,
        serviceIds: svc.length ? svc : undefined, duration: Number.isFinite(dur) && dur > 0 ? dur : undefined,
      } });
    } else if (openId) {
      const b = bookings.find((x) => x.id === openId);
      setFocus(b?.date ?? (isDate(day) ? day : today));
      setView("Day");
      if (b) open({ kind: "edit", id: b.id });
      else say("That booking isn't in the diary any more.");
    } else if (isDate(day)) {
      setFocus(day);
      setView("Day");
    }
    router.replace("/bookings/", { scroll: false });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params]);

  const onEdit = (b: BookingWithServices) => open({ kind: "edit", id: b.id });
  const newOn = (date: string, time?: string) => open({ kind: "new", draft: { date, time } });
  const editing = sheet?.kind === "edit" ? bookings.find((b) => b.id === sheet.id) : undefined;
  const shared = { focus, today, bookings, clientById, fv, setFocus, onEdit };

  return (
    <>
      <style>{BOOKINGS_CSS}</style>
      <h1>Bookings</h1>
      <p className="sub">Your day, week and month</p>

      <div className="bk-top">
        <div className="bk-segfull" style={{ flex: "1 1 320px", minWidth: 0 }}>
          <Seg value={view} options={["Month", "Week", "Day", "Recurring"] as const} onChange={setView} />
        </div>
        {/* In Day view "new booking" almost always means on the day she's looking at. */}
        <button className="gold" style={{ flex: "1 1 auto" }} onClick={() => newOn(view === "Day" ? focus : today)}>＋ New booking</button>
      </div>

      {view === "Month" && (
        <MonthView {...shared} openWeek={(d) => { setFocus(d); setView("Week"); }} />
      )}
      {view === "Week" && (
        <WeekView {...shared} openDay={(d) => { setFocus(d); setView("Day"); }} addOn={(d) => newOn(d)} />
      )}
      {view === "Day" && (
        <DayView {...shared} bookSlot={(d, min) => newOn(d, hhmm(min))} />
      )}
      {view === "Recurring" && (
        <SeriesList onEdit={onEdit} onNew={() => open({ kind: "recurring" })} onDone={say} />
      )}

      {sheet?.kind === "new" && (
        <BookingSheet key={sheet.n} draft={sheet.draft} onClose={() => setSheet(null)} onDone={say} />
      )}
      {sheet?.kind === "edit" && editing && (
        <BookingSheet key={sheet.n} booking={editing} onClose={() => setSheet(null)} onDone={say} />
      )}
      {sheet?.kind === "recurring" && (
        <RecurringSheet key={sheet.n} onClose={() => setSheet(null)} onDone={say} />
      )}
      {toast}
    </>
  );
}
