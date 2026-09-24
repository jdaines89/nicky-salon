/**
 * The month-end list Nicky hands her boss to get paid (port of lib/payroll.py).
 *
 * Pure functions over the same booking/client rows the data layer returns, plus
 * two file writers: CSV in pure TS, and .xlsx via exceljs. No Supabase calls.
 *
 * The price list belongs to her employer, so what she is paid each month is
 * settled against a list of the services she performed. Retyping a month of
 * appointments is where money goes missing — so the app builds the list.
 *
 * Three rules keep this list agreeing with the rest of the app:
 *   - It counts the money every other figure counts: a row per service at its
 *     snapshotted price_at_time, then the booking's discount as its own negative
 *     line, so the column sums to exactly sum(bookingNet(...)). The discount is
 *     never apportioned across services — that would invent a number. Tips
 *     never appear.
 *   - Confirmed work only, and only up to today (<=). Past-pending and upcoming
 *     bookings are counted and surfaced, never silently dropped.
 *   - It is a spreadsheet, not a report: she can delete or reword a line and the
 *     .xlsx totals follow, because they are real SUM() formulas.
 */
import { cmpTuple, formatDate, monthName, parseDate, pyFixed, pyRound, pySum, toDate, todaySa } from "./salon";
import type { BookingLike, ClientLike, ISODate } from "./types";

export const DISCOUNT_LABEL = "Discount";
export const COLUMNS = ["Date", "Client", "Service", "Amount (R)"] as const;

/**
 * Characters that make a spreadsheet treat a cell as a formula. A client may
 * legitimately be called anything, so the guard belongs where the name is
 * written into a file someone else opens — not where she types it.
 */
const FORMULA_LEADERS = ["=", "+", "-", "@", "\t", "\r"];

// The app's own palette, so the file she sends looks like it came from the same tool.
const TEAL = "0E3B39";
const TEAL_SOFT = "E4EEEC";
const INK_SOFT = "647572";
const LINE = "E7E1D6";

export type MonthKey = string; // 'YYYY-MM'

/** '2026-08' — the key months are picked and compared by. */
export function monthKey(d: ISODate): MonthKey {
  return toDate(d).slice(0, 7);
}

export function monthStart(key: MonthKey): ISODate {
  const k = String(key);
  const y = Number(k.slice(0, 4));
  const m = Number(k.slice(5, 7));
  return formatDate(new Date(Date.UTC(y, m - 1, 1)));
}

/** 'August 2026' — what she and her boss both call the month. */
export function monthLabel(key: MonthKey): string {
  const start = monthStart(key);
  return `${monthName(start)} ${start.slice(0, 4)}`;
}

function lastMonthOf(today: ISODate): ISODate {
  const p = parseDate(today);
  return formatDate(new Date(Date.UTC(p.getUTCFullYear(), p.getUTCMonth(), 0)));
}

/**
 * 'YYYY-MM' keys newest first: every month with a booking on record, plus this
 * month and last month even when empty — the two she is most likely settling,
 * and an empty list is itself an answer worth being able to send.
 */
export function monthOptions(bookings: Pick<BookingLike, "date">[], today: ISODate): MonthKey[] {
  const keys = new Set(bookings.map((b) => String(b.date).slice(0, 7)));
  keys.add(monthKey(today));
  keys.add(monthKey(lastMonthOf(today)));
  return [...keys].sort().reverse();
}

/**
 * The month she most likely means. Pay is settled once a month has ended, so in
 * the first days of a month it's the one that just closed; after that, the one
 * in progress.
 */
export function defaultMonth(today: ISODate, cutoverDay = 10): MonthKey {
  if (parseDate(today).getUTCDate() <= cutoverDay) return monthKey(lastMonthOf(today));
  return monthKey(today);
}

function inRange(b: BookingLike, start: ISODate, end: ISODate): boolean {
  const d = String(b.date);
  return String(start) <= d && d <= String(end);
}

function sortBookings<B extends BookingLike>(bookings: B[]): B[] {
  return [...bookings].sort((a, b) =>
    cmpTuple([String(a.date), String(a.time), String(a.id)], [String(b.date), String(b.time), String(b.id)]),
  );
}

/**
 * Confirmed appointments in the range that have already happened — the work she
 * is owed for. `<= today`, not `<`: she settles a month on its last day, and a
 * strict `<` would drop that day's clients from their own month silently.
 */
export function doneBookings<B extends BookingLike>(bookings: B[], start: ISODate, end: ISODate, today: ISODate): B[] {
  return sortBookings(
    bookings.filter((b) => b.status === "confirmed" && inRange(b, start, end) && String(b.date) <= String(today)),
  );
}

