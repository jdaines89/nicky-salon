/**
 * Client-cadence and business insights — pure functions over the same client/
 * booking rows the data layer returns (port of lib/insights.py).
 *
 * Core idea: every client has her own rhythm. A gel regular on a 3-week cycle
 * who hasn't booked for 5 weeks is *overdue*; a twice-a-year pedicure client
 * isn't, even at 4 months. The median inter-visit gap captures that robustly
 * (one long holiday gap doesn't skew it), making Win-Back an ordered "who to
 * message first" rather than an alphabetical maybe-list.
 */
import {
  addDays,
  clientHasUpcoming,
  cmpTuple,
  completedVisitCount,
  daysBetween,
  freeGaps,
  loyaltyDiscountDue,
  minDate,
  needsRebooking,
  pyRound,
  toDate,
  toMinutes,
  weekday,
} from "./salon";
import type { BookingLike, ClientLike, ISODate, ServiceLike } from "./types";

/**
 * Assumed cadence for clients with fewer than 2 completed visits — roughly the
 * common salon rebooking cycle. Only used to *order* unknown-cadence clients
 * among known ones, never shown as a fact about the client.
 */
export const DEFAULT_GAP_DAYS = 28;

/** Python's statistics.median. */
function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  const n = s.length;
  const mid = Math.floor(n / 2);
  return n % 2 === 1 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

/**
 * Ascending, deduplicated dates of completed visits: pre-system prior_visits
 * plus past confirmed bookings (mirrors completedVisitCount).
 */
export function completedVisitDates(client: ClientLike, allBookings: BookingLike[], today: ISODate): ISODate[] {
  const dates = new Set<ISODate>();
  for (const v of client.prior_visits || []) dates.add(toDate(v.date));
  for (const b of allBookings) {
    if (b.client_id === client.id && b.date < String(today) && b.status === "confirmed") {
      dates.add(toDate(b.date));
    }
  }
  return [...dates].sort();
}

/**
 * Median gap in days between consecutive visits; null with fewer than two
 * distinct visit dates (no rhythm to speak of).
 */
export function typicalGapDays(visitDates: ISODate[]): number | null {
  if (visitDates.length < 2) return null;
  const gaps: number[] = [];
  for (let i = 1; i < visitDates.length; i++) gaps.push(daysBetween(visitDates[i - 1], visitDates[i]));
  return pyRound(median(gaps));
}

export interface Cadence {
  lastVisit: ISODate;
  visitCount: number;
  typicalGapDays: number | null;
  expectedReturn: ISODate | null;
  /** Negative = not yet due. */
  daysOverdue: number | null;
}

/**
 * The client's rhythm, or null if she's never completed a visit. The gap
 * fields are null when only one visit exists.
 */
export function cadence(client: ClientLike, allBookings: BookingLike[], today: ISODate): Cadence | null {
  const dates = completedVisitDates(client, allBookings, today);
  if (!dates.length) return null;
  const gap = typicalGapDays(dates);
  const last = dates[dates.length - 1];
  const expected = gap ? addDays(last, gap) : null;
  return {
    lastVisit: last,
    visitCount: dates.length,
    typicalGapDays: gap,
    expectedReturn: expected,
    daysOverdue: expected ? daysBetween(expected, today) : null,
  };
}

/**
 * Sort key for the Win-Back / recall lists: how far past her own expected
 * return date a client is. Falls back to DEFAULT_GAP_DAYS when her cadence is
 * unknown so single-visit clients interleave sensibly. Higher = message sooner.
 */
export function winBackUrgency(client: ClientLike, allBookings: BookingLike[], today: ISODate): number | null {
  const c = cadence(client, allBookings, today);
  if (!c) return null;
  if (c.daysOverdue !== null) return c.daysOverdue;
  return daysBetween(c.lastVisit, today) - DEFAULT_GAP_DAYS;
}

/**
 * The recall list (visited before, nothing upcoming), most urgent first; ties
 * broken by name so the order is stable day to day.
 */
export function recallClientsOrdered<C extends ClientLike>(
  clients: C[],
  allBookings: BookingLike[],
  today: ISODate,
): C[] {
  return clients
    .filter((c) => needsRebooking(c, allBookings, today))
    .map((c) => ({ c, key: [-(winBackUrgency(c, allBookings, today) || 0), c.name] as [number, string] }))
    .sort((a, b) => cmpTuple(a.key, b.key))
    .map(({ c }) => c);
}

