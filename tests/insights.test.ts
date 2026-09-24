/** Port of tests/test_insights.py — client cadence, recall ordering, retention, occupancy. */
import { describe, expect, it } from "vitest";
import {
  cadence,
  cadenceLine,
  capacityStats,
  completedVisitDates,
  DEFAULT_GAP_DAYS,
  listEarningRate,
  occupancyByWeekday,
  proposedStart,
  quietOpenings,
  quietSlotOffers,
  realisedEarningRate,
  recallClientsOrdered,
  reliability,
  retentionStats,
  rewardCandidates,
  suggestNextVisit,
  typicalGapDays,
  usualStartMin,
  usualVisit,
  weekdayCounts,
  winBackUrgency,
  workingWeekdays,
} from "@/lib/insights";
import { pyRound, weekday } from "@/lib/salon";
import type { BookingLike, ClientLike, PriorVisit, ServiceLike, ServiceLine } from "@/lib/types";

const TODAY = "2026-07-17";

function bk(
  id: string,
  client_id = "c1",
  date = "2026-07-10",
  o: { status?: string; time?: string; duration_minutes?: number; services?: ServiceLine[] } = {},
): BookingLike {
  return {
    id,
    client_id,
    date,
    time: o.time ?? "10:00",
    status: o.status ?? "confirmed",
    duration_minutes: o.duration_minutes ?? 60,
    booking_services: o.services ?? [],
  };
}

function cl(id: string, name = "Client", prior_visits: PriorVisit[] = []): ClientLike {
  return { id, name, prior_visits };
}

// ---------------- visit dates / gaps ----------------

describe("visit dates / gaps", () => {
  it("merge prior and confirmed past only", () => {
    const c = cl("c1", "Client", [{ date: "2026-05-01", service: "Gel", price: "R300" }]);
    const bookings = [
      bk("b1", "c1", "2026-06-01"),
      bk("b2", "c1", "2026-06-15", { status: "no-show" }), // not completed
      bk("b3", "c1", "2026-08-01"), // future
      bk("b4", "c2", "2026-06-20"), // someone else
    ];
    expect(completedVisitDates(c, bookings, TODAY)).toEqual(["2026-05-01", "2026-06-01"]);
  });

  it("same-day visits dedupe to one date", () => {
    const c = cl("c1");
    const bookings = [bk("b1", "c1", "2026-06-01", { time: "09:00" }), bk("b2", "c1", "2026-06-01", { time: "14:00" })];
    expect(completedVisitDates(c, bookings, TODAY)).toEqual(["2026-06-01"]);
  });

  it("typical gap is median, robust to one holiday", () => {
    const dates = ["2026-01-01", "2026-01-22", "2026-02-12", "2026-04-30"];
    // gaps 21, 21, 77 -> median 21, the outlier holiday gap doesn't skew it
    expect(typicalGapDays(dates)).toBe(21);
  });

  it("typical gap needs two dates", () => {
    expect(typicalGapDays(["2026-01-01"])).toBeNull();
    expect(typicalGapDays([])).toBeNull();
  });
});

// ---------------- cadence ----------------

describe("cadence", () => {
  it("overdue client", () => {
    const c = cl("c1");
    const bookings = [bk("b1", "c1", "2026-05-01"), bk("b2", "c1", "2026-05-22"), bk("b3", "c1", "2026-06-12")]; // every 21 days
    const cad = cadence(c, bookings, TODAY)!;
    expect(cad.typicalGapDays).toBe(21);
    expect(cad.expectedReturn).toBe("2026-07-03");
    expect(cad.daysOverdue).toBe(14);
  });

  it("not yet due is negative", () => {
    const c = cl("c1");
    const bookings = [bk("b1", "c1", "2026-06-24"), bk("b2", "c1", "2026-07-15")]; // gap 21, due Aug 5
    expect(cadence(c, bookings, TODAY)!.daysOverdue).toBe(-19);
  });

  it("null for never visited", () => {
    expect(cadence(cl("c1"), [], TODAY)).toBeNull();
  });

  it("single visit has last date but no rhythm", () => {
    const cad = cadence(cl("c1"), [bk("b1", "c1", "2026-06-01")], TODAY)!;
    expect(cad.visitCount).toBe(1);
    expect(cad.typicalGapDays).toBeNull();
    expect(cad.daysOverdue).toBeNull();
  });
});

// ---------------- urgency / ordering ----------------

