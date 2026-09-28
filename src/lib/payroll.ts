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
 *   - It counts the money every other figure counts: a row per visit, its
 *     services listed together, its discount in its own column and its amount
 *     exactly bookingNet(), so the column sums to sum(bookingNet(...)). The
 *     discount is never apportioned across services — that would invent a
 *     number. Tips never appear. (Nicky asked for one row per booking and no
 *     per-service summary on 2026-09-28: "Nail art x 3" and "x 4" are the same
 *     service to her, so a roll-up by line split them.)
 *   - Confirmed work only, and only up to today (<=). Past-pending and upcoming
 *     bookings are counted and surfaced, never silently dropped.
 *   - It is a spreadsheet, not a report: she can delete or reword a line and the
 *     .xlsx totals follow, because they are real SUM() formulas.
 */
import { cmpTuple, formatDate, monthName, parseDate, pyFixed, pyRound, pySum, toDate, todaySa } from "./salon";
import type { BookingLike, ClientLike, ISODate } from "./types";

export const COLUMNS = ["Date", "Client", "Services", "Discount (R)", "Amount (R)"] as const;

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
  /** Every service of the visit on one line: "Gel Overlay, Nail Art x 3". */
  services: string;
  /** How many service lines the visit had (a quantity line counts once). */
  serviceCount: number;
  /** The discount taken off this visit, as a positive number (0 when none). */
  discount: number;
  /** What the visit earned: services minus discount, exactly bookingNet(). */
  amount: number;
  bookingId: string | null;
}

/**
 * One booking → one row, the way Nicky thinks of her month: a client, what
 * she had done, what it came to. The discount is clamped to the visit's gross
 * so a row can never go below zero — bookingNet() clamps the same way, and the
 * whole point is that the total matches every other revenue figure in the app.
 */
export function bookingRow(booking: BookingLike, clientName: string): PayrollRow | null {
  const lines = booking.booking_services || [];
  if (!lines.length) return null;
  let gross = 0;
  const names: string[] = [];
  for (const bs of lines) {
    gross += Number(bs.price_at_time || 0);
    const qty = Number(bs.quantity || 1);
    names.push(qty > 1 ? `${bs.service_name} x ${qty}` : String(bs.service_name));
  }
  gross = pyRound(gross, 2);
  const discount = pyRound(Math.min(Math.max(Number(booking.discount || 0), 0), gross), 2);
  const services = names.join(", ") + (booking.house_call ? " (house call)" : "");
  return {
    date: toDate(booking.date),
    client: clientName,
    services,
    serviceCount: lines.length,
    discount,
    amount: pyRound(gross - discount, 2),
    bookingId: booking.id ?? null,
  };
}

/** Every visit done in the range, oldest first, one row each. */
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
    const row = bookingRow(b, name);
    if (row) rows.push(row);
  }
  return rows;
}

export interface PayrollTotals {
  services: number;
  appointments: number;
  discount: number;
  total: number;
}

/**
 * Headline figures: service lines, visits, discounts and what it adds up to.
 * Visits count booking ids, not client-days — a client who comes back the same
 * afternoon came twice.
 */
export function totals(rows: PayrollRow[]): PayrollTotals {
  return {
    services: pySum(rows.map((r) => r.serviceCount)),
    appointments: new Set(rows.map((r) => r.bookingId)).size,
    discount: pyRound(pySum(rows.map((r) => r.discount)), 2),
    total: pyRound(pySum(rows.map((r) => r.amount)), 2),
  };
}

export type PaymentKey = "cash" | "card" | "transfer" | "voucher" | "unrecorded" | string;

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
  const order: Record<string, number> = { cash: 0, card: 1, transfer: 2, voucher: 3, unrecorded: 4 };
  const rank = (m: string) => (Object.prototype.hasOwnProperty.call(order, m) ? order[m] : 9);
  return [...out.values()].sort((a, b) => rank(a.method) - rank(b.method));
}

export const PAYMENT_TITLES: Readonly<Record<string, string>> = {
  cash: "Cash",
  card: "Card",
  transfer: "Transfer/EFT",
  voucher: "Voucher",
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
  return rows.map((r) => [
    String(r.date), csvSafe(r.client), csvSafe(r.services), r.discount ? pyFixed(r.discount, 2) : "", pyFixed(r.amount, 2),
  ]);
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
  const t = totals(rows);
  out += csvRow(["", "", "TOTAL", pyFixed(t.discount, 2), pyFixed(t.total, 2)]);
  return out;
}

/** exceljs cell address helper, 0-based (row, col) like XlsxWriter. */
function addr(row: number, col: number): string {
  return String.fromCharCode(65 + col) + String(row + 1);
}

/**
 * One sheet, "Services": a row per visit. The totals are live SUM() formulas,
 * so the moment she edits or deletes a line, the number she is paid on
 * follows her edit.
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
  const fWrap: Style = { alignment: { wrapText: true, vertical: "top" } };

  const put = (ws: import("exceljs").Worksheet, row: number, col: number, value: import("exceljs").CellValue, style?: Style) => {
    const cell = ws.getCell(addr(row, col));
    cell.value = value;
    if (style) cell.style = style;
  };

  const label = monthLabel(key);
  const t = totals(rows);

  // ---- Services ----
  const ws = wb.addWorksheet("Services");
  [13, 22, 44, 13, 14].forEach((w, i) => (ws.getColumn(i + 1).width = w));
  put(ws, 0, 0, `${title} — services for ${label}`, fTitle);
  put(
    ws, 1, 0,
    `${t.appointments} appointments · ${t.services} services · ` +
      `prepared ${parseDate(prepared).getUTCDate()} ${monthName(prepared)} ${prepared.slice(0, 4)}`,
    fSub,
  );
  const headRow = 3;
  COLUMNS.forEach((name, col) => put(ws, headRow, col, name, col >= 3 ? fHeadR : fHead));
  rows.forEach((r, i) => {
    const row = headRow + 1 + i;
    put(ws, row, 0, parseDate(r.date), fDate); // UTC midnight -> exact Excel date
    put(ws, row, 1, r.client);
    put(ws, row, 2, r.services, fWrap);
    put(ws, row, 3, r.discount ? pyRound(r.discount, 2) : null, fMoney);
    put(ws, row, 4, pyRound(r.amount, 2), fMoney);
  });
  const totalRow = headRow + 1 + rows.length;
  for (let col = 0; col < 3; col++) put(ws, totalRow, col, null, fTotLbl);
  put(ws, totalRow, 2, "TOTAL", fTotLbl);
  if (rows.length) {
    put(ws, totalRow, 3, { formula: `SUM(D${headRow + 2}:D${totalRow})`, result: t.discount }, fTotNum);
    put(ws, totalRow, 4, { formula: `SUM(E${headRow + 2}:E${totalRow})`, result: t.total }, fTotNum);
  } else {
    put(ws, totalRow, 3, 0, fTotNum);
    put(ws, totalRow, 4, 0, fTotNum);
  }
  ws.views = [{ state: "frozen", xSplit: 0, ySplit: headRow + 1 }];
  if (rows.length) ws.autoFilter = `${addr(headRow, 0)}:${addr(totalRow - 1, 4)}`;

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