/** 'usually every ~21 days · 12 days overdue'. Empty string when unknown. */
export function cadenceLine(c: Cadence | null | undefined): string {
  if (!c || !c.typicalGapDays) return "";
  let line = `usually every ~${c.typicalGapDays} days`;
  if (c.daysOverdue !== null && c.daysOverdue > 0) line += ` · ${c.daysOverdue} days overdue`;
  return line;
}

export interface Reliability {
  held: number;
  noShows: number;
  noShowPct: number;
}

/**
 * How often this client's bookings actually happen. "Held" bookings are past
 * ones not cancelled in advance — they happened (confirmed) or didn't
 * (no-show). A cancellation is not counted against anyone.
 */
export function reliability(client: ClientLike, allBookings: BookingLike[], today: ISODate): Reliability {
  const past = allBookings.filter((b) => b.client_id === client.id && b.date < String(today));
  const shows = past.filter((b) => b.status === "confirmed").length;
  const noShows = past.filter((b) => b.status === "no-show").length;
  const held = shows + noShows;
  return { held, noShows, noShowPct: held ? pyRound((noShows / held) * 100) : 0 };
}

/** Bookings per weekday [Mon..Sun], cancelled excluded — where the busy days are. */
export function weekdayCounts(bookings: BookingLike[]): number[] {
  const counts = [0, 0, 0, 0, 0, 0, 0];
  for (const b of bookings) {
    if (b.status !== "cancelled") counts[weekday(b.date)] += 1;
  }
  return counts;
}

export interface ListRate {
  name: string;
  category: string | null | undefined;
  price: number;
  minutes: number;
  ratePerHour: number;
}

/**
 * Rand per chair-hour for each service, straight off the price list.
 *
 * One person, one chair: the scarce thing is *hours*. Ranking by total revenue
 * always flatters whatever takes longest and hides that a R90 brow wax at 15
 * minutes out-earns a R300 overlay at 60 per hour of Nicky's time.
 *
 * Services with no duration are skipped (no rate is definable). Packages are
 * included — a bundle's rate is exactly the question worth asking about it.
 */
export function listEarningRate(services: ServiceLike[]): ListRate[] {
  const out: ListRate[] = [];
  for (const s of services) {
    const minutes = s.duration_minutes || 0;
    const price = Number(s.price || 0);
    if (minutes <= 0) continue;
    out.push({ name: s.name, category: s.category, price, minutes, ratePerHour: (price / minutes) * 60 });
  }
  return out.sort((a, b) => b.ratePerHour - a.ratePerHour);
}

export interface RealisedRate {
  name: string;
  bookings: number;
  revenue: number;
  minutes: number;
  ratePerHour: number;
}

/**
 * Rand per chair-hour actually achieved per service, from history.
 *
 * Only *single-service* confirmed past bookings count. A booking's
 * duration_minutes covers the whole appointment, so on a multi-service booking
 * there's no non-arbitrary split of minutes — splitting by price would assume
 * the answer this metric exists to test. Uses price_at_time, so a later price
 * change never rewrites past earnings.
 */
export function realisedEarningRate(bookings: BookingLike[], today: ISODate | null = null): RealisedRate[] {
  const tally = new Map<string, RealisedRate>();
  for (const b of bookings) {
    if (b.status !== "confirmed") continue;
    if (today !== null && String(b.date) >= String(today)) continue;
    const svcs = b.booking_services || [];
    if (svcs.length !== 1) continue;
    const minutes = b.duration_minutes || 0;
    if (minutes <= 0) continue;
    const name = svcs[0].service_name;
    let t = tally.get(name);
    if (!t) {
      t = { name, bookings: 0, revenue: 0, minutes: 0, ratePerHour: 0 };
      tally.set(name, t);
    }
    t.bookings += 1;
    t.revenue += Number(svcs[0].price_at_time || 0);
    t.minutes += minutes;
  }
  for (const t of tally.values()) t.ratePerHour = t.minutes ? (t.revenue / t.minutes) * 60 : 0;
  return [...tally.values()].sort((a, b) => b.ratePerHour - a.ratePerHour);
}

