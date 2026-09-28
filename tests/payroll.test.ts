/** Port of tests/test_payroll.py — the month-end list Nicky hands her boss. */
import JSZip from "jszip";
import { describe, expect, it } from "vitest";
import {
  bookingRow,
  csvSafe,
  defaultMonth,
  doneBookings,
  exportFilename,
  monthKey,
  monthLabel,
  monthOptions,
  monthStart,
  paymentSplit,
  payrollRows,
  pendingBookings,
  rowsToCsv,
  rowsToXlsx,
  totals,
  upcomingBookings,
} from "@/lib/payroll";
import { bookingNet, monthBounds, pySum } from "@/lib/salon";
import type { BookingLike, ClientLike, ServiceLine } from "@/lib/types";

const TODAY = "2026-08-20";
const [AUG_START, AUG_END] = monthBounds("2026-08-01");

function svc(name: string, price: number): ServiceLine {
  return { service_name: name, price_at_time: price };
}

function bk(
  id: string,
  client_id = "c1",
  o: { date?: string; status?: string; time?: string; discount?: number; services?: ServiceLine[] } = {},
): BookingLike {
  return {
    id,
    client_id,
    date: o.date ?? "2026-08-05",
    time: o.time ?? "10:00",
    status: o.status ?? "confirmed",
    discount: o.discount ?? 0,
    tip: 0,
    booking_services: o.services ?? [svc("Gel Overlay", 300)],
  };
}

function cl(id: string, name = "Thandi"): ClientLike {
  return { id, name };
}

const CLIENTS = [cl("c1", "Thandi"), cl("c2", "Lerato")];

const rowsFor = (bookings: BookingLike[], clients = CLIENTS) => payrollRows(bookings, clients, AUG_START, AUG_END, TODAY);
const lines = (csv: string) => csv.trim().split(/\r\n|\n|\r/);

async function unzip(blob: Uint8Array) {
  const z = await JSZip.loadAsync(blob);
  const read = async (name: string) => {
    const f = z.file(name);
    if (!f) throw new Error(`missing ${name}`);
    return f.async("string");
  };
  return { z, read };
}

// ---------------- month helpers ----------------

describe("month helpers", () => {
  it("key, label, start round trip", () => {
    expect(monthKey("2026-08-20")).toBe("2026-08");
    expect(monthLabel("2026-08")).toBe("August 2026");
    expect(monthStart("2026-08")).toBe("2026-08-01");
  });

  it("options newest first and always offers this and last month", () => {
    const bookings = [bk("b1", "c1", { date: "2026-03-11" }), bk("b2", "c1", { date: "2026-06-02" })];
    expect(monthOptions(bookings, TODAY)).toEqual(["2026-08", "2026-07", "2026-06", "2026-03"]);
  });

  it("options have no duplicates when this month has bookings", () => {
    expect(monthOptions([bk("b1", "c1", { date: "2026-08-05" })], TODAY)).toEqual(["2026-08", "2026-07"]);
  });

  it("default month is last month while it is still being settled", () => {
    // Pay is settled once a month has ended, so the first days of a new month
    // are about the month that just closed.
    expect(defaultMonth("2026-09-03")).toBe("2026-08");
    expect(defaultMonth("2026-09-10")).toBe("2026-08");
    expect(defaultMonth("2026-09-11")).toBe("2026-09");
    expect(defaultMonth("2026-01-02")).toBe("2025-12"); // across a year boundary
  });
});

// ---------------- which bookings count ----------------

