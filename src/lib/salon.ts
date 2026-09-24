/**
 * Pure business rules for Nicky's Beauty & Nails — a port of the pure half of
 * the Streamlit app's lib/db.py. No Supabase calls live here except the generic
 * fetchAll() pager, which only drives a query builder it is handed.
 *
 * Rules carried over unchanged (they went through several rounds of fixing
 * against the original prototype — don't relitigate them):
 *   - net revenue = sum(service prices) - discount, clamped at 0; tip never counted
 *   - loyalty: every 5th *completed* visit (date in the past, status confirmed,
 *     plus one-time pre-system prior_visits) qualifies for 20% off
 *   - "New Client" = no prior_visits AND this is their earliest booking on file
 *   - collision detection = true interval overlap (not start-time equality);
 *     cancelled/no-show bookings don't block a slot
 *   - recall list = completed at least one visit, nothing upcoming booked
 *
 * Dates are 'YYYY-MM-DD' strings throughout; the helpers below do calendar
 * arithmetic in UTC so no host timezone can shift a day.
 */
import type { BookingLike, ClientLike, ISODate, PriorVisit, RecurringEndType } from "./types";

// ============ PYTHON-COMPATIBLE NUMBERS ============
//
// The original rounds with Python's round()/format(), which round exact ties
// to even (round(17.5) == 18, round(18.5) == 18) and work from the double's
// exact decimal value. JS Math.round/toFixed round ties up, so a straight port
// would disagree on e.g. a median gap of 18.5 days. These reproduce Python.

/** Python's `format(x, f".{nd}f")`: exact decimal value, ties to even. */
export function pyFixed(x: number, nd = 0): string {
  if (!Number.isFinite(x)) return String(x);
  const neg = x < 0 || Object.is(x, -0);
  const ax = Math.abs(x);
  if (ax >= 1e21) return x.toFixed(nd);
  // toFixed(100) is the exact decimal expansion for any double we handle.
  const exact = ax.toFixed(100);
  const [intPart, frac] = exact.split(".");
  const kept = intPart + frac.slice(0, nd);
  const rest = frac.slice(nd);
  let up = false;
  if (rest[0] > "5") up = true;
  else if (rest[0] === "5") {
    if (/[1-9]/.test(rest.slice(1))) up = true;
    else up = Number(kept[kept.length - 1]) % 2 === 1; // exact tie -> even
  }
  let digits = kept;
  if (up) {
    const arr = digits.split("");
    let i = arr.length - 1;
    while (i >= 0) {
      if (arr[i] === "9") {
        arr[i] = "0";
        i--;
      } else {
        arr[i] = String(Number(arr[i]) + 1);
        break;
      }
    }
    if (i < 0) arr.unshift("1");
    digits = arr.join("");
  }
  const ip = digits.slice(0, digits.length - nd) || "0";
  const fp = digits.slice(digits.length - nd);
  return (neg ? "-" : "") + ip.replace(/^0+(?=\d)/, "") + (nd > 0 ? "." + fp : "");
}

/** Python's round(x, nd): ties to even. -0 is normalised to 0. */
export function pyRound(x: number, nd = 0): number {
  return Number(pyFixed(x, nd)) + 0;
}

/**
 * Python's sum() over floats (3.12+ uses Neumaier compensated summation), so
 * totals agree with the original to the last bit before rounding.
 */
export function pySum(values: Iterable<number>): number {
  let sum = 0;
  let c = 0;
  for (const x of values) {
    const t = sum + x;
    if (Math.abs(sum) >= Math.abs(x)) c += sum - t + x;
    else c += x - t + sum;
    sum = t;
  }
  return Number.isFinite(sum) && c ? sum + c : sum;
}

// ============ DATES ('YYYY-MM-DD', UTC-safe) ============

// The salon is a single physical location in South Africa — using the server's
// local time instead of this fixed zone showed "Good morning" at midday
// whenever the host's clock was in a different zone.
export const SALON_TZ = "Africa/Johannesburg";

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];
const WEEKDAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