/**
 * Appointments whose day has come while still marked pending. Left out of the
 * export and reported instead: including them would bill for possible
 * no-shows; dropping them quietly is how she gets underpaid.
 */
export function pendingBookings<B extends BookingLike>(bookings: B[], start: ISODate, end: ISODate, today: ISODate): B[] {
  return sortBookings(
    bookings.filter((b) => b.status === "pending" && inRange(b, start, end) && String(b.date) <= String(today)),
  );
}

/**
 * Confirmed appointments still ahead — real, not earned yet. Reported so a
 * mid-month export doesn't read as a short month.
 */
export function upcomingBookings<B extends BookingLike>(bookings: B[], start: ISODate, end: ISODate, today: ISODate): B[] {
  return sortBookings(
    bookings.filter((b) => b.status === "confirmed" && inRange(b, start, end) && String(b.date) > String(today)),
  );
}

export interface PayrollRow {
  date: ISODate;
  client: string;
  service: string;
  amount: number;
  kind: "service" | "discount";
  bookingId: string | null;
}

/**
 * One booking → its service lines, then its discount line if there was one.
 * The discount is clamped to the visit's gross so rows can never sum below
 * zero — bookingNet() clamps the same way, and the whole point is that this
 * total matches every other revenue figure in the app.
 */
export function bookingRows(booking: BookingLike, clientName: string): PayrollRow[] {
  const d = toDate(booking.date);
  const bid = booking.id ?? null;
  const rows: PayrollRow[] = [];
  let gross = 0;
  for (const bs of booking.booking_services || []) {
    const price = Number(bs.price_at_time || 0);
    gross += price;
    rows.push({ date: d, client: clientName, service: bs.service_name, amount: price, kind: "service", bookingId: bid });
  }
  const discount = Math.min(Number(booking.discount || 0), gross);
  if (discount > 0) {
    rows.push({ date: d, client: clientName, service: DISCOUNT_LABEL, amount: -discount, kind: "discount", bookingId: bid });
  }
  return rows;
}

/** Every service performed in the range, oldest first, as flat rows. */
export function payrollRows(
  bookings: BookingLike[],
  clients: ClientLike[],
  start: ISODate,
  end: ISODate,
  today: ISODate,
): PayrollRow[] {
  const names = new Map(clients.map((c) => [c.id, c.name]));
  const rows: PayrollRow[] = [];
  for (const b of doneBookings(bookings, start, end, today)) {
    const name =
      b.client_id !== null && names.has(b.client_id) ? (names.get(b.client_id) as string) : "(client not on file)";
    rows.push(...bookingRows(b, name));
  }
  return rows;
}

export interface PayrollTotals {
  services: number;
  appointments: number;
  total: number;
}

/**
 * Headline figures: service lines, visits they came from, and what it adds up
 * to. Visits count booking ids, not client-days — a client who comes back the
 * same afternoon came twice.
 */
export function totals(rows: PayrollRow[]): PayrollTotals {
  return {
    services: rows.filter((r) => r.kind === "service").length,
    appointments: new Set(rows.map((r) => r.bookingId)).size,
    total: pyRound(pySum(rows.map((r) => r.amount)), 2),
  };
}

export interface SummaryLine {
  service: string;
  count: number;
  total: number;
}

/**
 * Per-service totals, biggest earner first. Discounts collapse into one line,
 * kept last, so this sheet adds up to the same grand total as the detail.
 */
export function serviceSummary(rows: PayrollRow[]): SummaryLine[] {
  const tally = new Map<string, SummaryLine>();
  for (const r of rows) {
    let t = tally.get(r.service);
    if (!t) {
      t = { service: r.service, count: 0, total: 0 };
      tally.set(r.service, t);
    }
    t.count += 1;
    t.total = pyRound(t.total + r.amount, 2);
  }
  const all = [...tally.values()];
  const lines = all
    .filter((t) => t.service !== DISCOUNT_LABEL)
    .sort((a, b) => cmpTuple([-a.total, a.service], [-b.total, b.service]));
  return [...lines, ...all.filter((t) => t.service === DISCOUNT_LABEL)];
}

export type PaymentKey = "cash" | "card" | "transfer" | "unrecorded" | string;

export interface PaymentSlot {
  method: PaymentKey;
  count: number;
  total: number;
}

/**
 * What was taken in cash, on card, by transfer — and what wasn't recorded. The
 * service list says what she earned; the split says who is holding it (card
 * went to the owner's machine, cash is in her apron).
 *
 * `netOf` is passed in (the caller hands it bookingNet) so this module stays
 * independent of the revenue rule's home. Never changes a revenue figure.
 */