describe("which bookings count", () => {
  it("done bookings are confirmed and already happened", () => {
    const bookings = [
      bk("done", "c1", { date: "2026-08-05" }),
      bk("today", "c1", { date: "2026-08-20" }), // counts: the day has come
      bk("later", "c1", { date: "2026-08-28" }), // hasn't happened
      bk("pending", "c1", { date: "2026-08-06", status: "pending" }), // she hasn't said
      bk("noshow", "c1", { date: "2026-08-07", status: "no-show" }),
      bk("cancelled", "c1", { date: "2026-08-08", status: "cancelled" }),
      bk("other_month", "c1", { date: "2026-07-30" }),
    ];
    expect(doneBookings(bookings, AUG_START, AUG_END, TODAY).map((b) => b.id)).toEqual(["done", "today"]);
  });

  it("done bookings sorted by day then time", () => {
    const bookings = [
      bk("b2", "c1", { date: "2026-08-05", time: "14:00" }),
      bk("b1", "c1", { date: "2026-08-05", time: "09:00" }),
      bk("b0", "c1", { date: "2026-08-01" }),
    ];
    expect(doneBookings(bookings, AUG_START, AUG_END, TODAY).map((b) => b.id)).toEqual(["b0", "b1", "b2"]);
  });

  it("pending and upcoming are reported separately, not dropped", () => {
    const bookings = [
      bk("stale", "c1", { date: "2026-08-06", status: "pending" }),
      bk("pending_today", "c1", { date: "2026-08-20", status: "pending" }),
      bk("pending_later", "c1", { date: "2026-08-25", status: "pending" }), // not late yet
      bk("later", "c1", { date: "2026-08-28" }),
      bk("done", "c1", { date: "2026-08-05" }),
    ];
    expect(pendingBookings(bookings, AUG_START, AUG_END, TODAY).map((b) => b.id)).toEqual(["stale", "pending_today"]);
    expect(upcomingBookings(bookings, AUG_START, AUG_END, TODAY).map((b) => b.id)).toEqual(["later"]);
  });
});

// ---------------- rows ----------------

describe("rows", () => {
  it("one row per booking, its services together", () => {
    const rows = rowsFor([bk("b1", "c1", { services: [svc("Gel Overlay", 300), svc("Brow Wax", 90)] })]);
    expect(rows).toEqual([{
      date: "2026-08-05", client: "Thandi", services: "Gel Overlay, Brow Wax",
      houseCall: false, payment: "Not recorded", serviceCount: 2, discount: 0, amount: 390, bookingId: "b1",
    }]);
  });

  it("a quantity reads as one service line (Nail Art x 3)", () => {
    const rows = rowsFor([bk("b1", "c1", { services: [svc("Gel Overlay", 300), { ...svc("Nail Art", 60), quantity: 3 }] })]);
    expect(rows[0].services).toBe("Gel Overlay, Nail Art x 3");
    expect(rows[0].amount).toBe(360);
    expect(totals(rows).services).toBe(2);
  });

  it("a house call and the payment method have their own columns", () => {
    const b = { ...bk("b1"), house_call: true, payment_method: "card" };
    expect([rowsFor([b])[0].houseCall, rowsFor([b])[0].payment]).toEqual([true, "Card"]);
    const v = { ...bk("b2"), payment_method: "voucher", voucher_code: "GV-0412" };
    expect(rowsFor([v])[0].payment).toBe("Voucher GV-0412");
    expect(lines(rowsToCsv(rowsFor([b])))[1]).toBe("2026-08-05,Thandi,Gel Overlay,Yes,Card,,300.00");
  });

  it("the discount has its own column and the amount is after it", () => {
    const rows = rowsFor([bk("b1", "c1", { discount: 78, services: [svc("Gel Overlay", 300), svc("Brow Wax", 90)] })]);
    expect([rows[0].discount, rows[0].amount]).toEqual([78, 312]);
  });

  it("row total is exactly booking_net, the same number reports shows", () => {
    const bookings = [
      bk("b1", "c1", { discount: 60, services: [svc("Gel Overlay", 300)] }),
      bk("b2", "c2", { date: "2026-08-09", services: [svc("Pedi", 250), svc("Brow Wax", 90)] }),
    ];
    const rows = rowsFor(bookings);
    const net = pySum(bookings.map(bookingNet));
    expect(totals(rows).total).toBe(net);
    expect(net).toBe(580);
    for (const b of bookings) expect(rows.find((r) => r.bookingId === b.id)!.amount).toBe(bookingNet(b));
  });

  it("a discount bigger than the visit cannot push the total negative", () => {
    // bookingNet() clamps at zero; the export has to clamp the same way.
    const b = bk("b1", "c1", { discount: 500, services: [svc("Brow Wax", 90)] });
    const rows = rowsFor([b]);
    expect([rows[0].discount, rows[0].amount]).toEqual([90, 0]);
    expect(totals(rows).total).toBe(bookingNet(b));
    expect(bookingNet(b)).toBe(0);
  });

  it("a booking with no services contributes nothing even with a discount", () => {
    expect(bookingRow(bk("b1", "c1", { discount: 50, services: [] }), "Thandi")).toBeNull();
  });

  it("tips never reach the list", () => {
    const b = bk("b1", "c1", { services: [svc("Gel Overlay", 300)] });
    b.tip = 100;
    expect(totals(rowsFor([b])).total).toBe(300);
  });

  it("a client no longer on file still gets her line", () => {
    const rows = rowsFor([bk("b1", "gone")]);
    expect(rows[0].client).toBe("(client not on file)");
  });

  it("totals count visits by booking, not by client-day", () => {
    const bookings = [
      bk("b1", "c1", { time: "09:00", services: [svc("Gel Overlay", 300)] }),
      bk("b2", "c1", { time: "15:00", services: [svc("Brow Wax", 90)] }), // same client, same day
    ];
    const t = totals(rowsFor(bookings));
    expect([t.appointments, t.services, t.total]).toEqual([2, 2, 390]);
  });
});