describe("urgency / ordering", () => {
  it("urgency falls back to default gap for single visit", () => {
    const c = cl("c1");
    const bookings = [bk("b1", "c1", "2026-06-01")]; // 46 days ago
    expect(winBackUrgency(c, bookings, TODAY)).toBe(46 - DEFAULT_GAP_DAYS);
  });

  it("recall ordered most overdue first, stable names", () => {
    const overdue = cl("c1", "Zoe"); // 21-day rhythm, 14 days overdue
    const fresh = cl("c2", "Anna"); // same rhythm, not yet due
    const single = cl("c3", "Mia"); // one visit 46 days ago -> urgency 18
    const bookings = [
      bk("b1", "c1", "2026-05-01"), bk("b2", "c1", "2026-05-22"), bk("b3", "c1", "2026-06-12"),
      bk("b4", "c2", "2026-06-24"), bk("b5", "c2", "2026-07-15"),
      bk("b6", "c3", "2026-06-01"),
    ];
    const ordered = recallClientsOrdered([fresh, overdue, single], bookings, TODAY);
    expect(ordered.map((c) => c.name)).toEqual(["Mia", "Zoe", "Anna"]); // 18, 14, -19
  });

  it("client with upcoming booking never in recall", () => {
    const c = cl("c1");
    const bookings = [bk("b1", "c1", "2026-06-01"), bk("b2", "c1", "2026-07-25", { status: "pending" })];
    expect(recallClientsOrdered([c], bookings, TODAY)).toEqual([]);
  });
});

// ---------------- copy line ----------------

describe("cadence line", () => {
  it("variants", () => {
    const c = cl("c1");
    const overdue = cadence(c, [bk("b1", "c1", "2026-05-01"), bk("b2", "c1", "2026-05-22"), bk("b3", "c1", "2026-06-12")], TODAY);
    expect(cadenceLine(overdue)).toBe("usually every ~21 days · 14 days overdue");
    const notDue = cadence(c, [bk("b1", "c1", "2026-06-24"), bk("b2", "c1", "2026-07-15")], TODAY);
    expect(cadenceLine(notDue)).toBe("usually every ~21 days");
    expect(cadenceLine(null)).toBe("");
    expect(cadenceLine(cadence(c, [bk("b1", "c1", "2026-06-01")], TODAY))).toBe("");
  });
});

// ---------------- reliability ----------------

describe("reliability", () => {
  it("counts held bookings only", () => {
    const c = cl("c1");
    const bookings = [
      bk("b1", "c1", "2026-06-01"), // showed
      bk("b2", "c1", "2026-06-08", { status: "no-show" }), // didn't
      bk("b3", "c1", "2026-06-15", { status: "cancelled" }), // cancelled in advance — not held against her
      bk("b4", "c1", "2026-08-01"), // future — not held yet
      bk("b5", "c2", "2026-06-01", { status: "no-show" }), // someone else
    ];
    expect(reliability(c, bookings, TODAY)).toEqual({ held: 2, noShows: 1, noShowPct: 50 });
  });

  it("clean record and no history", () => {
    const c = cl("c1");
    expect(reliability(c, [], TODAY)).toEqual({ held: 0, noShows: 0, noShowPct: 0 });
    expect(reliability(c, [bk("b1", "c1", "2026-06-01")], TODAY).noShows).toBe(0);
  });
});

// ---------------- weekday load / retention ----------------

describe("weekday load / retention", () => {
  it("weekday counts exclude cancelled", () => {
    const bookings = [
      bk("b1", "c1", "2026-07-13"), // Monday
      bk("b2", "c1", "2026-07-14"), bk("b3", "c2", "2026-07-14"), // Tuesday x2
      bk("b4", "c1", "2026-07-18", { status: "cancelled" }), // Saturday, excluded
      bk("b5", "c2", "2026-07-18", { status: "no-show" }), // Saturday, counts (took the slot)
    ];
    expect(weekdayCounts(bookings)).toEqual([1, 2, 0, 0, 0, 1, 0]);
  });

  it("retention stats", () => {
    const returning = cl("c1", "R"); // 3 visits, 21-day rhythm, overdue, nothing upcoming
    const oneTime = cl("c2", "O"); // 1 visit
    const never = cl("c3", "N"); // 0 visits
    const bookings = [
      bk("b1", "c1", "2026-05-01"), bk("b2", "c1", "2026-05-22"), bk("b3", "c1", "2026-06-12"),
      bk("b4", "c2", "2026-06-20"),
    ];
    const s = retentionStats([returning, oneTime, never], bookings, TODAY);
    expect(s.visited).toBe(2);
    expect(s.returning).toBe(1);
    expect(s.returningPct).toBe(50);
    expect(s.avgVisits).toBe(2.0);
    expect(s.atRisk).toBe(1); // c1 overdue with nothing booked; c2 has no known rhythm
  });
});