export interface CapacityStats {
  workingDays: number;
  availableMinutes: number;
  promisedMinutes: number;
  earnedMinutes: number;
  promisedPct: number;
  earnedPct: number;
  noShowMinutes: number;
}

/** Resolve an optional range to the data's span, never past today. */
function resolveRange(
  allBookings: BookingLike[],
  start: ISODate | null | undefined,
  end: ISODate | null | undefined,
  today: ISODate | null | undefined,
): [ISODate | null, ISODate | null] {
  // start/end are optional because Reports' "All Time" passes neither; fall
  // back to the span the data actually covers.
  const dated = allBookings.filter((b) => b.status !== "cancelled").map((b) => toDate(b.date));
  let s = start ?? null;
  let e = end ?? null;
  if (s === null) s = dated.length ? dated.reduce((a, b) => (b < a ? b : a)) : null;
  if (e === null) e = dated.length ? dated.reduce((a, b) => (b > a ? b : a)) : null;
  // Future hours cannot have been earned yet; counting them as available would
  // report a half-finished week as half empty. Only elapsed time counts.
  if (today != null && e !== null) e = minDate(e, today);
  return [s, e];
}

/**
 * Occupancy over a date range: how much of the chair actually got used.
 *
 * Revenue for one chair = hours available x occupancy x earnings per occupied
 * hour. Price is fixed by the employer, so the levers are occupancy and mix —
 * and which is worth working on depends entirely on this number.
 *
 *   - promisedPct: was the hour spoken for? (not cancelled; no-shows included —
 *     they did block the slot)
 *   - earnedPct: did the hour actually earn? (confirmed only)
 * The gap between them is the cost of no-shows in hours she couldn't resell.
 *
 * Only worked weekdays count as available — a salon that never opens Sunday is
 * closed on Sundays, not 0% occupied.
 */
export function capacityStats(
  allBookings: BookingLike[],
  start: ISODate | null = null,
  end: ISODate | null = null,
  today: ISODate | null = null,
  openMin = 8 * 60,
  closeMin = 19 * 60,
): CapacityStats {
  const [s0, e0] = resolveRange(allBookings, start, end, today);
  if (s0 === null || e0 === null || s0 > e0) {
    return {
      workingDays: 0, availableMinutes: 0, promisedMinutes: 0, earnedMinutes: 0,
      promisedPct: 0, earnedPct: 0, noShowMinutes: 0,
    };
  }
  const startD = toDate(s0);
  const endD = toDate(e0);
  const working = workingWeekdays(allBookings);
  const dayMinutes = Math.max(closeMin - openMin, 0);

  let days = 0;
  for (let d = startD; d <= endD; d = addDays(d, 1)) {
    if (working.has(weekday(d))) days += 1;
  }
  const available = days * dayMinutes;

  let promised = 0;
  let earned = 0;
  for (const b of allBookings) {
    const bd = toDate(b.date);
    if (bd < startD || bd > endD || !working.has(weekday(bd))) continue;
    if (b.status === "cancelled") continue;
    const s = Math.max(toMinutes(b.time), openMin);
    const e = Math.min(s + (b.duration_minutes || 30), closeMin);
    const held = Math.max(e - s, 0);
    promised += held;
    if (b.status === "confirmed") earned += held;
  }

  return {
    workingDays: days,
    availableMinutes: available,
    promisedMinutes: promised,
    earnedMinutes: earned,
    promisedPct: available ? pyRound((promised / available) * 100) : 0,
    earnedPct: available ? pyRound((earned / available) * 100) : 0,
    noShowMinutes: promised - earned,
  };
}

/**
 * Earned occupancy per weekday [Mon..Sun], null for days never worked.
 *
 * Structurally quiet weekdays are the ones worth aiming a discount at. Null
 * (not 0) keeps "closed" distinct from "open and empty" — they call for
 * opposite responses.
 */
