import { createClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.NEXT_PUBLIC_SUPABASE_KEY;

/**
 * How this visit arrived: "invite" from an invite email, "recovery" from a
 * password reset. Read before the client consumes the link, because the
 * member then has to choose a password before anything else.
 */
export const arrivedVia: string | null =
  typeof window === "undefined" ? null : new URLSearchParams(window.location.hash.slice(1)).get("type");

export const configured = Boolean(url && key);

/** The one browser client. Picks up the session from an invite link on load. */
export const supabase = createClient(url || "http://localhost:54321", key || "missing", {
  auth: { persistSession: true, detectSessionInUrl: true, flowType: "implicit" },
});