// ---------------- earning rate per chair-hour ----------------

function svc(name: string, price: number, minutes: number, category = "Gel Overlays"): ServiceLike {
  return { name, price, duration_minutes: minutes, category };
}

describe("earning rate per chair-hour", () => {
  it("list rate ranks by hour, not by price", () => {
    // The whole point: the cheapest service can be the best use of the chair.
    const services = [svc("Gel Overlay", 300, 60), svc("Brow Wax", 90, 15, "Waxing"), svc("Art Per Nail", 15, 5, "Nail Art")];
    const ranked = listEarningRate(services);
    expect(ranked.map((r) => r.name)).toEqual(["Brow Wax", "Gel Overlay", "Art Per Nail"]);
    expect(ranked.map((r) => pyRound(r.ratePerHour))).toEqual([360, 300, 180]);
  });

  it("list rate skips services with no duration", () => {
    expect(listEarningRate([svc("Consult", 100, 0), svc("Gel Overlay", 300, 60)])).toEqual([
      { name: "Gel Overlay", category: "Gel Overlays", price: 300.0, minutes: 60, ratePerHour: 300.0 },
    ]);
  });

  it("realised rate uses only single-service bookings", () => {
    // The two-service booking is ignored: its 90 minutes can't be split between
    // the two services without assuming the answer.
    const bookings = [
      bk("a", "c1", "2026-07-01", {
        duration_minutes: 60,
        services: [{ service_id: "s1", service_name: "Gel Overlay", price_at_time: 300.0 }],
      }),
      bk("b", "c1", "2026-07-02", {
        duration_minutes: 90,
        services: [
          { service_id: "s1", service_name: "Gel Overlay", price_at_time: 300.0 },
          { service_id: "s2", service_name: "Brow Wax", price_at_time: 90.0 },
        ],
      }),
    ];
    const out = realisedEarningRate(bookings, TODAY);
    expect(out).toHaveLength(1);
    expect(out[0].name).toBe("Gel Overlay");
    expect(out[0].bookings).toBe(1);
    expect(pyRound(out[0].ratePerHour)).toBe(300);
  });

  it("realised rate ignores future and unconfirmed bookings", () => {
    const services = [{ service_id: "s1", service_name: "Gel Overlay", price_at_time: 300.0 }];
    const bookings = [
      bk("a", "c1", "2026-07-01", { duration_minutes: 60, services }),
      bk("b", "c1", "2026-07-02", { duration_minutes: 60, services, status: "no-show" }),
      bk("c", "c1", "2026-07-03", { duration_minutes: 60, services, status: "cancelled" }),
      bk("d", "c1", "2026-12-01", { duration_minutes: 60, services }), // future
    ];
    expect(realisedEarningRate(bookings, TODAY)[0].bookings).toBe(1);
  });

  it("realised rate uses price_at_time, not current price", () => {
    // A price rise must not rewrite what past hours actually earned.
    const bookings = [
      bk("a", "c1", "2026-07-01", {
        duration_minutes: 60,
        services: [{ service_id: "s1", service_name: "Gel Overlay", price_at_time: 250.0 }],
      }),
      bk("b", "c1", "2026-07-02", {
        duration_minutes: 60,
        services: [{ service_id: "s1", service_name: "Gel Overlay", price_at_time: 350.0 }],
      }),
    ];
    const out = realisedEarningRate(bookings, TODAY);
    expect(out[0].revenue).toBe(600.0);
    expect(pyRound(out[0].ratePerHour)).toBe(300); // 600 over 2 hours
  });
});

// ---------------- quiet-slot rewards ----------------

function b_(id: string, clientId: string, d: string, time = "10:00", dur = 60, status = "confirmed"): BookingLike {
  return bk(id, clientId, d, { time, duration_minutes: dur, status });
}

const FIVE_VISITS = ["2026-05-01", "2026-05-15", "2026-06-01", "2026-06-15", "2026-07-01"];