export function occupancyByWeekday(
  allBookings: BookingLike[],
  start: ISODate | null = null,
  end: ISODate | null = null,
  today: ISODate | null = null,
  openMin = 8 * 60,
  closeMin = 19 * 60,
): (number | null)[] {
  const [s0, e0] = resolveRange(allBookings, start, end, today);
  if (s0 === null || e0 === null || s0 > e0) return [null, null, null, null, null, null, null];
  const startD = toDate(s0);
  const endD = toDate(e0);

  const working = workingWeekdays(allBookings);
  const dayMinutes = Math.max(closeMin - openMin, 0);
  const counts = [0, 0, 0, 0, 0, 0, 0];
  const earned = [0, 0, 0, 0, 0, 0, 0];
  for (let d = startD; d <= endD; d = addDays(d, 1)) {
    const wd = weekday(d);
    if (working.has(wd)) counts[wd] += 1;
  }
  for (const b of allBookings) {
    const bd = toDate(b.date);
    const wd = weekday(bd);
    if (bd < startD || bd > endD || b.status !== "confirmed" || !working.has(wd)) continue;
    const s = Math.max(toMinutes(b.time), openMin);
    const e = Math.min(s + (b.duration_minutes || 30), closeMin);
    earned[wd] += Math.max(e - s, 0);
  }
  return counts.map((n, i) =>
    !working.has(i) || !n ? null : pyRound((earned[i] / (n * dayMinutes)) * 100),
  );
}

// ---------------- rebooking at the chair ----------------
//
// The strongest retention lever is booking the next visit before the client
// stands up, and unlike a discount it costs nothing — which matters when prices
// are not Nicky's to move. These answer "when, what time, and what" so the
// rebooking is one tap and a confirmation.

/**
 * The time of day (minutes) this client usually books, or null with no history.
 * Offering a regular her own 09:00 lands as "your usual?", not a puzzle.
 *
 * Ties: Python's max(set(times), key=times.count) resolves ties by set
 * iteration order, which is an implementation detail; here a tie goes to the
 * earliest time of day, deterministically.
 */
export function usualStartMin(client: ClientLike, allBookings: BookingLike[]): number | null {
  const counts = new Map<number, number>();
  for (const b of allBookings) {
    if (b.client_id === client.id && b.status !== "cancelled") {
      const m = toMinutes(b.time);
      counts.set(m, (counts.get(m) || 0) + 1);
    }
  }
  if (!counts.size) return null;
  let best: number | null = null;
  let bestN = -1;
  for (const [m, n] of [...counts].sort((a, b) => a[0] - b[0])) {
    if (n > bestN) {
      best = m;
      bestN = n;
    }
  }
  return best;
}

/**
 * Her most recent actual visit — the template for the next one. Re-picking
 * four services one-handed with wet nails is exactly the friction that stops
 * rebooking happening.
 */
export function usualVisit<B extends BookingLike>(client: ClientLike, allBookings: B[], today: ISODate): B | null {
  let best: B | null = null;
  for (const b of allBookings) {
    if (b.client_id !== client.id || String(b.date) >= String(today) || b.status !== "confirmed") continue;
    // max() keeps the first of equal keys, hence strict >.
    if (!best || cmpTuple([String(b.date), String(b.time)], [String(best.date), String(best.time)]) > 0) best = b;
  }
  return best;
}

export interface NextVisitSuggestion {
  date: ISODate;
  startMin: number;
  duration: number;
  serviceIds: string[];
  gapDays: number;
  atUsualTime: boolean;
}

/**
 * When to put this client's next visit, and what to put in it.
 *
 * Aims at her own rhythm (median gap, else DEFAULT_GAP_DAYS), then walks
 * forward to the first working day with a real opening. Prefers her usual time
 * when that time is actually free — "same as always?" is the easiest booking
 * to close. Null when nothing within the horizon can hold her.
 */
