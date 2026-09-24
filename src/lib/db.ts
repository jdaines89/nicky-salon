/**
 * Every read and write the app makes. Pages never call supabase.from() directly,
 * so the rules about how data is saved live in one place.
 *
 * Reads page past PostgREST's silent 1000-row cap (fetchAll); writes snapshot
 * service names and prices onto booking_services so a later price change never
 * rewrites past revenue.
 */
import { supabase } from "@/lib/supabase";
import { computeRecurringDates, fetchAll, todaySa } from "@/lib/salon";
import type {
  BookingStatus, BookingWithServices, Client, ClientPhoto, PaymentMethod, PriorVisit,
  RecurringEndType, RecurringSeries, Service,
} from "@/lib/types";

export interface SalonData {
  clients: Client[];
  /** Every service, retired ones included; filter on `active` for pickers. */
  services: Service[];
  bookings: BookingWithServices[];
  series: RecurringSeries[];
}

function fail(error: unknown): never {
  const msg = (error as { message?: string })?.message ?? String(error);
  throw new Error(msg);
}

export async function loadAll(): Promise<SalonData> {
  const [clients, services, bookings, series] = await Promise.all([
    fetchAll<Client>(() => supabase.from("clients").select("*").order("name").order("id")),
    fetchAll<Service>(() => supabase.from("services").select("*").order("category").order("name").order("id")),
    fetchAll<BookingWithServices>(() =>
      supabase.from("bookings").select("*, booking_services(*)").order("date").order("time").order("id")),
    fetchAll<RecurringSeries>(() =>
      supabase.from("recurring_series").select("*").order("created_at", { ascending: false }).order("id")),
  ]);
  return { clients, services, bookings, series };
}

// ============ CLIENTS ============

export interface ClientFields {
  name: string;
  phone?: string | null;
  shape?: string | null;
  shade?: string | null;
  birthday?: string | null; // 'MM-DD'
  prior_visits?: PriorVisit[];
}

export async function addClient(f: ClientFields): Promise<Client> {
  const row = {
    name: f.name.trim(), phone: f.phone || null, shape: f.shape || null,
    shade: f.shade || null, birthday: f.birthday || null, prior_visits: f.prior_visits ?? [],
  };
  const { data, error } = await supabase.from("clients").insert(row).select().single();
  if (error) fail(error);
  return data as Client;
}

export async function updateClient(id: string, fields: Partial<ClientFields>): Promise<void> {
  const { error } = await supabase.from("clients").update(fields).eq("id", id);
  if (error) fail(error);
}

// ============ SERVICES ============

export async function addService(f: { category: string; name: string; price: number; duration_minutes: number }): Promise<Service> {
  const { data, error } = await supabase.from("services").insert({ ...f, active: true }).select().single();
  if (error) fail(error);
  return data as Service;
}

export async function updateService(id: string, fields: Partial<Omit<Service, "id" | "created_at">>): Promise<void> {
  const { error } = await supabase.from("services").update(fields).eq("id", id);
  if (error) fail(error);
}

// ============ BOOKINGS ============

/** A service line as picked in the booking form, before it's snapshotted. */
export interface PickedService { service_id: string | null; service_name: string; price: number }

export interface BookingFields {
  client_id: string;
  date: string;
  time: string;
  duration_minutes: number;
  status: BookingStatus;
  notes?: string | null;
  discount?: number;
  tip?: number;
  payment_method?: PaymentMethod | null;
  series_id?: string | null;
}

async function writeLines(bookingId: string, services: PickedService[]) {
  if (!services.length) return;
  const rows = services.map((s) => ({
    booking_id: bookingId, service_id: s.service_id, service_name: s.service_name, price_at_time: s.price,
  }));
  const { error } = await supabase.from("booking_services").insert(rows);
  if (error) fail(error);
}

export async function addBooking(f: BookingFields, services: PickedService[]): Promise<string> {
  const row = {
    client_id: f.client_id, series_id: f.series_id ?? null, date: f.date, time: f.time,
    duration_minutes: f.duration_minutes, status: f.status, discount: f.discount ?? 0, tip: f.tip ?? 0,
    notes: f.notes || null, payment_method: f.payment_method ?? null,
  };
  const { data, error } = await supabase.from("bookings").insert(row).select("id").single();
  if (error) fail(error);
  const id = (data as { id: string }).id;
  await writeLines(id, services);
  return id;
}

/** Pass `services` to replace the booking's lines; leave it out to keep them. */
export async function updateBooking(id: string, fields: Partial<BookingFields>, services?: PickedService[]): Promise<void> {
  if (Object.keys(fields).length) {
    const { error } = await supabase.from("bookings").update(fields).eq("id", id);
    if (error) fail(error);
  }
  if (services) {
    const { error } = await supabase.from("booking_services").delete().eq("booking_id", id);
    if (error) fail(error);
    await writeLines(id, services);
  }
}

export async function deleteBooking(id: string): Promise<void> {
  const { error } = await supabase.from("bookings").delete().eq("id", id);
  if (error) fail(error);
}

// ============ RECURRING SERIES ============

export interface SeriesFields {
  client_id: string;
  start_date: string;
  time: string;
  duration_minutes: number;
  freq_days: number;
  end_type: RecurringEndType;
  end_count: number | null;
  end_date: string | null;
  status: BookingStatus;
  notes: string | null;
}

