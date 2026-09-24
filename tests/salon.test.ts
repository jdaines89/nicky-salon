/**
 * Port of tests/test_business_logic.py — the pure rules in lib/db.py, now
 * src/lib/salon.ts. Same inputs, same expected values.
 */
import { describe, expect, it } from "vitest";
import {
  addDays,
  bookingNet,
  bookingsAwaitingDecision,
  bookingTitle,
  bookingTotal,
  clientHasUpcoming,
  clientInitial,
  clientVisits,
  completedVisitCount,
  computeRecurringDates,
  daysBetween,
  estimatedPriorVisits,
  fetchAll,
  findCollision,
  firstName,
  firstVisitMap,
  fmtDayMonShort,
  fmtDayMonth,
  fmtWeekdayDayMonth,
  freeGaps,
  freqLabel,
  isEstimatedVisit,
  isFirstVisit,
  loyaltyDiscountDue,
  loyaltyProgress,
  MAX_PRIOR_VISITS,
  monthBounds,
  needsRebooking,
  netRevenue,
  nowSa,
  paymentLabel,
  pyFixed,
  pyRound,
  smsLink,
  telLink,
  todaySa,
  validPhone,
  waLink,
  waNumber,
  weekday,
} from "@/lib/salon";
import type { BookingLike, ClientLike, PriorVisit, ServiceLine } from "@/lib/types";

const TODAY = "2026-07-17";

function bk(o: Partial<BookingLike> & { services?: ServiceLine[]; notes?: string | null } = {}): BookingLike {
  return {
    id: o.id ?? "b1",
    client_id: o.client_id ?? "c1",
    date: o.date ?? "2026-07-10",
    time: o.time ?? "10:00",
    status: o.status ?? "confirmed",
    duration_minutes: "duration_minutes" in o ? o.duration_minutes : 60,
    discount: o.discount ?? 0,
    tip: o.tip ?? 0,
    booking_services:
      o.services !== undefined ? o.services : [{ service_id: "s1", service_name: "Gel Overlay", price_at_time: 300.0 }],
  };
}

function cl(o: { id?: string; name?: string; phone?: string; prior_visits?: PriorVisit[] } = {}): ClientLike & {
  phone: string;
} {
  return { id: o.id ?? "c1", name: o.name ?? "Thandi Mbeki", phone: o.phone ?? "082 123 4567", prior_visits: o.prior_visits ?? [] };
}

// ---------------- phone / WhatsApp ----------------

describe("phone / WhatsApp", () => {
  it("valid_phone accepts 10 digits with formatting", () => {
    expect(validPhone("0821234567")).toBe(true);
    expect(validPhone("082 123 4567")).toBe(true);
    expect(validPhone("082-123-4567")).toBe(true);
  });

  it("valid_phone rejects wrong lengths and empty", () => {
    expect(validPhone("082123456")).toBe(false); // 9 digits
    expect(validPhone("08212345678")).toBe(false); // 11 digits
    expect(validPhone("")).toBe(false);
    expect(validPhone(null)).toBe(false);
  });

  it("wa_number converts local to international", () => {
    expect(waNumber("082 123 4567")).toBe("27821234567");
  });

  it("wa_number passes through international", () => {
    expect(waNumber("27821234567")).toBe("27821234567");
  });

  it("wa_number rejects unusable numbers", () => {
    expect(waNumber("12345")).toBeNull();
    expect(waNumber("1234567890")).toBeNull(); // 10 digits but doesn't start with 0
    expect(waNumber(null)).toBeNull();
  });

  it("wa_link url-encodes message", () => {
    const link = waLink("0821234567", "Hi Thandi! See you at 10:00 💅")!;
    expect(link.startsWith("https://wa.me/27821234567?text=")).toBe(true);
    expect(link.split("text=")[1]).not.toContain(" ");
  });

  it("wa_link none without usable number", () => {
    expect(waLink("12345", "hi")).toBeNull();
  });

  it("sms_link prefills urlencoded body", () => {
    const link = smsLink("082 123 4567", "Hi Thandi! See you soon 💅")!;
    expect(link.startsWith("sms:+27821234567?body=")).toBe(true);
    expect(link.split("body=")[1]).not.toContain(" ");
    expect(smsLink("12345", "hi")).toBeNull();
  });

  it("tel_link strips formatting", () => {
    expect(telLink("082 123 4567")).toBe("tel:0821234567");
    expect(telLink("+27 82 123 4567")).toBe("tel:27821234567");
    expect(telLink("12345")).toBeNull();
    expect(telLink(null)).toBeNull();
  });
});