export function suggestNextVisit(
  client: ClientLike,
  allBookings: BookingLike[],
  today: ISODate,
  horizonDays = 90,
): NextVisitSuggestion | null {
  const cad = cadence(client, allBookings, today);
  const gap = cad?.typicalGapDays || DEFAULT_GAP_DAYS;
  const last = cad?.lastVisit ?? null;

  let target = last ? addDays(last, gap) : addDays(today, gap);
  if (target <= today) target = addDays(today, 1);

  const prev = usualVisit(client, allBookings, today);
  const duration = prev?.duration_minutes || 60;
  const serviceIds = (prev?.booking_services || [])
    .filter((bs) => bs.service_id)
    .map((bs) => bs.service_id as string);
  const preferred = usualStartMin(client, allBookings);

  const working = workingWeekdays(allBookings);
  const byDate = groupByDate(allBookings);

  for (let i = daysBetween(today, target); i <= horizonDays; i++) {
    const d = addDays(today, i);
    if (working.size && !working.has(weekday(d))) continue;
    const dayList = byDate.get(d) || [];
    const gaps = freeGaps(dayList).filter(([s, e]) => e - s >= duration);
    if (!gaps.length) continue;
    if (preferred !== null) {
      for (const [s, e] of gaps) {
        if (s <= preferred && preferred + duration <= e) {
          return { date: d, startMin: preferred, duration, serviceIds, gapDays: gap, atUsualTime: true };
        }
      }
    }
    const [s, e] = gaps[0];
    return {
      date: d,
      startMin: proposedStart(s, e, dayList.length, duration),
      duration,
      serviceIds,
      gapDays: gap,
      atUsualTime: false,
    };
  }
  return null;
}

function groupByDate<B extends BookingLike>(bookings: B[]): Map<string, B[]> {
  const byDate = new Map<string, B[]>();
  for (const b of bookings) {
    const k = String(b.date);
    const list = byDate.get(k);
    if (list) list.push(b);
    else byDate.set(k, [b]);
  }
  return byDate;
}

// ---------------- filling quiet slots ----------------
//
// Prices are set by the owner's employer, so price is not a lever. What Nicky
// controls is which hours get filled and who comes back — an empty chair is
// the real cost, and the discount she already gives is the currency to attack
// it with. The loyalty rule is untouched (every 5th completed visit, 20%);
// only *where* the reward is spent changes, pointed at an hour that would
// otherwise go empty.

/**
 * Weekday indices (Mon=0) the salon has ever actually worked. Derived, not
 * configured: suggesting a Sunday to a salon that never opens Sunday would burn
 * credibility on the first tap. A weekday with no history is treated as closed.
 */
export function workingWeekdays(bookings: BookingLike[], minBookings = 1): Set<number> {
  const counts = weekdayCounts(bookings);
  const out = new Set<number>();
  counts.forEach((n, i) => {
    if (n >= minBookings) out.add(i);
  });
  return out;
}

/**
 * Where to aim on a day with nothing else on it. The gap start would put every
 * offer at 08:00 — the least appealing hour, and one that anchors her morning.
 */
export const PREFERRED_START_MIN = 10 * 60;
export const OPEN_MIN = 8 * 60;

/**
 * Where inside a gap to actually offer. A gap beginning mid-day begins where an
 * appointment ended, so starting there keeps her day in one block. A gap from
 * opening means the day is empty — aim mid-morning rather than at the door.
 */
export function proposedStart(gapStart: number, gapEnd: number, dayBooked: number, minMinutes: number): number {
  if (dayBooked && gapStart > OPEN_MIN) return gapStart;
  const latest = gapEnd - minMinutes;
  if (gapStart < PREFERRED_START_MIN && PREFERRED_START_MIN <= latest) return PREFERRED_START_MIN;
  return gapStart;
}

export interface QuietOpening {
  date: ISODate;
  startMin: number;
  gapStartMin: number;
  endMin: number;
  minutes: number;
  dayBooked: number;
}

/**
 * Upcoming gaps worth offering, emptiest day first, then soonest — a discount
 * spent on a day already filling up buys nothing. Only whole gaps of at least
 * `minMinutes` count; a 20-minute sliver is not a bookable appointment.
 */
export function quietOpenings(
  allBookings: BookingLike[],
  today: ISODate,
  daysAhead = 14,
  minMinutes = 45,
): QuietOpening[] {
  const working = workingWeekdays(allBookings);
  const byDate = groupByDate(allBookings);

  const openings: QuietOpening[] = [];
  for (let offset = 1; offset <= daysAhead; offset++) {
    const d = addDays(today, offset);
    if (!working.has(weekday(d))) continue;
    const day = byDate.get(d) || [];
    const booked = day.filter((b) => b.status !== "cancelled" && b.status !== "no-show").length;
    for (const [start, end] of freeGaps(day)) {
      if (end - start >= minMinutes) {
        openings.push({
          date: d,
          startMin: proposedStart(start, end, booked, minMinutes),
          gapStartMin: start,
          endMin: end,
          minutes: end - start,
          dayBooked: booked,
        });
      }
    }
  }
  return openings.sort((a, b) => cmpTuple([a.dayBooked, a.date, a.startMin], [b.dayBooked, b.date, b.startMin]));
}