describe("quiet-slot rewards", () => {
  it("working weekdays exclude days never worked", () => {
    // Fridays only -> never suggest a Sunday.
    const bookings = [b_("a", "c1", "2026-07-03"), b_("b", "c1", "2026-07-10")];
    expect(workingWeekdays(bookings)).toEqual(new Set([4]));
  });

  it("quiet openings skip non-working weekdays", () => {
    const history = ["2026-07-03", "2026-07-10"].map((d, i) => b_(`h${i}`, "c1", d));
    const ops = quietOpenings(history, "2026-07-13", 14);
    expect(ops.length).toBeGreaterThan(0); // expected some openings
    expect(new Set(ops.map((o) => weekday(o.date)))).toEqual(new Set([4]));
  });

  it("quiet openings prefer the emptiest day", () => {
    // Two working Fridays ahead; one already has a booking, one is bare.
    const history = ["2026-07-03", "2026-07-10", "2026-07-17", "2026-07-24"].map((d, i) => b_(`h${i}`, "c1", d));
    const ops = quietOpenings(history, "2026-07-13", 14);
    expect(ops[0].dayBooked).toBeLessThanOrEqual(ops[ops.length - 1].dayBooked);
  });

  it("quiet openings ignore slivers", () => {
    const ops = quietOpenings([b_("a", "c1", "2026-07-17")], "2026-07-13", 14, 45);
    expect(ops.every((o) => o.minutes >= 45)).toBe(true);
  });

  it("reward candidates skip clients already booked", () => {
    // Five completed visits = reward due, but she is already coming back.
    const c = cl("c1", "Booked Already");
    const past = FIVE_VISITS.map((d, i) => b_(`p${i}`, "c1", d));
    const future = [b_("f1", "c1", "2026-07-20")];
    expect(rewardCandidates([c], [...past, ...future], TODAY)).toEqual([]);
    expect(rewardCandidates([c], past, TODAY).map((r) => r.reason)).toEqual(["loyalty"]);
  });

  it("reward candidates rank loyalty before overdue", () => {
    const loyal = cl("c1", "Loyal");
    const drifting = cl("c2", "Drifting");
    const bookings = FIVE_VISITS.map((d, i) => b_(`p${i}`, "c1", d));
    bookings.push(b_("d1", "c2", "2026-04-01"), b_("d2", "c2", "2026-04-15"));
    const ranked = rewardCandidates([loyal, drifting], bookings, TODAY);
    expect(ranked.map((r) => r.client.name)).toEqual(["Loyal", "Drifting"]);
    expect(ranked[0].reason).toBe("loyalty");
  });

  it("reward candidates ignore clients who never visited", () => {
    expect(rewardCandidates([cl("c9", "Never Been")], [], TODAY)).toEqual([]);
  });

  it("quiet slot offers never promise one slot twice", () => {
    const clients = [1, 2, 3].map((i) => cl(`c${i}`, `Client ${i}`));
    const bookings: BookingLike[] = [];
    for (const i of [1, 2, 3]) {
      // each has 5 completed visits
      bookings.push(...FIVE_VISITS.map((d, j) => b_(`p${i}${j}`, `c${i}`, d)));
    }
    const offers = quietSlotOffers(clients, bookings, TODAY);
    expect(offers).toHaveLength(3);
    const slots = offers.map((o) => `${o.opening.date}|${o.opening.startMin}`);
    expect(new Set(slots).size).toBe(slots.length); // no slot offered twice
    expect(new Set(offers.map((o) => o.client.id)).size).toBe(3); // no client twice
  });

  it("proposed start aims mid-morning on an empty day", () => {
    // Whole day free: 08:00 is the least appealing hour to sell and anchors her morning.
    expect(proposedStart(8 * 60, 19 * 60, 0, 45)).toBe(10 * 60);
  });

  it("proposed start butts against existing work", () => {
    // Gap opens at 11:00 because something ended there — keep the day in one block.
    expect(proposedStart(11 * 60, 19 * 60, 2, 45)).toBe(11 * 60);
  });

  it("proposed start stays inside a short early gap", () => {
    // 08:00-09:00 on an empty day: can't reach 10:00 and still fit, so don't try.
    expect(proposedStart(8 * 60, 9 * 60, 0, 45)).toBe(8 * 60);
  });

  it("proposed start never leaves less than the minimum", () => {
    const start = proposedStart(8 * 60, 10 * 60 + 30, 0, 45);
    expect(start + 45).toBeLessThanOrEqual(10 * 60 + 30);
  });

  it("quiet openings offer mid-morning on bare days", () => {
    const history = ["2026-07-03", "2026-07-10", "2026-07-17"].map((d, i) => b_(`h${i}`, "c1", d));
    const ops = quietOpenings(history, "2026-07-20", 14);
    const bare = ops.filter((o) => o.dayBooked === 0);
    expect(bare.length).toBeGreaterThan(0);
    expect(bare.every((o) => o.startMin === 10 * 60)).toBe(true);
  });
});