// ---------------- files ----------------

describe("files", () => {
  it("CSV is a plain table with a total row", () => {
    const rows = rowsFor([
      bk("b1", "c1", { discount: 60, services: [svc("Gel Overlay", 300), svc("Brow Wax", 90)] }),
      bk("b2", "c2", { date: "2026-08-09", services: [svc("Pedi", 250)] }),
    ]);
    const ls = lines(rowsToCsv(rows));
    expect(ls[0]).toBe("Date,Client,Services,House call,Payment,Discount (R),Amount (R)");
    expect(ls[1]).toBe('2026-08-05,Thandi,"Gel Overlay, Brow Wax",,Not recorded,60.00,330.00');
    expect(ls[2]).toBe("2026-08-09,Lerato,Pedi,,Not recorded,,250.00");
    expect(ls[3]).toBe(",,,,TOTAL,60.00,580.00");
  });

  it("CSV of an empty month still has a header and a zero total", () => {
    expect(lines(rowsToCsv([]))).toEqual(["Date,Client,Services,House call,Payment,Discount (R),Amount (R)", ",,,,TOTAL,0.00,0.00"]);
  });

  it("xlsx is one sheet with live total formulas", async () => {
    const rows = rowsFor([
      bk("b1", "c1", { discount: 60, services: [svc("Gel Overlay", 300)] }),
      bk("b2", "c2", { date: "2026-08-09", services: [svc("Pedi", 250)] }),
    ]);
    const { read, z } = await unzip(await rowsToXlsx(rows, "2026-08", "2026-09-01"));
    const workbook = await read("xl/workbook.xml");
    expect(workbook).toContain('name="Services"');
    expect(workbook).not.toContain('name="Summary"');
    expect(z.files["xl/worksheets/sheet2.xml"]).toBeUndefined();
    // Live formulas, not baked-in numbers: she can delete a line she was told
    // to leave off and the total she is paid on follows her edit.
    const sheet = await read("xl/worksheets/sheet1.xml");
    expect(sheet).toContain("SUM(F5:F6)");
    expect(sheet).toContain("SUM(G5:G6)");
    expect(await read("xl/sharedStrings.xml")).toContain("August 2026");
  });

  it("xlsx of an empty month is still a valid workbook", async () => {
    const { z } = await unzip(await rowsToXlsx([], "2026-08"));
    // Equivalent of zipfile.testzip(): every member decompresses cleanly.
    const names = Object.keys(z.files).filter((n) => !z.files[n].dir);
    expect(names.length).toBeGreaterThan(0);
    for (const n of names) await expect(z.files[n].async("uint8array")).resolves.toBeInstanceOf(Uint8Array);
  });
});