export interface RewardCandidate<C extends ClientLike = ClientLike> {
  client: C;
  reason: "loyalty" | "overdue";
  visits: number;
  overdueDays: number;
  cadence: Cadence | null;
  detail: string;
}

/**
 * Clients worth spending a slot on, best first: someone who has *earned* the
 * loyalty reward, or someone drifting past her own rhythm. Anyone already
 * booked is excluded — discounting a visit that was happening anyway is the
 * exact waste this avoids. Loyalty-due first (easiest yes), then most overdue.
 */
export function rewardCandidates<C extends ClientLike>(
  clients: C[],
  allBookings: BookingLike[],
  today: ISODate,
): RewardCandidate<C>[] {
  const out: RewardCandidate<C>[] = [];
  for (const c of clients) {
    if (clientHasUpcoming(c, allBookings, today)) continue;
    const visits = completedVisitCount(c, allBookings, today);
    if (visits <= 0) continue;
    const cad = cadence(c, allBookings, today);
    const overdue = winBackUrgency(c, allBookings, today) || 0;
    if (loyaltyDiscountDue(visits)) {
      out.push({
        client: c, reason: "loyalty", visits, overdueDays: overdue, cadence: cad,
        detail: `${visits} visits — 20% off earned`,
      });
    } else if (overdue > 0) {
      out.push({
        client: c, reason: "overdue", visits, overdueDays: overdue, cadence: cad,
        detail: cadenceLine(cad) || `${overdue} days overdue`,
      });
    }
  }
  return out.sort((a, b) =>
    cmpTuple(
      [a.reason === "loyalty" ? 0 : 1, -a.overdueDays, a.client.name],
      [b.reason === "loyalty" ? 0 : 1, -b.overdueDays, b.client.name],
    ),
  );
}

export interface QuietSlotOffer<C extends ClientLike = ClientLike> extends RewardCandidate<C> {
  opening: QuietOpening;
}

/**
 * Pair each deserving client with her own quiet slot, best pairing first. One
 * slot per client and one client per slot: offering the same Tuesday 10am to
 * five people would double-book Nicky or make four feel second-choice.
 */
export function quietSlotOffers<C extends ClientLike>(
  clients: C[],
  allBookings: BookingLike[],
  today: ISODate,
  daysAhead = 14,
  minMinutes = 45,
  limit = 6,
): QuietSlotOffer<C>[] {
  const openings = quietOpenings(allBookings, today, daysAhead, minMinutes);
  const cands = rewardCandidates(clients, allBookings, today);
  const offers: QuietSlotOffer<C>[] = [];
  for (let i = 0; i < Math.min(cands.length, openings.length); i++) {
    offers.push({ ...cands[i], opening: openings[i] });
    if (offers.length >= limit) break;
  }
  return offers;
}

export interface RetentionStats {
  visited: number;
  returning: number;
  returningPct: number;
  avgVisits: number;
  atRisk: number;
}

/**
 * How many clients come back, how often, and how many are past their own
 * rhythm right now with nothing booked.
 */
export function retentionStats(clients: ClientLike[], allBookings: BookingLike[], today: ISODate): RetentionStats {
  const counts: number[] = [];
  let atRisk = 0;
  for (const c of clients) {
    const dates = completedVisitDates(c, allBookings, today);
    if (!dates.length) continue;
    counts.push(dates.length);
    if (needsRebooking(c, allBookings, today)) {
      const cad = cadence(c, allBookings, today);
      if (cad && cad.daysOverdue !== null && cad.daysOverdue > 0) atRisk += 1;
    }
  }
  const visited = counts.length;
  const returning = counts.filter((n) => n >= 2).length;
  return {
    visited,
    returning,
    returningPct: visited ? pyRound((returning / visited) * 100) : 0,
    avgVisits: visited ? pyRound(counts.reduce((a, b) => a + b, 0) / visited, 1) : 0,
    atRisk,
  };
}