// ---------------- occupancy ----------------

describe("occupancy", () => {
  it("counts only working days as available", () => {
    // Fridays only. A week has one working day, so 11h available, not 77h.
    const b = [b_("a", "c1", "2026-07-03", "10:00", 60)];
    const st = capacityStats(b, "2026-07-01", "2026-07-07");
    expect(st.workingDays).toBe(1);
    expect(st.availableMinutes).toBe(11 * 60);
    expect(st.earnedMinutes).toBe(60);
    expect(st.earnedPct).toBe(pyRound((60 / (11 * 60)) * 100));
  });

  it("separates promised from earned", () => {
    // Same slot held either way, but a no-show earned nothing.
    const b = [b_("a", "c1", "2026-07-03", "10:00", 60), b_("b", "c1", "2026-07-03", "12:00", 60, "no-show")];
    const st = capacityStats(b, "2026-07-03", "2026-07-03");
    expect(st.promisedMinutes).toBe(120);
    expect(st.earnedMinutes).toBe(60);
    expect(st.noShowMinutes).toBe(60);
    expect(st.promisedPct).toBeGreaterThan(st.earnedPct);
  });

  it("ignores cancelled entirely", () => {
    // A cancellation freed the slot in advance; it is not a no-show.
    const b = [b_("a", "c1", "2026-07-03", "10:00", 60), b_("b", "c1", "2026-07-03", "12:00", 60, "cancelled")];
    const st = capacityStats(b, "2026-07-03", "2026-07-03");
    expect(st.promisedMinutes).toBe(60);
    expect(st.noShowMinutes).toBe(0);
  });

  it("clamps bookings to opening hours", () => {
    // A 07:00 start and an overrun past close cannot push occupancy over 100%.
    const b = [b_("a", "c1", "2026-07-03", "07:00", 180), b_("b", "c1", "2026-07-03", "18:00", 180)];
    const st = capacityStats(b, "2026-07-03", "2026-07-03");
    expect(st.earnedMinutes).toBeLessThanOrEqual(st.availableMinutes);
    expect(st.earnedPct).toBeLessThanOrEqual(100);
  });

  it("empty range does not divide by zero", () => {
    const st = capacityStats([], "2026-07-01", "2026-07-07");
    expect(st.earnedPct).toBe(0);
    expect(st.availableMinutes).toBe(0);
  });

  it("occupancy by weekday marks closed days null, not zero", () => {
    // Friday-only history: Monday is closed (null), not "0% and needs help".
    const b = ["2026-07-03", "2026-07-10"].map((d, i) => b_(`h${i}`, "c1", d, "10:00", 60));
    const by = occupancyByWeekday(b, "2026-07-01", "2026-07-14");
    expect(by[0]).toBeNull(); // Monday — never worked
    expect(by[4]).not.toBeNull(); // Friday — worked
    expect(by[4]!).toBeGreaterThan(0);
  });

  it("all-time infers span from the data", () => {
    // Reports' "All Time" range passes no bounds at all.
    const b = [b_("a", "c1", "2026-07-03", "10:00", 60), b_("b", "c1", "2026-07-10", "10:00", 60)];
    const st = capacityStats(b, null, null, "2026-07-17");
    expect(st.workingDays).toBe(2);
    expect(st.earnedMinutes).toBe(120);
  });

  it("with no bookings at all is zeroed, not crashing", () => {
    expect(capacityStats([], null, null, TODAY).earnedPct).toBe(0);
  });

  it("does not count future hours as available", () => {
    // Mid-week, the rest of the week hasn't happened — counting it as available
    // would report a normal week as half empty.
    const b = [
      b_("a", "c1", "2026-07-03", "10:00", 60), // elapsed Friday
      b_("f", "c1", "2026-07-17", "10:00", 60), // future Friday
    ];
    const st = capacityStats(b, "2026-07-01", "2026-07-31", "2026-07-10");
    // Fridays 3 and 10 July have elapsed; 17, 24, 31 have not.
    expect(st.workingDays).toBe(2);
    expect(st.availableMinutes).toBe(2 * 11 * 60);
    expect(st.earnedMinutes).toBe(60);
  });

  it("range entirely in the future is zeroed", () => {
    const b = [b_("a", "c1", "2026-07-03", "10:00", 60)];
    const st = capacityStats(b, "2026-09-01", "2026-09-30", "2026-07-10");
    expect(st.availableMinutes).toBe(0);
    expect(st.earnedPct).toBe(0);
  });
});