// ---------------- formula injection ----------------

describe("formula injection", () => {
  it("a name that looks like a formula is neutralised in the CSV", () => {
    // The export is the one file that leaves the app. A cell beginning "=" runs
    // as a formula the moment her boss opens it.
    const evil = '=HYPERLINK("http://attacker.example","Click")';
    const rows = rowsFor([bk("b1", "c1", { services: [svc("=1+1", 300)] })], [cl("c1", evil)]);
    const line = lines(rowsToCsv(rows))[1];
    expect(line).toContain("\"'=HYPERLINK"); // apostrophe-prefixed, so Excel reads it as text
    expect(line).toContain("'=1+1");
    expect(line).not.toContain('"=HYPERLINK'); // and never reaches the file unprefixed
  });

  it("every formula leader is covered and ordinary names are untouched", () => {
    for (const leader of ["=", "+", "-", "@", "\t", "\r"]) {
      expect(csvSafe(leader + "x")).toBe("'" + leader + "x");
    }
    for (const ordinary of ["Thandi Mbeki", "O'Brien", "Anne-Marie", "R&B Nails", ""]) {
      expect(csvSafe(ordinary)).toBe(ordinary);
    }
  });

  it("xlsx stores a formula-shaped name as inert text", async () => {
    const rows = rowsFor([bk("b1")], [cl("c1", "=1+1")]);
    const { read } = await unzip(await rowsToXlsx(rows, "2026-08"));
    // Exactly the two intended TOTAL sums on this sheet are formulas; the name is not.
    expect((await read("xl/worksheets/sheet1.xml")).split("<f>").length - 1).toBe(2);
    expect(await read("xl/sharedStrings.xml")).toContain("1+1");
  });

  it("filename says whose month it is", () => {
    expect(exportFilename("2026-08", "xlsx")).toBe("Nicky - services - August 2026.xlsx");
    expect(exportFilename("2026-12", "csv")).toBe("Nicky - services - December 2026.csv");
  });
});

// ---------------- how it was paid ----------------

describe("payment split", () => {
  it("groups by method and keeps the same money", () => {
    const bookings: BookingLike[] = [
      { ...bk("b1", "c1", { services: [svc("Gel Overlay", 300)] }), payment_method: "cash" },
      { ...bk("b2", "c1", { services: [svc("Brow Wax", 90)] }), payment_method: "cash" },
      { ...bk("b3", "c1", { services: [svc("Pedi", 250)] }), payment_method: "card" },
      bk("b4", "c1", { discount: 60, services: [svc("Gel Overlay", 300)] }), // not recorded
    ];
    const split = paymentSplit(bookings, bookingNet);
    expect(split.map((s) => [s.method, s.count, s.total])).toEqual([
      ["cash", 2, 390.0],
      ["card", 1, 250.0],
      ["unrecorded", 1, 240.0],
    ]);
    // Grouping must never change the money: same total as the service rows.
    const net = pySum(bookings.map(bookingNet));
    expect(pySum(split.map((s) => s.total))).toBe(net);
    expect(net).toBe(880);
  });

  it("orders cash first and unrecorded last", () => {
    const bookings = [null, "transfer", "card", "cash"].map((m) => ({ ...bk("b1"), payment_method: m }));
    expect(paymentSplit(bookings, bookingNet).map((s) => s.method)).toEqual(["cash", "card", "transfer", "unrecorded"]);
  });

  it("of nothing is empty", () => {
    expect(paymentSplit([], bookingNet)).toEqual([]);
  });

  it("a discount still reduces what the split reports", () => {
    const b = { ...bk("b1", "c1", { discount: 60, services: [svc("Gel Overlay", 300)] }), payment_method: "cash" };
    expect(paymentSplit([b], bookingNet)[0].total).toBe(240.0);
  });
});
