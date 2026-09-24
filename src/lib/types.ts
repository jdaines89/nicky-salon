/**
 * Row shapes for the Supabase tables (see the Streamlit app's
 * supabase_schema.sql, photos_schema.sql and payment_method_schema.sql).
 *
 * Conventions: dates are 'YYYY-MM-DD' strings, times 'HH:MM:SS' strings
 * (PostgREST's `time` output; the pure logic also accepts 'HH:MM'), timestamps
 * ISO strings, and numeric columns arrive from PostgREST as numbers.
 */

export type ISODate = string; // 'YYYY-MM-DD'
export type ISOTime = string; // 'HH:MM:SS' (or 'HH:MM')

export type BookingStatus = "confirmed" | "pending" | "cancelled" | "no-show";
export type PaymentMethod = "cash" | "card" | "transfer";
export type RecurringEndType = "count" | "until";

/**
 * One pre-system visit in `clients.prior_visits` — a one-time backfill (or an
 * estimate from estimatedPriorVisits()). Never summed into any money figure.
 */
export interface PriorVisit {
  date: ISODate;
  service: string;
  price: string;
}

export interface Client {
  id: string;
  name: string;
  phone: string | null;
  shape: string | null; // preferred nail shape
  shade: string | null; // preferred shade
  birthday: string | null; // 'MM-DD', no year
  prior_visits: PriorVisit[] | null;
  created_at: string | null;
}

export interface Service {
  id: string;
  category: string;
  name: string;
  price: number;
  duration_minutes: number;
  active: boolean | null; // soft-delete flag
  created_at: string | null;
}

export interface RecurringSeries {
  id: string;
  client_id: string | null;
  freq_days: number;
  start_date: ISODate;
  end_type: RecurringEndType;
  end_count: number | null;
  end_date: ISODate | null;
  status: BookingStatus;
  notes: string | null;
  active: boolean | null;
  created_at: string | null;
}

/** Snapshotted at booking time: editing a service never rewrites past revenue. */
export interface BookingService {
  id: string;
  booking_id: string;
  service_id: string | null;
  service_name: string;
  price_at_time: number;
}

export interface Booking {
  id: string;
  client_id: string | null;
  series_id: string | null; // null = one-off booking
  date: ISODate;
  time: ISOTime;
  duration_minutes: number;
  status: BookingStatus;
  discount: number; // reduces recognised revenue
  tip: number; // gratuity, never counted as revenue
  notes: string | null;
  payment_method: PaymentMethod | null; // null = never recorded
  created_at: string | null;
}

/** What `select("*, booking_services(*)")` returns. */
export interface BookingWithServices extends Booking {
  booking_services: BookingService[];
}

export interface ClientPhoto {
  id: string;
  client_id: string;
  booking_id: string | null;
  storage_path: string;
  caption: string | null;
  created_at: string | null;
}

// ---------------------------------------------------------------------------
// Structural subsets the pure logic actually needs. Real rows satisfy these;
// so do the lighter fixtures the tests build.
// ---------------------------------------------------------------------------

export type ServiceLine = Pick<BookingService, "service_name" | "price_at_time"> &
  Partial<Pick<BookingService, "service_id">>;

export interface BookingLike {
  id: string;
  client_id: string | null;
  date: ISODate;
  time: ISOTime;
  status: BookingStatus | string;
  duration_minutes?: number | null;
  discount?: number | null;
  tip?: number | null;
  payment_method?: PaymentMethod | string | null;
  booking_services?: ServiceLine[] | null;
}

export interface ClientLike {
  id: string;
  name: string;
  prior_visits?: PriorVisit[] | null;
}

export interface ServiceLike {
  name: string;
  category?: string | null;
  price?: number | null;
  duration_minutes?: number | null;
}