// ---------------- names / formatting ----------------

describe("names / formatting", () => {
  it("first_name and initial", () => {
    expect(firstName("Thandi Mbeki")).toBe("Thandi");
    expect(firstName("  Thandi  ")).toBe("Thandi");
    expect(clientInitial("thandi")).toBe("T");
    expect(clientInitial("  ")).toBe("?");
  });

  it("date formats have no leading zero day", () => {
    const d = "2026-07-05"; // a Sunday
    expect(fmtDayMonth(d)).toBe("5 July");
    expect(fmtDayMonShort(d)).toBe("5 Jul");
    expect(fmtWeekdayDayMonth(d)).toBe("Sunday, 5 July");
  });

  it("month_bounds handles every month length", () => {
    expect(monthBounds("2026-07-05")).toEqual(["2026-07-01", "2026-07-31"]);
    expect(monthBounds("2026-02-14")).toEqual(["2026-02-01", "2026-02-28"]);
    expect(monthBounds("2028-02-14")).toEqual(["2028-02-01", "2028-02-29"]); // leap
    expect(monthBounds("2026-12-31")).toEqual(["2026-12-01", "2026-12-31"]);
  });
});

// ---------------- money ----------------

describe("money", () => {
  it("net_revenue subtracts discount, never negative", () => {
    expect(netRevenue(300, 60)).toBe(240);
    expect(netRevenue(300, 0)).toBe(300);
    expect(netRevenue(100, 150)).toBe(0);
  });

  it("booking_total is gross sum of snapshots", () => {
    const b = bk({
      services: [
        { service_name: "Gel Overlay", price_at_time: 300.0 },
        { service_name: "Art", price_at_time: 50.0 },
      ],
    });
    expect(bookingTotal(b)).toBe(350.0);
  });

  it("booking_net excludes discount and ignores tip", () => {
    const b = bk({
      discount: 70,
      tip: 100,
      services: [
        { service_name: "Gel Overlay", price_at_time: 300.0 },
        { service_name: "Art", price_at_time: 50.0 },
      ],
    });
    expect(bookingNet(b)).toBe(280.0); // 350 - 70; the R100 tip never counts
  });

  it("booking_title summarises services", () => {
    expect(bookingTitle(bk({ services: [] }))).toBe("—");
    expect(bookingTitle(bk())).toBe("Gel Overlay");
    const two = bk({
      services: [
        { service_name: "Gel Overlay", price_at_time: 300 },
        { service_name: "Pedicure", price_at_time: 250 },
      ],
    });
    expect(bookingTitle(two)).toBe("Gel Overlay +1 more");
  });
});

// ---------------- loyalty ----------------

describe("loyalty", () => {
  it("due on every 5th completed visit only", () => {
    expect(loyaltyDiscountDue(0)).toBe(false);
    expect(loyaltyDiscountDue(4)).toBe(false);
    expect(loyaltyDiscountDue(5)).toBe(true);
    expect(loyaltyDiscountDue(6)).toBe(false);
    expect(loyaltyDiscountDue(10)).toBe(true);
  });

  it("progress states", () => {
    expect(loyaltyProgress(0)).toEqual([0, 5, "none"]);
    expect(loyaltyProgress(5)).toEqual([100, 0, "due"]);
    let [pct, toNext, kind] = loyaltyProgress(3);
    expect([pyRound(pct), toNext, kind]).toEqual([60, 2, "progress"]);
    [pct, toNext, kind] = loyaltyProgress(7);
    expect([pyRound(pct), toNext, kind]).toEqual([40, 3, "progress"]);
  });
});

// ---------------- collision detection ----------------

const EXISTING = [bk({ id: "e1", date: "2026-07-20", time: "10:00", duration_minutes: 60 })];