export function paymentSplit<B extends BookingLike>(bookings: B[], netOf: (b: B) => number): PaymentSlot[] {
  const out = new Map<string, PaymentSlot>();
  for (const b of bookings) {
    const key = b.payment_method || "unrecorded";
    let slot = out.get(key);
    if (!slot) {
      slot = { method: key, count: 0, total: 0 };
      out.set(key, slot);
    }
    slot.count += 1;
    slot.total = pyRound(slot.total + netOf(b), 2);
  }
  const order: Record<string, number> = { cash: 0, card: 1, transfer: 2, unrecorded: 3 };
  const rank = (m: string) => (Object.prototype.hasOwnProperty.call(order, m) ? order[m] : 9);
  return [...out.values()].sort((a, b) => rank(a.method) - rank(b.method));
}

export const PAYMENT_TITLES: Readonly<Record<string, string>> = {
  cash: "Cash",
  card: "Card",
  transfer: "Transfer/EFT",
  unrecorded: "Not recorded",
};

// ============ FILE WRITERS ============

/**
 * Stop a spreadsheet executing a client or service name as a formula.
 *
 * This export is the one thing whose output *leaves* the app: it goes to her
 * boss, who opens it in Excel/LibreOffice/Sheets. A cell beginning = + - @
 * becomes a formula that runs on someone else's machine. A leading apostrophe
 * is the convention every spreadsheet understands and strips on display. Only
 * text columns get this — Amount legitimately starts with "-" on discounts.
 */
export function csvSafe(value: unknown): string {
  const text = value === null || value === undefined ? "" : String(value);
  return FORMULA_LEADERS.some((l) => text.startsWith(l)) ? "'" + text : text;
}

function cells(rows: PayrollRow[]): string[][] {
  return rows.map((r) => [String(r.date), csvSafe(r.client), csvSafe(r.service), pyFixed(r.amount, 2)]);
}