export async function createSeries(f: SeriesFields, services: PickedService[]): Promise<string[]> {
  const { data, error } = await supabase.from("recurring_series").insert({
    client_id: f.client_id, freq_days: f.freq_days, start_date: f.start_date, end_type: f.end_type,
    end_count: f.end_count, end_date: f.end_date, status: f.status, notes: f.notes || null, active: true,
  }).select("id").single();
  if (error) fail(error);
  const seriesId = (data as { id: string }).id;
  const dates = computeRecurringDates(f.start_date, f.freq_days, f.end_type, f.end_count, f.end_date);
  for (const d of dates) {
    await addBooking({ client_id: f.client_id, date: d, time: f.time, duration_minutes: f.duration_minutes,
      status: f.status, notes: f.notes, series_id: seriesId }, services);
  }
  return dates;
}

/** Remove the series' upcoming visits and retire it. Past visits stay on record. */
export async function cancelSeries(seriesId: string): Promise<void> {
  const { error } = await supabase.from("bookings").delete().eq("series_id", seriesId).gte("date", todaySa());
  if (error) fail(error);
  const r = await supabase.from("recurring_series").update({ active: false }).eq("id", seriesId);
  if (r.error) fail(r.error);
}

// ============ CLIENT PHOTOS ============

export const PHOTO_BUCKET = "client-photos";

/** One visit's photos. */
export async function getBookingPhotos(bookingId: string): Promise<ClientPhoto[]> {
  return fetchAll<ClientPhoto>(() => supabase.from("client_photos").select("*")
    .eq("booking_id", bookingId).order("created_at", { ascending: false }).order("id"));
}

export async function getClientPhotos(clientId: string): Promise<ClientPhoto[]> {
  return fetchAll<ClientPhoto>(() => supabase.from("client_photos").select("*")
    .eq("client_id", clientId).order("created_at", { ascending: false }).order("id"));
}

/** Every client's photos, newest first: the Lookbook. */
export async function getAllPhotos(): Promise<ClientPhoto[]> {
  return fetchAll<ClientPhoto>(() => supabase.from("client_photos").select("*")
    .order("created_at", { ascending: false }).order("id"));
}

/** Where a photo's small copy lives, beside the full one. */
export function thumbPathOf(path: string): string {
  return path.replace(/\.jpg$/i, "") + ".t.jpg";
}

// Signed URLs are reused until close to expiry. A fresh URL is a new address
// to the browser, so re-signing on every screen would re-download every photo
// over her mobile data each time.
const signed = new Map<string, { url: string; until: number }>();
const SIGN_SECONDS = 3600;

async function sign(paths: string[]): Promise<Record<string, string>> {
  const now = Date.now(), out: Record<string, string> = {}, need: string[] = [];
  for (const p of paths) {
    const hit = signed.get(p);
    if (hit && hit.until > now + 5 * 60_000) out[p] = hit.url;
    else need.push(p);
  }
  if (need.length) {
    const { data, error } = await supabase.storage.from(PHOTO_BUCKET).createSignedUrls(need, SIGN_SECONDS);
    if (!error) for (const r of data ?? []) {
      if (r.path && r.signedUrl && !r.error) {
        out[r.path] = r.signedUrl;
        signed.set(r.path, { url: r.signedUrl, until: now + SIGN_SECONDS * 1000 });
      }
    }
  }
  return out;
}

/**
 * Short-lived signed URLs: these are photographs of identifiable people, so the
 * bucket is private and a copied link dies within the hour. Full size, for
 * viewing one photo or sharing it.
 */
export async function photoUrls(paths: string[]): Promise<Record<string, string>> {
  if (!paths.length) return {};
  return sign([...new Set(paths)]);
}

/**
 * Grid-sized copies, keyed by the full photo's path: about a tenth of the
 * download. Photos saved before thumbnails existed fall back to full size.
 */
export async function thumbUrls(paths: string[]): Promise<Record<string, string>> {
  if (!paths.length) return {};
  const uniq = [...new Set(paths)];
  const small = await sign(uniq.map(thumbPathOf));
  const out: Record<string, string> = {}, missing: string[] = [];
  for (const p of uniq) { const u = small[thumbPathOf(p)]; if (u) out[p] = u; else missing.push(p); }
  return missing.length ? { ...out, ...(await sign(missing)) } : out;
}

/**
 * Object first, then the row: a half-failure leaves an unreferenced file, never
 * a row pointing at a photo that doesn't exist (a broken thumbnail she can't clear).
 */
export async function addClientPhoto(
  clientId: string, image: Blob, caption: string | null, bookingId: string | null, thumb?: Blob | null,
): Promise<void> {
  const path = `${clientId}/${crypto.randomUUID()}.jpg`;
  const up = await supabase.storage.from(PHOTO_BUCKET).upload(path, image, { contentType: "image/jpeg", upsert: false });
  if (up.error) fail(up.error);
  // The small copy is a nicety: if it fails, grids fall back to the full photo.
  if (thumb) await supabase.storage.from(PHOTO_BUCKET).upload(thumbPathOf(path), thumb, { contentType: "image/jpeg", upsert: false });
  const { error } = await supabase.from("client_photos").insert({
    client_id: clientId, booking_id: bookingId, storage_path: path, caption: caption || null,
  });
  if (error) fail(error);
}

/** Object first, then the row, so a half-failure leaves a visible row she can retry. */
export async function deleteClientPhoto(photo: ClientPhoto): Promise<void> {
  await supabase.storage.from(PHOTO_BUCKET).remove([photo.storage_path, thumbPathOf(photo.storage_path)]);
  const { error } = await supabase.from("client_photos").delete().eq("id", photo.id);
  if (error) fail(error);
}