describe("collision detection", () => {
  it("true interval overlap, not start equality", () => {
    // starts before the existing booking ends -> collision
    expect(findCollision(EXISTING, "2026-07-20", "10:30", 60)).not.toBeNull();
    // overlaps from the front -> collision
    expect(findCollision(EXISTING, "2026-07-20", "09:30", 45)).not.toBeNull();
  });

  it("back to back is allowed", () => {
    expect(findCollision(EXISTING, "2026-07-20", "11:00", 60)).toBeNull();
    expect(findCollision(EXISTING, "2026-07-20", "09:00", 60)).toBeNull();
  });

  it("other day is free", () => {
    expect(findCollision(EXISTING, "2026-07-21", "10:00", 60)).toBeNull();
  });

  it("cancelled and no-show never block a slot", () => {
    for (const status of ["cancelled", "no-show"]) {
      const blocked = [bk({ id: "e1", date: "2026-07-20", time: "10:00", status })];
      expect(findCollision(blocked, "2026-07-20", "10:00", 60)).toBeNull();
    }
  });

  it("excludes the booking being edited", () => {
    expect(findCollision(EXISTING, "2026-07-20", "10:00", 60, "e1")).toBeNull();
  });

  it("defaults missing duration to 30", () => {
    const fuzzy = [bk({ id: "e1", date: "2026-07-20", time: "10:00", duration_minutes: null })];
    expect(findCollision(fuzzy, "2026-07-20", "10:29", 30)).not.toBeNull();
    expect(findCollision(fuzzy, "2026-07-20", "10:30", 30)).toBeNull();
  });

  it("accepts PostgREST 'HH:MM:SS' times too", () => {
    const rows = [bk({ id: "e1", date: "2026-07-20", time: "10:00:00", duration_minutes: 60 })];
    expect(findCollision(rows, "2026-07-20", "10:30:00", 60)).not.toBeNull();
  });
});

// ---------------- free slots ----------------

describe("free slots", () => {
  it("empty day is one open block", () => {
    expect(freeGaps([])).toEqual([[8 * 60, 19 * 60]]);
  });

  it("between bookings", () => {
    const day = [bk({ id: "a", time: "09:00", duration_minutes: 60 }), bk({ id: "b", time: "12:00", duration_minutes: 90 })];
    expect(freeGaps(day)).toEqual([
      [8 * 60, 9 * 60],
      [10 * 60, 12 * 60],
      [13 * 60 + 30, 19 * 60],
    ]);
  });

  it("cancelled and no-show free their slot", () => {
    const day = [bk({ id: "a", time: "09:00", status: "cancelled" }), bk({ id: "b", time: "10:00", status: "no-show" })];
    expect(freeGaps(day)).toEqual([[8 * 60, 19 * 60]]);
  });

  it("clamps to working hours and handles overlap", () => {
    const day = [
      bk({ id: "a", time: "07:00", duration_minutes: 90 }), // spills into the day from before opening
      bk({ id: "b", time: "08:00", duration_minutes: 60 }), // overlaps it
    ];
    expect(freeGaps(day)).toEqual([[9 * 60, 19 * 60]]);
  });

  it("never offers time after closing", () => {
    // A squeeze-in after the 19:00 close used to drag the preceding gap out to
    // *its* start, so the Day view advertised "free until 19:30".
    expect(freeGaps([bk({ id: "a", time: "19:30", duration_minutes: 30 })])).toEqual([[8 * 60, 19 * 60]]);
    expect(freeGaps([bk({ id: "a", time: "20:00", duration_minutes: 30 })])).toEqual([[8 * 60, 19 * 60]]);
  });

  it("late booking does not swallow earlier gaps", () => {
    const day = [bk({ id: "a", time: "09:00", duration_minutes: 60 }), bk({ id: "b", time: "19:30", duration_minutes: 30 })];
    expect(freeGaps(day)).toEqual([
      [8 * 60, 9 * 60],
      [10 * 60, 19 * 60],
    ]);
  });

  it("booking ending exactly at close leaves no trailing gap", () => {
    expect(freeGaps([bk({ id: "a", time: "18:00", duration_minutes: 60 })])).toEqual([[8 * 60, 18 * 60]]);
  });
});

// ---------------- recurring dates ----------------

describe("recurring dates", () => {
  it("by count", () => {
    expect(computeRecurringDates("2026-07-20", 7, "count", 4)).toEqual([
      "2026-07-20", "2026-07-27", "2026-08-03", "2026-08-10",
    ]);
  });

  it("by count minimum one", () => {
    expect(computeRecurringDates("2026-07-20", 7, "count", 0)).toEqual(["2026-07-20"]);
  });

  it("until end date inclusive", () => {
    expect(computeRecurringDates("2026-07-20", 14, "until", null, "2026-08-17")).toEqual([
      "2026-07-20", "2026-08-03", "2026-08-17",
    ]);
  });

  it("until without end date is single visit", () => {
    expect(computeRecurringDates("2026-07-20", 7, "until", null, null)).toEqual(["2026-07-20"]);
  });

  it("until capped at 60 visits", () => {
    expect(computeRecurringDates("2026-01-01", 7, "until", null, "2030-01-01")).toHaveLength(60);
  });

  it("freq labels", () => {
    expect(freqLabel(7)).toBe("Weekly");
    expect(freqLabel(14)).toBe("Every 2 Weeks");
    expect(freqLabel(28)).toBe("Every 4 Weeks");
    expect(freqLabel(10)).toBe("Every 10 days");
  });
});