// ---------------- rebooking ----------------

function bs(sid: string, name = "Gel Overlay", price = 300.0): ServiceLine {
  return { service_id: sid, service_name: name, price_at_time: price };
}

function bv(
  id: string,
  cid: string,
  d: string,
  o: { time?: string; dur?: number; status?: string; services?: ServiceLine[] } = {},
): BookingLike {
  return bk(id, cid, d, {
    time: o.time ?? "09:00",
    duration_minutes: o.dur ?? 60,
    status: o.status ?? "confirmed",
    services: o.services ?? [bs("s1")],
  });
}

const FORTNIGHTLY = () => [bv("a", "c1", "2026-06-12"), bv("b", "c1", "2026-06-26"), bv("c", "c1", "2026-07-10")];

describe("rebooking", () => {
  it("usual start picks her habitual time", () => {
    const b = [bv("a", "c1", "2026-06-01", { time: "09:00" }), bv("b", "c1", "2026-06-15", { time: "09:00" }), bv("c", "c1", "2026-07-01", { time: "14:00" })];
    expect(usualStartMin(cl("c1"), b)).toBe(9 * 60);
  });

  it("usual start null without history", () => {
    expect(usualStartMin(cl("c9"), [])).toBeNull();
  });

  it("usual visit is the latest completed one", () => {
    const b = [bv("a", "c1", "2026-06-01"), bv("b", "c1", "2026-07-01"), bv("f", "c1", "2026-12-01")]; // future — not a visit yet
    expect(usualVisit(cl("c1"), b, TODAY)!.id).toBe("b");
  });

  it("follows her own rhythm", () => {
    // Fortnightly, last visit 2026-07-10 -> aim 2026-07-24.
    const s = suggestNextVisit(cl("c1"), FORTNIGHTLY(), TODAY)!;
    expect(s.gapDays).toBe(14);
    expect(s.date).toBe("2026-07-24");
  });

  it("offers her usual time when free", () => {
    const s = suggestNextVisit(cl("c1"), FORTNIGHTLY(), TODAY)!;
    expect(s.startMin).toBe(9 * 60);
    expect(s.atUsualTime).toBe(true);
  });

  it("steps past a taken slot", () => {
    const b = [
      ...FORTNIGHTLY(),
      // someone else already has 08:00-19:00 on the target day
      bv("x", "c2", "2026-07-24", { time: "08:00", dur: 11 * 60 }),
    ];
    const s = suggestNextVisit(cl("c1"), b, TODAY)!;
    expect(s.date > "2026-07-24").toBe(true);
  });

  it("carries her last services and duration", () => {
    const b = [bv("a", "c1", "2026-07-10", { dur: 75, services: [bs("s1"), bs("s2", "Brow Wax", 90.0)] })];
    const s = suggestNextVisit(cl("c1"), b, TODAY)!;
    expect(s.duration).toBe(75);
    expect(s.serviceIds).toEqual(["s1", "s2"]);
  });

  it("uses default gap for a one-visit client", () => {
    const s = suggestNextVisit(cl("c1"), [bv("a", "c1", "2026-07-10")], TODAY)!;
    expect(s.gapDays).toBe(DEFAULT_GAP_DAYS);
  });

  it("never lands in the past", () => {
    // Long overdue: her rhythm says the next visit was due weeks ago.
    const b = [bv("a", "c1", "2026-05-01"), bv("b", "c1", "2026-05-15")];
    const s = suggestNextVisit(cl("c1"), b, TODAY)!;
    expect(s.date > TODAY).toBe(true);
  });

  it("returns null when nothing fits", () => {
    const b = [bv("a", "c1", "2026-07-10")];
    expect(suggestNextVisit(cl("c1"), b, TODAY, 0)).toBeNull();
  });
});

// ---------------- TS-port-specific ----------------

describe("port: Python rounding in the median gap", () => {
  it("rounds a half-day median to even, as Python's round() does", () => {
    // gaps 14 and 21 -> median 17.5 -> 18; gaps 14 and 23 -> 18.5 -> 18
    expect(typicalGapDays(["2026-01-01", "2026-01-15", "2026-02-05"])).toBe(18);
    expect(typicalGapDays(["2026-01-01", "2026-01-15", "2026-02-07"])).toBe(18);
  });
});