/** Python csv.writer defaults: QUOTE_MINIMAL, doubled quotes, CRLF line ends. */
function csvField(f: string): string {
  return /[",\r\n]/.test(f) ? `"${f.replace(/"/g, '""')}"` : f;
}

function csvRow(fields: string[]): string {
  // csv.writer writes a lone empty field as "" so the row isn't blank.
  if (fields.length === 1 && fields[0] === "") return '""\r\n';
  return fields.map(csvField).join(",") + "\r\n";
}

/**
 * CSV with no title banner and no blank leading rows — whatever she opens it in
 * should see a table, not a puzzle. Dates stay ISO so no spreadsheet has to
 * guess between 8 December and 12 August.
 */
export function rowsToCsv(rows: PayrollRow[]): string {
  let out = csvRow([...COLUMNS]);
  for (const c of cells(rows)) out += csvRow(c);
  out += csvRow(["", "", "TOTAL", pyFixed(totals(rows).total, 2)]);
  return out;
}

/** exceljs cell address helper, 0-based (row, col) like XlsxWriter. */
function addr(row: number, col: number): string {
  return String.fromCharCode(65 + col) + String(row + 1);
}

/**
 * Two-sheet workbook: every line on "Services", the per-service roll-up on
 * "Summary". Both totals are live SUM() formulas, so the moment she edits or
 * deletes a line, the number she is paid on follows her edit.
 *
 * exceljs is loaded lazily so pages that only need the CSV/rows logic don't pay
 * for it in their bundle.
 */
export async function rowsToXlsx(
  rows: PayrollRow[],
  key: MonthKey,
  preparedOn: ISODate | null = null,
  title = "Nicky — Beauty & Nails",
): Promise<Uint8Array> {
  const ExcelJS = (await import("exceljs")).default;
  const prepared = preparedOn || todaySa();
  const wb = new ExcelJS.Workbook();

  type Style = Partial<import("exceljs").Style>;
  const argb = (hex: string) => ({ argb: "FF" + hex });
  const fill = (hex: string) => ({ type: "pattern" as const, pattern: "solid" as const, fgColor: argb(hex) });
  const thin = { style: "thin" as const, color: argb(TEAL) };
  const MONEY = "R#,##0.00";

  const fTitle: Style = { font: { bold: true, size: 15, color: argb(TEAL) } };
  const fSub: Style = { font: { size: 10, color: argb(INK_SOFT) } };
  const head = (align: "left" | "right"): Style => ({
    font: { bold: true, color: argb("FFFFFF") },
    fill: fill(TEAL),
    border: { top: thin, left: thin, bottom: thin, right: thin },
    alignment: { horizontal: align },
  });
  const fHead = head("left");
  const fHeadR = head("right");
  const fDate: Style = { numFmt: "dd mmm yyyy" };
  const fMoney: Style = { numFmt: MONEY };
  const totalBase: Style = {
    font: { bold: true },
    border: { top: { style: "medium", color: argb(LINE) } },
    fill: fill(TEAL_SOFT),
  };
  const fTotLbl: Style = totalBase;
  const fTotNum: Style = { ...totalBase, numFmt: MONEY };
  const fInt: Style = { numFmt: "0" };
  const fTotInt: Style = { ...totalBase, numFmt: "0" };

  const put = (ws: import("exceljs").Worksheet, row: number, col: number, value: import("exceljs").CellValue, style?: Style) => {
    const cell = ws.getCell(addr(row, col));
    cell.value = value;
    if (style) cell.style = style;
  };

  const label = monthLabel(key);
  const t = totals(rows);

  // ---- Services ----
  const ws = wb.addWorksheet("Services");
  [13, 24, 34, 14].forEach((w, i) => (ws.getColumn(i + 1).width = w));
  put(ws, 0, 0, `${title} — services for ${label}`, fTitle);
  put(
    ws, 1, 0,
    `${t.appointments} appointments · ${t.services} services · ` +
      `prepared ${parseDate(prepared).getUTCDate()} ${monthName(prepared)} ${prepared.slice(0, 4)}`,
    fSub,
  );
  const headRow = 3;
  COLUMNS.forEach((name, col) => put(ws, headRow, col, name, col === 3 ? fHeadR : fHead));
  rows.forEach((r, i) => {
    const row = headRow + 1 + i;
    put(ws, row, 0, parseDate(r.date), fDate); // UTC midnight -> exact Excel date
    put(ws, row, 1, r.client);
    put(ws, row, 2, r.service);
    put(ws, row, 3, pyRound(r.amount, 2), fMoney);
  });
  const totalRow = headRow + 1 + rows.length;
  for (let col = 0; col < 3; col++) put(ws, totalRow, col, null, fTotLbl);
  put(ws, totalRow, 2, "TOTAL", fTotLbl);
  if (rows.length) {
    put(ws, totalRow, 3, { formula: `SUM(D${headRow + 2}:D${totalRow})`, result: t.total }, fTotNum);
  } else {
    put(ws, totalRow, 3, 0, fTotNum);
  }
  ws.views = [{ state: "frozen", xSplit: 0, ySplit: headRow + 1 }];
  if (rows.length) ws.autoFilter = `${addr(headRow, 0)}:${addr(totalRow - 1, 3)}`;

  // ---- Summary ----
  const sm = wb.addWorksheet("Summary");
  [34, 13, 14].forEach((w, i) => (sm.getColumn(i + 1).width = w));
  put(sm, 0, 0, `Summary — ${label}`, fTitle);
  put(sm, 1, 0, "What was done, and what each service brought in", fSub);
  ["Service", "Times done", "Total (R)"].forEach((name, col) => put(sm, headRow, col, name, col === 0 ? fHead : fHeadR));
  const summary = serviceSummary(rows);
  summary.forEach((line, i) => {
    const row = headRow + 1 + i;
    put(sm, row, 0, line.service);
    put(sm, row, 1, line.count, fInt);
    put(sm, row, 2, pyRound(line.total, 2), fMoney);
  });
  const sTotal = headRow + 1 + summary.length;
  put(sm, sTotal, 0, "TOTAL", fTotLbl);
  // "Times done" totals service lines only. Discounts sit last with their own
  // count, but adding them in would claim she performed a discount.
  const nServices = summary.filter((x) => x.service !== DISCOUNT_LABEL).length;
  if (nServices) {
    put(sm, sTotal, 1, { formula: `SUM(B${headRow + 2}:B${headRow + 1 + nServices})`, result: t.services }, fTotInt);
  } else {
    put(sm, sTotal, 1, 0, fTotInt);
  }
  if (summary.length) {
    put(sm, sTotal, 2, { formula: `SUM(C${headRow + 2}:C${sTotal})`, result: t.total }, fTotNum);
  } else {
    put(sm, sTotal, 2, 0, fTotNum);
  }

  const buf = await wb.xlsx.writeBuffer();
  return new Uint8Array(buf as ArrayBuffer);
}

/**
 * 'Nicky - services - August 2026.xlsx' — it lands in a boss's downloads
 * folder next to everyone else's, so it says whose month it is.
 */
export function exportFilename(key: MonthKey, ext: string, who = "Nicky"): string {
  return `${who} - services - ${monthLabel(key)}.${ext}`;
}