// ---------------- visit history / recall / new-client ----------------

describe("visit history / recall / new-client", () => {
  it("completed visits counts prior plus past confirmed only", () => {
    const c = cl({ prior_visits: [{ date: "2026-01-10", service: "Gel", price: "R300" }] });
    const bookings = [
      bk({ id: "b1", date: "2026-07-01", status: "confirmed" }), // past, counts
      bk({ id: "b2", date: "2026-07-02", status: "cancelled" }), // past but cancelled
      bk({ id: "b3", date: "2026-07-03", status: "no-show" }), // past but no-show
      bk({ id: "b4", date: "2026-07-20", status: "confirmed" }), // future
    ];
    expect(completedVisitCount(c, bookings, TODAY)).toBe(2); // 1 prior + b1
  });

  it("client_visits merges prior and past live, newest first", () => {
    const c = cl({ prior_visits: [{ date: "2026-01-10", service: "Gel", price: "R300" }] });
    const bookings = [bk({ id: "b1", date: "2026-07-01" }), bk({ id: "b4", date: "2026-07-20" })];
    const visits = clientVisits(c, bookings, TODAY);
    expect(visits.map((v) => v.date)).toEqual(["2026-07-01", "2026-01-10"]); // future b4 excluded
    expect(visits[0].source).toBe("live");
    expect(visits[1].source).toBe("prior");
  });

  it("needs_rebooking requires history and no upcoming", () => {
    const c = cl();
    const pastOnly = [bk({ id: "b1", date: "2026-07-01", status: "confirmed" })];
    expect(needsRebooking(c, pastOnly, TODAY)).toBe(true);
    const withUpcoming = [...pastOnly, bk({ id: "b2", date: "2026-07-20", status: "pending" })];
    expect(needsRebooking(c, withUpcoming, TODAY)).toBe(false);
    expect(needsRebooking(cl({ id: "c9" }), [], TODAY)).toBe(false); // never visited -> not recall
  });

  it("upcoming cancelled booking does not count as upcoming", () => {
    const c = cl();
    const bookings = [bk({ id: "b1", date: "2026-07-01", status: "confirmed" }), bk({ id: "b2", date: "2026-07-20", status: "cancelled" })];
    expect(clientHasUpcoming(c, bookings, TODAY)).toBe(false);
    expect(needsRebooking(c, bookings, TODAY)).toBe(true);
  });

  it("first visit derived from earliest booking unless prior visits", () => {
    const fresh = cl({ id: "c1" });
    const returning = cl({ id: "c2", prior_visits: [{ date: "2026-01-10", service: "Gel", price: "R300" }] });
    const bookings = [
      bk({ id: "b1", client_id: "c1", date: "2026-07-10", time: "14:00" }),
      bk({ id: "b2", client_id: "c1", date: "2026-07-10", time: "09:00" }), // earliest (same day, earlier time)
      bk({ id: "b3", client_id: "c2", date: "2026-07-11", time: "09:00" }),
    ];
    const fv = firstVisitMap([fresh, returning], bookings);
    expect(isFirstVisit(bookings[1], fv)).toBe(true); // b2 is c1's first visit
    expect(isFirstVisit(bookings[0], fv)).toBe(false);
    expect(isFirstVisit(bookings[2], fv)).toBe(false); // c2 has prior_visits -> never "new"
  });
});

// ---------------- paging past the PostgREST row cap ----------------
//
// PostgREST silently truncates an unbounded select at 1000 rows. Reads are
// ordered ascending, so the rows lost are the NEWEST.

function paged<T>(rows: T[]) {
  const calls: [number, number][] = [];
  const builds: number[] = [];
  const build = () => {
    builds.push(1);
    return {
      range(start: number, end: number) {
        calls.push([start, end]);
        return Promise.resolve({ data: rows.slice(start, end + 1), error: null });
      },
    };
  };
  return { fetched: fetchAll(build), calls, builds };
}