const DAY_MS = 86_400_000;

/** 'YYYY-MM-DD' (or a longer ISO string) → midnight UTC Date. */
export function parseDate(s: string): Date {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(s));
  if (!m) throw new Error(`Invalid date: ${s}`);
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  if (d.getUTCDate() !== Number(m[3]) || d.getUTCMonth() !== Number(m[2]) - 1) {
    throw new Error(`Invalid date: ${s}`);
  }
  return d;
}

/** UTC Date → 'YYYY-MM-DD'. */
export function formatDate(d: Date): ISODate {
  const y = String(d.getUTCFullYear()).padStart(4, "0");
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/** Normalise any date-ish string to 'YYYY-MM-DD' (Python's `str(s)[:10]`). */
export function toDate(s: string): ISODate {
  return formatDate(parseDate(s));
}

export function addDays(s: ISODate, n: number): ISODate {
  return formatDate(new Date(parseDate(s).getTime() + n * DAY_MS));
}

/** Whole days from a to b (b - a), like Python's `(b - a).days`. */
export function daysBetween(a: ISODate, b: ISODate): number {
  return Math.round((parseDate(b).getTime() - parseDate(a).getTime()) / DAY_MS);
}

/** Python's date.weekday(): Monday = 0 … Sunday = 6. */
export function weekday(s: ISODate): number {
  return (parseDate(s).getUTCDay() + 6) % 7;
}

export function dayOfMonth(s: ISODate): number {
  return parseDate(s).getUTCDate();
}

export function monthName(s: ISODate): string {
  return MONTHS[parseDate(s).getUTCMonth()];
}

export function minDate(a: ISODate, b: ISODate): ISODate {
  return a <= b ? a : b;
}

export interface SaNow {
  date: ISODate;
  time: string; // 'HH:MM:SS'
  hour: number;
  minute: number;
  second: number;
}

/** The current wall-clock moment in the salon's timezone. */
export function nowSa(at: Date = new Date()): SaNow {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: SALON_TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(at);
  const get = (t: Intl.DateTimeFormatPartTypes) => parts.find((p) => p.type === t)?.value ?? "00";
  const hour = Number(get("hour")) % 24;
  const minute = Number(get("minute"));
  const second = Number(get("second"));
  const pad = (n: number) => String(n).padStart(2, "0");
  return {
    date: `${get("year")}-${get("month")}-${get("day")}`,
    time: `${pad(hour)}:${pad(minute)}:${pad(second)}`,
    hour,
    minute,
    second,
  };
}

/** Today in Africa/Johannesburg — every page computes TODAY from this. */
export function todaySa(at: Date = new Date()): ISODate {
  return nowSa(at).date;
}

/** '11 July' without the leading-zero day. */
export function fmtDayMonth(d: ISODate): string {
  return `${dayOfMonth(d)} ${monthName(d)}`;
}

/** '11 Jul' without the leading-zero day. */
export function fmtDayMonShort(d: ISODate): string {
  return `${dayOfMonth(d)} ${monthName(d).slice(0, 3)}`;
}

/** 'Saturday, 11 July' without the leading-zero day. */
export function fmtWeekdayDayMonth(d: ISODate): string {
  return `${WEEKDAYS[weekday(d)]}, ${dayOfMonth(d)} ${monthName(d)}`;
}

/** [first, last] calendar day of the month `d` falls in. */
export function monthBounds(d: ISODate): [ISODate, ISODate] {
  const p = parseDate(d);
  const start = new Date(Date.UTC(p.getUTCFullYear(), p.getUTCMonth(), 1));
  const end = new Date(Date.UTC(p.getUTCFullYear(), p.getUTCMonth() + 1, 0));
  return [formatDate(start), formatDate(end)];
}

// ============ PHONE / OUTREACH ============

// Python's \D is "not a Unicode decimal digit"; match that rather than ASCII.
const NON_DIGIT = /\P{Nd}/gu;

function digitsOf(phone: string | null | undefined): string {
  return (phone || "").replace(NON_DIGIT, "");
}

/** South African local format — exactly 10 digits once spaces/dashes are stripped. */
export function validPhone(phone: string | null | undefined): boolean {
  return Array.from(digitsOf(phone)).length === 10;
}

/** SA number → international digits for wa.me (0821234567 → 27821234567), else null. */
export function waNumber(phone: string | null | undefined): string | null {
  const digits = digitsOf(phone);
  const len = Array.from(digits).length;
  if (len === 10 && digits.startsWith("0")) return "27" + digits.slice(1);
  if (len === 11 && digits.startsWith("27")) return digits;
  return null;
}

/** Python's urllib.parse.quote(s): keeps A-Z a-z 0-9 _.-~ and '/', encodes the rest. */
export function pyQuote(s: string): string {
  return encodeURIComponent(s)
    .replace(/[!'()*]/g, (c) => "%" + c.charCodeAt(0).toString(16).toUpperCase())
    .replace(/%2F/g, "/");
}

/**
 * One-tap WhatsApp deep link with the message pre-typed — the whole outreach
 * flow costs nothing and needs no API: the link just opens the client's chat.
 */
export function waLink(phone: string | null | undefined, message: string): string | null {
  const n = waNumber(phone);
  return n ? `https://wa.me/${n}?text=${pyQuote(message)}` : null;
}

/**
 * SMS deep link for clients with a phone but no WhatsApp. `sms:<number>?body=`
 * opens the native messaging app pre-filled on both modern iOS and Android.
 */
export function smsLink(phone: string | null | undefined, message: string): string | null {
  const n = waNumber(phone); // same 10-digit SA -> 27... normalisation
  return n ? `sms:+${n}?body=${pyQuote(message)}` : null;
}

/** Plain dialer link, or null if there's no usable number. */
export function telLink(phone: string | null | undefined): string | null {
  const digits = digitsOf(phone);
  return Array.from(digits).length >= 10 ? `tel:${digits}` : null;
}

export function firstName(name: string | null | undefined): string {
  return (name || "").trim().split(" ")[0];
}

export function clientInitial(name: string | null | undefined): string {
  const t = (name || "").trim();
  return t ? Array.from(t)[0].toUpperCase() : "?";
}

// ============ PAGING ============

/**
 * PostgREST caps an unbounded select at 1000 rows and says nothing — no error,
 * just a short list. Reads are ordered ascending, so the rows lost are the
 * NEWEST: past the cap today's bookings vanish, revenue collapses and collision
 * detection stops seeing recent bookings. Every read pages explicitly.
 */
export const PAGE = 1000;

export interface RangeQuery<T> {
  range(from: number, to: number): PromiseLike<{ data: T[] | null; error: unknown }>;
}

/**
 * Run buildQuery() in PAGE-sized pages until a short page ends it.
 *
 * buildQuery must return a *fresh* query each call — builders carry state, so
 * reusing one compounds the range filter. Every caller must order by a unique
 * tiebreaker (id) last, or rows sharing a sort key can straddle a page
 * boundary and be duplicated or skipped.
 */
export async function fetchAll<T>(buildQuery: () => RangeQuery<T>): Promise<T[]> {
  const rows: T[] = [];
  let offset = 0;
  for (;;) {
    const { data, error } = await buildQuery().range(offset, offset + PAGE - 1);
    if (error) throw error;
    const batch = data || [];
    rows.push(...batch);
    if (batch.length < PAGE) return rows;
    offset += PAGE;
  }
}

// ============ MONEY / LOYALTY ============

/** Recognised revenue = gross service total minus discount. Never includes tip. */
export function netRevenue(bookingServicesTotal: number, discount: number): number {
  return Math.max(0, bookingServicesTotal - discount);
}

/** Every 5th completed visit qualifies for the loyalty discount. */
export function loyaltyDiscountDue(completedVisitCount: number): boolean {
  return completedVisitCount > 0 && completedVisitCount % 5 === 0;
}

export type LoyaltyKind = "none" | "due" | "progress";

/** [progressPct 0-100, visitsToNext, kind] for the loyalty bar. */
export function loyaltyProgress(
  completedVisitCount: number,
  milestone = 5,
): [number, number, LoyaltyKind] {
  if (completedVisitCount === 0) return [0, milestone, "none"];
  if (completedVisitCount % milestone === 0) return [100, 0, "due"];
  const toNext = milestone - (completedVisitCount % milestone);
  return [((completedVisitCount % milestone) / milestone) * 100, toNext, "progress"];
}

// ============ PRE-SYSTEM HISTORY ============

export const PRIOR_VISIT_LABEL = "Before this app";
export const MAX_PRIOR_VISITS = 200;

/**
 * Synthesise a client's pre-system history from two remembered facts: roughly
 * how many visits, roughly how often.
 *
 * Starting from an empty book makes the app confidently wrong about long-time
 * regulars — badged "New Client", loyalty at 0, no rhythm for months. Laying out
 * `count` visits backwards from today at `everyDays` spacing buys back a correct
 * visit count (loyalty), a real cadence (recall, rebooking) and an honest "not
 * new". The dates are estimates and are labelled as such wherever they appear.
 *
 * Revenue is untouched: prior_visits never feed any money figure, which is
 * exactly why an estimate here is safe.
 */
export function estimatedPriorVisits(
  count: number | null | undefined,
  everyDays: number | null | undefined = 28,
  today: ISODate = todaySa(),
  label: string = PRIOR_VISIT_LABEL,
): PriorVisit[] {
  const n = Math.max(0, Math.min(Math.trunc(Number(count || 0)), MAX_PRIOR_VISITS));
  const every = Math.max(1, Math.trunc(Number(everyDays || 28)));
  // Most recent at one interval back (so "last visit" is sane, not today),
  // then evenly backwards; returned oldest first.
  const out: PriorVisit[] = [];
  for (let i = 0; i < n; i++) {
    out.push({ date: addDays(today, -every * (i + 1)), service: label, price: "—" });
  }
  return out.reverse();
}

/**
 * True for a synthesised pre-system visit, in either shape it appears in: raw
 * prior_visits rows carry the label under `service`; clientVisits() renames it
 * to `label`. Checking only one silently rendered estimates as real visits.
 */
export function isEstimatedVisit(
  visit: { service?: string | null; label?: string | null } | null | undefined,
): boolean {
  const v = visit || {};
  return v.service === PRIOR_VISIT_LABEL || v.label === PRIOR_VISIT_LABEL;
}

// ============ SERVICES / PACKAGES ============

/**
 * A package deal is a `services` row under this reserved category — no separate
 * table, so it books, snapshots, soft-deletes and reports like any service. The
 * bundle price is set once, never derived from components.
 */
export const PACKAGE_CATEGORY = "Packages";

// ============ BOOKINGS ============

/**
 * How the client paid. Null means it was never recorded — true of every booking
 * taken before this existed — so it shows as "not recorded", never guessed.
 */
export const PAYMENT_METHODS = ["cash", "card", "transfer"] as const;
export const PAYMENT_LABELS: Readonly<Record<string, string>> = {
  cash: "Cash",
  card: "Card",
  transfer: "Transfer/EFT",
};

export function paymentLabel(booking: Pick<BookingLike, "payment_method">): string {
  const key = booking.payment_method || "";
  return Object.prototype.hasOwnProperty.call(PAYMENT_LABELS, key) ? PAYMENT_LABELS[key] : "Not recorded";
}

/** Gross service total — what the price list says, before any discount. */
export function bookingTotal(booking: Pick<BookingLike, "booking_services">): number {
  return pySum((booking.booking_services || []).map((bs) => bs.price_at_time));
}

/**
 * Recognised revenue for a booking: gross services minus discount, tip never
 * counted. Every revenue figure must sum THIS — summing bookingTotal()
 * over-reports whenever a (loyalty) discount was given.
 */
export function bookingNet(booking: Pick<BookingLike, "booking_services" | "discount">): number {
  return netRevenue(bookingTotal(booking), booking.discount || 0);
}

export function bookingTitle(booking: Pick<BookingLike, "booking_services">): string {
  const svcs = booking.booking_services || [];
  if (!svcs.length) return "—";
  if (svcs.length === 1) return svcs[0].service_name;
  return `${svcs[0].service_name} +${svcs.length - 1} more`;
}

/**
 * Past bookings still marked pending, oldest first.
 *
 * Every money and loyalty figure counts *past confirmed* bookings only, so a
 * booking whose date passed while still pending counts for nothing: revenue
 * quietly omits it and her loyalty stalls a visit short. This list is the only
 * thing that surfaces them. Oldest first — the one she'll remember least.
 */
export function bookingsAwaitingDecision<B extends BookingLike>(allBookings: B[], today: ISODate): B[] {
  return allBookings
    .filter((b) => b.status === "pending" && String(b.date) < String(today))
    .sort((a, b) => cmpTuple([String(a.date), String(a.time)], [String(b.date), String(b.time)]));
}

/** Minutes since midnight for 'HH:MM[:SS]'. */
export function toMinutes(t: string): number {
  const parts = String(t).split(":");
  return parseInt(parts[0], 10) * 60 + parseInt(parts[1], 10);
}

const NOT_BLOCKING = new Set(["cancelled", "no-show"]);

/** True interval overlap. Cancelled/no-show bookings never block a slot. */
export function findCollision<B extends BookingLike>(
  bookings: B[],
  dateStr: ISODate,
  timeStr: string,
  durationMin: number | null | undefined,
  excludeId: string | null = null,
): B | null {
  const newStart = toMinutes(timeStr);
  const newEnd = newStart + (durationMin || 30);
  for (const b of bookings) {
    if (b.id === excludeId) continue;
    if (b.date !== String(dateStr)) continue;
    if (NOT_BLOCKING.has(b.status)) continue;
    const bStart = toMinutes(b.time);
    const bEnd = bStart + (b.duration_minutes || 30);
    if (newStart < bEnd && bStart < newEnd) return b;
  }
  return null;
}

export const OPEN_MIN = 8 * 60;
export const CLOSE_MIN = 19 * 60;

/**
 * Open [start, end] minute intervals between one day's bookings, within working
 * hours. Cancelled/no-show bookings don't occupy their slot (same rule as
 * findCollision), so a freed slot is immediately offerable again.
 */
export function freeGaps(
  dayBookings: BookingLike[],
  startMin = OPEN_MIN,
  endMin = CLOSE_MIN,
): [number, number][] {
  const items: [number, number][] = [];
  for (const b of dayBookings) {
    if (NOT_BLOCKING.has(b.status)) continue;
    let s = toMinutes(b.time);
    let e = s + (b.duration_minutes || 30);
    // Clamp to working hours up front. A booking starting after closing (a
    // 19:30 squeeze-in) used to survive as an inverted interval and drag the
    // gap before it out to *its* start — "free until 19:30" on a salon that
    // shuts at 19:00. Anything wholly outside the day now drops out.
    s = Math.max(s, startMin);
    e = Math.min(e, endMin);
    if (e <= s) continue;
    items.push([s, e]);
  }
  items.sort((a, b) => cmpTuple(a, b));
  let cursor = startMin;
  const gaps: [number, number][] = [];
  for (const [s, e] of items) {
    if (s > cursor) gaps.push([cursor, s]);
    cursor = Math.max(cursor, e);
  }
  if (cursor < endMin) gaps.push([cursor, endMin]);
  return gaps;
}

/** Lexicographic tuple comparison, like Python's tuple ordering. */
export function cmpTuple(a: ReadonlyArray<string | number>, b: ReadonlyArray<string | number>): number {
  for (let i = 0; i < Math.min(a.length, b.length); i++) {
    if (a[i] < b[i]) return -1;
    if (a[i] > b[i]) return 1;
  }
  return a.length - b.length;
}

// ============ RECURRING SERIES ============

export function computeRecurringDates(
  startDate: ISODate,
  freqDays: number,
  endType: RecurringEndType | string,
  endCount: number | null = null,
  endDate: ISODate | null = null,
): ISODate[] {
  const dates = [startDate];
  if (endType === "count") {
    const n = Math.max(1, endCount || 1);
    for (let i = 1; i < n; i++) dates.push(addDays(startDate, freqDays * i));
  } else {
    let d = startDate;
    while (dates.length < 60) {
      const nxt = addDays(d, freqDays);
      if (!endDate || nxt > endDate) break;
      dates.push(nxt);
      d = nxt;
    }
  }
  return dates;
}

const FREQ_LABELS = new Map<number, string>([
  [7, "Weekly"],
  [14, "Every 2 Weeks"],
  [28, "Every 4 Weeks"],
]);

export function freqLabel(freqDays: number): string {
  return FREQ_LABELS.get(freqDays) ?? `Every ${freqDays} days`;
}

// ============ VISIT HISTORY / RECALL / NEW-CLIENT ============

export interface ClientVisit {
  date: ISODate;
  label: string;
  priceLabel: string;
  status: string;
  source: "prior" | "live";
}

/** Merge one-time pre-system prior_visits with live bookings (past only), newest first. */
export function clientVisits(client: ClientLike, allBookings: BookingLike[], today: ISODate): ClientVisit[] {
  const prior: ClientVisit[] = (client.prior_visits || []).map((v) => ({
    date: v.date,
    label: v.service,
    priceLabel: v.price,
    status: "confirmed",
    source: "prior",
  }));
  const live: ClientVisit[] = allBookings
    .filter((b) => b.client_id === client.id && b.date < String(today))
    .map((b) => ({
      date: b.date,
      label: bookingTitle(b),
      priceLabel: `R${pyFixed(bookingTotal(b), 0)}`,
      status: b.status,
      source: "live",
    }));
  // Python's sorted(..., reverse=True) is stable and keeps equal keys in order.
  return [...prior, ...live]
    .map((v, i) => [v, i] as const)
    .sort(([a, ia], [b, ib]) => (a.date < b.date ? 1 : a.date > b.date ? -1 : ia - ib))
    .map(([v]) => v);
}

export function completedVisitCount(client: ClientLike, allBookings: BookingLike[], today: ISODate): number {
  const prior = (client.prior_visits || []).length;
  const liveConfirmed = allBookings.filter(
    (b) => b.client_id === client.id && b.date < String(today) && b.status === "confirmed",
  ).length;
  return prior + liveConfirmed;
}

export function clientHasUpcoming(client: ClientLike, allBookings: BookingLike[], today: ISODate): boolean {
  return allBookings.some(
    (b) => b.client_id === client.id && b.date >= String(today) && b.status !== "cancelled",
  );
}

export function needsRebooking(client: ClientLike, allBookings: BookingLike[], today: ISODate): boolean {
  return completedVisitCount(client, allBookings, today) > 0 && !clientHasUpcoming(client, allBookings, today);
}

/** client_id -> earliest 'date+time' key, for clients with no prior_visits. */
export function firstVisitMap(clients: ClientLike[], allBookings: BookingLike[]): Map<string | null, string> {
  const byClient = new Map<string | null, BookingLike[]>();
  for (const b of allBookings) {
    const list = byClient.get(b.client_id);
    if (list) list.push(b);
    else byClient.set(b.client_id, [b]);
  }
  const clientsById = new Map(clients.map((c) => [c.id, c]));
  const result = new Map<string | null, string>();
  for (const [cid, blist] of byClient) {
    const c = cid === null ? undefined : clientsById.get(cid);
    if (!c || (c.prior_visits || []).length) continue;
    let earliest = blist[0];
    for (const b of blist) {
      if (cmpTuple([b.date, b.time], [earliest.date, earliest.time]) < 0) earliest = b;
    }
    result.set(cid, earliest.date + earliest.time);
  }
  return result;
}

export function isFirstVisit(booking: BookingLike, fvMap: Map<string | null, string>): boolean {
  return fvMap.get(booking.client_id) === booking.date + booking.time;
}