const ids = (n: number) => Array.from({ length: n }, (_, i) => ({ id: i }));

describe("fetchAll paging", () => {
  it("pages past the thousand-row cap", async () => {
    const rows = ids(2500);
    const p = paged(rows);
    const fetched = await p.fetched;
    expect(fetched).toHaveLength(2500);
    expect(fetched).toEqual(rows); // order preserved across pages
    expect(p.calls).toEqual([[0, 999], [1000, 1999], [2000, 2999]]);
  });

  it("short page ends the walk", async () => {
    const p = paged(ids(10));
    expect(await p.fetched).toHaveLength(10);
    expect(p.calls).toEqual([[0, 999]]); // one short page, no second request
  });

  it("exactly one full page checks for more", async () => {
    // A full page is indistinguishable from "there is more", so it must ask again.
    const p = paged(ids(1000));
    expect(await p.fetched).toHaveLength(1000);
    expect(p.calls).toEqual([[0, 999], [1000, 1999]]);
  });

  it("empty table", async () => {
    const p = paged([]);
    expect(await p.fetched).toEqual([]);
    expect(p.calls).toEqual([[0, 999]]);
  });

  it("builds a fresh query per page", async () => {
    // Reusing one builder would compound .range() and silently drop rows.
    const p = paged(ids(2500));
    await p.fetched;
    expect(p.builds.length).toBe(3);
    expect(p.calls.length).toBe(3);
  });

  it("surfaces a PostgREST error instead of returning a short list", async () => {
    const build = () => ({ range: () => Promise.resolve({ data: null, error: new Error("boom") }) });
    await expect(fetchAll(build)).rejects.toThrow("boom");
  });
});

// ---------------- pre-system history without a backfill ----------------

describe("estimated prior visits", () => {
  it("count drives loyalty", () => {
    const pv = estimatedPriorVisits(5, 14, TODAY);
    expect(pv).toHaveLength(5);
    const c = cl({ id: "c1", prior_visits: pv });
    // Five completed visits before the app = reward due on the next one.
    expect(completedVisitCount(c, [], TODAY)).toBe(5);
    expect(loyaltyDiscountDue(completedVisitCount(c, [], TODAY))).toBe(true);
  });

  it("spacing reproduces her cadence", () => {
    const pv = estimatedPriorVisits(4, 14, TODAY);
    const dates = pv.map((v) => v.date);
    expect(dates).toEqual([...dates].sort()); // oldest first
    const gaps = new Set(dates.slice(1).map((d, i) => daysBetween(dates[i], d)));
    expect(gaps).toEqual(new Set([14]));
  });

  it("last one is in the past, not today", () => {
    const pv = estimatedPriorVisits(3, 14, TODAY);
    expect(pv[pv.length - 1].date < TODAY).toBe(true);
  });

  it("zero and negative are empty", () => {
    expect(estimatedPriorVisits(0, undefined, TODAY)).toEqual([]);
    expect(estimatedPriorVisits(-3, undefined, TODAY)).toEqual([]);
  });

  it("capped and never zero spacing", () => {
    expect(estimatedPriorVisits(10_000, undefined, TODAY)).toHaveLength(MAX_PRIOR_VISITS);
    const pv = estimatedPriorVisits(2, 0, TODAY); // 0 would stack them all on one day
    expect(new Set(pv.map((v) => v.date)).size).toBe(2);
  });

  it("estimated visits are flagged so the UI can say estimated", () => {
    const pv = estimatedPriorVisits(2, undefined, TODAY);
    expect(pv.every((v) => isEstimatedVisit(v))).toBe(true);
    const realRow: PriorVisit = { date: "2026-01-01", service: "Gel Overlay", price: "R300" };
    expect(isEstimatedVisit(realRow)).toBe(false);
  });

  it("prior visits stop a long-standing client being badged new", () => {
    const regular = cl({ id: "c1", prior_visits: estimatedPriorVisits(12, 14, TODAY) });
    const firstTimer = cl({ id: "c2" });
    const bookings = [bk({ id: "b1", client_id: "c1", date: "2026-07-10" }), bk({ id: "b2", client_id: "c2", date: "2026-07-10" })];
    const fv = firstVisitMap([regular, firstTimer], bookings);
    expect(isFirstVisit(bookings[0], fv)).toBe(false); // been coming for years
    expect(isFirstVisit(bookings[1], fv)).toBe(true); // genuinely new
  });

  it("prior visits never touch revenue", () => {
    cl({ id: "c1", prior_visits: estimatedPriorVisits(20, undefined, TODAY) });
    const b = bk({ id: "b1", client_id: "c1", date: "2026-07-10" });
    expect(bookingNet(b)).toBe(300.0); // unchanged by 20 estimated visits
  });

  it("is_estimated_visit matches both shapes it appears in", () => {
    // Raw prior_visits row uses "service"; clientVisits() renames it to "label".
    const raw = estimatedPriorVisits(1, undefined, TODAY)[0];
    expect(isEstimatedVisit(raw)).toBe(true);
    const merged = clientVisits(cl({ id: "c1", prior_visits: [raw] }), [], TODAY)[0];
    expect(isEstimatedVisit(merged)).toBe(true); // estimates must stay identifiable after the merge
    const real = clientVisits(cl({ id: "c1" }), [bk({ id: "b1", client_id: "c1", date: "2026-07-10" })], TODAY)[0];
    expect(isEstimatedVisit(real)).toBe(false);
  });
});

// ---------------- past bookings still awaiting a decision ----------------

describe("awaiting decision", () => {
  it("finds past pending only", () => {
    const b = [
      bk({ id: "past_pending", date: "2026-07-10", status: "pending" }),
      bk({ id: "past_confirmed", date: "2026-07-10", status: "confirmed" }),
      bk({ id: "past_cancelled", date: "2026-07-10", status: "cancelled" }),
      bk({ id: "past_noshow", date: "2026-07-10", status: "no-show" }),
      bk({ id: "future_pending", date: "2026-08-10", status: "pending" }),
      bk({ id: "today_pending", date: TODAY, status: "pending" }),
    ];
    expect(bookingsAwaitingDecision(b, TODAY).map((x) => x.id)).toEqual(["past_pending"]);
  });

  it("is oldest first", () => {
    const b = [
      bk({ id: "b", date: "2026-07-12", status: "pending" }),
      bk({ id: "a", date: "2026-07-01", status: "pending" }),
      bk({ id: "c", date: "2026-07-12", time: "08:00", status: "pending" }),
    ];
    expect(bookingsAwaitingDecision(b, TODAY).map((x) => x.id)).toEqual(["a", "c", "b"]);
  });

  it("empty when nothing is stale", () => {
    expect(bookingsAwaitingDecision([bk({ id: "x", date: TODAY, status: "pending" })], TODAY)).toEqual([]);
  });

  it("a past pending booking counts for nothing until resolved", () => {
    // This is the damage the list exists to prevent.
    const c = cl({ id: "c1" });
    const pending = [bk({ id: "p", client_id: "c1", date: "2026-07-10", status: "pending" })];
    expect(completedVisitCount(c, pending, TODAY)).toBe(0);
    const resolved = [bk({ id: "p", client_id: "c1", date: "2026-07-10", status: "confirmed" })];
    expect(completedVisitCount(c, resolved, TODAY)).toBe(1);
  });
});

// ---------------- TS-port-specific: helpers the Python got from its runtime ----------------

describe("port helpers", () => {
  it("today/now are computed in Africa/Johannesburg, not the host clock", () => {
    // 22:30 UTC on 16 July is 00:30 on 17 July in Johannesburg (UTC+2, no DST).
    const at = new Date(Date.UTC(2026, 6, 16, 22, 30, 0));
    expect(todaySa(at)).toBe("2026-07-17");
    expect(nowSa(at).time).toBe("00:30:00");
  });

  it("date helpers are UTC-safe across month and year ends", () => {
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
    expect(addDays("2028-03-01", -1)).toBe("2028-02-29");
    expect(weekday("2026-07-13")).toBe(0); // Monday
    expect(weekday("2026-07-19")).toBe(6); // Sunday
  });

  it("rounds ties to even like Python", () => {
    expect(pyRound(17.5)).toBe(18);
    expect(pyRound(18.5)).toBe(18);
    expect(pyRound(2.25, 1)).toBe(2.2);
    expect(pyFixed(300.5, 0)).toBe("300");
    expect(pyFixed(-60, 2)).toBe("-60.00");
  });

  it("payment label falls back to not recorded", () => {
    expect(paymentLabel({ payment_method: "card" })).toBe("Card");
    expect(paymentLabel({ payment_method: null })).toBe("Not recorded");
    expect(paymentLabel({ payment_method: "constructor" })).toBe("Not recorded");
  });
});
