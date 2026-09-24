"use client";

import { Camera, Image as ImageIcon, MoreHorizontal } from "lucide-react";
/**
 * Nail photos on a client profile: "what did we have last time?" is the
 * question she is asked most at the chair, and for nail work a shade name three
 * weeks later means nothing where a photograph means everything.
 *
 * Ported from the Streamlit app's lib/photos.py. The image rules carry over:
 *  - Nothing is stored as it arrives. prepareImage() re-encodes every upload to
 *    a ~1400px JPEG: 3-5MB phone photos become ~200KB, which is what keeps the
 *    free tier's 1GB from filling in a few months.
 *  - Re-encoding through a canvas drops ALL metadata, EXIF GPS included. Phones
 *    write the salon's (or a client's home's) coordinates into every photo.
 *    Orientation is applied first (imageOrientation: "from-image"), or every
 *    portrait photo would land sideways once the tag is gone.
 *  - The browser's decoder is the validator: anything it can't open as an image
 *    is refused, whatever the file extension claimed.
 *  - The bucket is private; thumbnails come from short-lived signed URLs.
 *  - Delete sits behind a ⋯ with a confirm: one mis-tap with damp fingers would
 *    destroy a photo permanently, and there is no undo.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { Sheet } from "@/components/ui";
import { addClientPhoto, deleteClientPhoto, getBookingPhotos, getClientPhotos, photoUrls, thumbUrls } from "@/lib/db";
import { bookingTitle, fmtDayMonShort, fmtDayMonth } from "@/lib/salon";
import type { BookingWithServices, ClientPhoto } from "@/lib/types";

// Bigger than any phone photo, small enough that a mis-picked video is refused
// before it is read into memory on a weak LTE connection.
export const MAX_UPLOAD_BYTES = 15 * 1024 * 1024;
// Comfortably more than the widest phone screen she will view it on; q0.82 is
// where nail detail still reads and the file stops shrinking usefully.
export const MAX_EDGE_PX = 1400;
export const JPEG_QUALITY = 0.82;
// The grid copy: sharp in a three-across grid on a 3x phone screen, ~30 KB.
export const THUMB_EDGE_PX = 480;
export const MAX_CAPTION = 120;
const SHOWN = 9;

/** Something about this file means it must not be stored. The message is for Nicky's eyes. */
export class PhotoError extends Error {}

/** '1.4 MB' / '212 KB' — for telling her what a photo actually cost. */
export function humanSize(n: number): string {
  if (n < 1024) return `${Math.trunc(n)} B`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

/** A caption is a note to herself: collapse whitespace, cap the length. */
export function cleanCaption(text: string | null | undefined): string {
  return (text || "").replace(/\s+/g, " ").trim().slice(0, MAX_CAPTION);
}

/** Decode with orientation applied. Falls back to an <img>, which also honours EXIF orientation. */
async function decode(file: Blob): Promise<{ source: CanvasImageSource; width: number; height: number; done: () => void }> {
  if (typeof createImageBitmap === "function") {
    try {
      const bmp = await createImageBitmap(file, { imageOrientation: "from-image" });
      return { source: bmp, width: bmp.width, height: bmp.height, done: () => bmp.close() };
    } catch {
      // Older Safari rejects the options bag or the format; try the <img> path.
    }
  }
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    if (!img.naturalWidth || !img.naturalHeight) throw new Error("empty image");
    return { source: img, width: img.naturalWidth, height: img.naturalHeight, done: () => URL.revokeObjectURL(url) };
  } catch {
    URL.revokeObjectURL(url);
    throw new PhotoError("That doesn't look like a photo. Pick a picture from your camera roll, or take a new one.");
  }
}

/**
 * Validate, straighten, downscale and re-encode. Returns the JPEG and a short
 * human note ("4.1 MB → 198 KB · resized to 1400×1050") shown once after upload.
 * Throws PhotoError with a message meant for her.
 */
export async function prepareImage(file: Blob): Promise<{ blob: Blob; thumb: Blob | null; note: string }> {
  if (!file || !file.size) throw new PhotoError("That file was empty. Try taking the photo again.");
  if (file.size > MAX_UPLOAD_BYTES) {
    throw new PhotoError(`That file is ${humanSize(file.size)} — too big to upload. A photo from your camera should be well under ${humanSize(MAX_UPLOAD_BYTES)}.`);
  }
  const img = await decode(file);
  try {
    const scale = Math.min(1, MAX_EDGE_PX / Math.max(img.width, img.height));
    const w = Math.max(1, Math.round(img.width * scale));
    const h = Math.max(1, Math.round(img.height * scale));
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new PhotoError("This device couldn't process the photo. Try again.");
    // Flatten transparency onto white — JPEG has no alpha, and a PNG screenshot
    // would otherwise come out with a black background.
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, w, h);
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(img.source, 0, 0, w, h);
    // A canvas re-encode carries none of the original's metadata: no GPS, no device, no timestamp.
    const blob = await new Promise<Blob | null>((res) => canvas.toBlob(res, "image/jpeg", JPEG_QUALITY));
    if (!blob) throw new PhotoError("This device couldn't process the photo. Try again.");
    // A small copy for grids, drawn from the already-straightened canvas.
    const ts = Math.min(1, THUMB_EDGE_PX / Math.max(w, h));
    const small = document.createElement("canvas");
    small.width = Math.max(1, Math.round(w * ts));
    small.height = Math.max(1, Math.round(h * ts));
    const sctx = small.getContext("2d");
    let thumb: Blob | null = null;
    if (sctx) {
      sctx.imageSmoothingQuality = "high";
      sctx.drawImage(canvas, 0, 0, small.width, small.height);
      thumb = await new Promise<Blob | null>((res) => small.toBlob(res, "image/jpeg", 0.8));
    }
    let note = `${humanSize(file.size)} → ${humanSize(blob.size)}`;
    if (w !== img.width || h !== img.height) note += ` · resized to ${w}×${h}`;
    return { blob, thumb, note };
  } finally {
    img.done();
  }
}

/** Under a thumbnail: the date, then her own caption, else what she did that visit. */
function captionLine(p: ClientPhoto, serviceLabel: string | null, visitDate?: string): string {
  const when = (visitDate || p.created_at || "").slice(0, 10);
  const bits = when ? [fmtDayMonth(when)] : [];
  if (p.caption) bits.push(p.caption);
  else if (serviceLabel) bits.push(serviceLabel);
  return bits.join(" · ");
}

/** Supabase's "relation does not exist" / schema-cache miss: photos_schema.sql not applied yet. */
function isMissingTable(msg: string): boolean {
  return /client_photos|does not exist|schema cache|42P01|PGRST205/i.test(msg);
}

export function ClientPhotos({ clientId, bookings, today, say }: {
  clientId: string;
  bookings: BookingWithServices[];
  today: string;
  say: (msg: string) => void;
}) {
  const [photos, setPhotos] = useState<ClientPhoto[] | null>(null);
  const [urls, setUrls] = useState<Record<string, string>>({});
  const [state, setState] = useState<"loading" | "ready" | "missing" | "error">("loading");
  const [loadError, setLoadError] = useState("");
  const [adding, setAdding] = useState(false);
  const [menuFor, setMenuFor] = useState<ClientPhoto | null>(null);
  const [viewing, setViewing] = useState<ClientPhoto | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const list = await getClientPhotos(clientId);
      setPhotos(list);
      setUrls(await thumbUrls(list.slice(0, SHOWN).map((p) => p.storage_path)));
      setState("ready");
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      // Never hard-fail: a salon that hasn't set photos up must still get a Clients page.
      if (isMissingTable(msg)) setState("missing");
      else { setLoadError(msg); setState("error"); }
    }
  }, [clientId]);

  useEffect(() => {
    setState("loading");
    setPhotos(null);
    setUrls({});
    load();
  }, [load]);

  const byId = new Map(bookings.map((b) => [b.id, b]));

  async function remove(p: ClientPhoto) {
    setBusy(true);
    try {
      await deleteClientPhoto(p);
      await load();
      setMenuFor(null);
      say("Photo deleted.");
    } catch (e) {
      say(`Couldn't delete that photo — ${e instanceof Error ? e.message : e}`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card">
      <div className="row">
        <h2 className="grow" style={{ margin: 0 }}>Nail photos</h2>
        {state === "ready" && <button className="gold" onClick={() => setAdding(true)}><Camera size={17} />Add photo</button>}
      </div>

      {state === "loading" && <p className="small muted">Loading photos…</p>}
      {state === "error" && (
        <p className="small muted">Couldn&apos;t load photos — {loadError}. <button className="linkish" onClick={load}>Try again</button></p>
      )}
      {state === "missing" && (
        <div className="notice" style={{ marginTop: 10, marginBottom: 0 }}>
          <strong>Photos aren&apos;t set up yet.</strong> In your Supabase dashboard, once (about two minutes):
          <ol style={{ margin: "6px 0 0", paddingLeft: 20 }}>
            <li><b>Storage → New bucket</b>, name it <code>client-photos</code>, and leave <b>Public switched OFF</b> — these are photos of real people, so they&apos;re served through short-lived private links.</li>
            <li><b>SQL Editor → New query</b>, paste the contents of <code>photos_schema.sql</code>, and Run.</li>
          </ol>
          Then refresh and the camera appears here.
        </div>
      )}

      {state === "ready" && photos && !photos.length && (
        <p className="small muted" style={{ marginTop: 8 }}>
          No photos yet — add one after her next set and it&apos;ll be here the next time she asks for the same again.
        </p>
      )}

      {state === "ready" && photos && photos.length > 0 && (
        <>
          {/* Three across even on a phone: the largest a nail photo can be and still show several visits at a glance. */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: 8, marginTop: 10 }}>
            {photos.slice(0, SHOWN).map((p) => {
              const bk = p.booking_id ? byId.get(p.booking_id) : undefined;
              const url = urls[p.storage_path];
              return (
                <div key={p.id} style={{ minWidth: 0 }}>
                  {url ? (
                    <button type="button" onClick={() => setViewing(p)} aria-label="View photo larger"
                      style={{ padding: 0, border: 0, background: "var(--teal-soft)", width: "100%", aspectRatio: "1 / 1", overflow: "hidden", borderRadius: 10, display: "block" }}>
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={url} alt="" loading="lazy" style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }} />
                    </button>
                  ) : (
                    <div className="small muted" style={{ aspectRatio: "1 / 1", display: "grid", placeItems: "center", background: "var(--teal-soft)", borderRadius: 10 }}>couldn&apos;t load</div>
                  )}
                  <div style={{ paddingTop: 6, lineHeight: 1.3 }}>
                    <div className="row" style={{ flexWrap: "nowrap", gap: 0, alignItems: "center" }}>
                      <b className="grow" style={{ fontSize: 14, whiteSpace: "nowrap" }}>{bk ? fmtDayMonShort(bk.date) : p.created_at ? fmtDayMonShort(p.created_at.slice(0, 10)) : "Photo"}</b>
                      <button className="ghost" aria-label="Photo options" onClick={() => setMenuFor(p)}
                        style={{ minHeight: 32, width: 36, padding: 0, border: 0, background: "none", color: "var(--ink-soft)" }}><MoreHorizontal size={18} /></button>
                    </div>
                    <div className="small muted" style={{ display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden" }}>
                      {p.caption || (bk ? bookingTitle(bk) : "")}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
          {photos.length > SHOWN && <p className="small muted">Showing the {SHOWN} most recent of {photos.length}.</p>}
        </>
      )}

      {adding && (
        <AddPhotoSheet clientId={clientId} bookings={bookings} today={today}
          onClose={() => setAdding(false)}
          onSaved={async (note) => { setAdding(false); await load(); say(`Photo saved · ${note}`); }} />
      )}

      {menuFor && (
        <Sheet title="Delete this photo?" onClose={() => setMenuFor(null)}>
          <p className="sub">It can&apos;t be undone.</p>
          <div className="row end">
            <button className="ghost" onClick={() => setMenuFor(null)} disabled={busy}>Keep it</button>
            <button className="danger" onClick={() => remove(menuFor)} disabled={busy}>{busy ? "Deleting…" : "Delete photo"}</button>
          </div>
        </Sheet>
      )}

      {viewing && urls[viewing.storage_path] && (
        <Sheet title="Photo" onClose={() => setViewing(null)}>
          <FullPhoto path={viewing.storage_path} thumb={urls[viewing.storage_path]} />
          <p className="small muted">
            {captionLine(viewing, viewing.booking_id && byId.get(viewing.booking_id) ? bookingTitle(byId.get(viewing.booking_id)!) : null, viewing.booking_id ? byId.get(viewing.booking_id)?.date : undefined)}
          </p>
        </Sheet>
      )}
    </div>
  );
}

export function AddPhotoSheet({ clientId, bookingId, bookings, today, onClose, onSaved }: {
  clientId: string;
  /** The visit this photo is of. Without it, her most recent completed visit. */
  bookingId?: string;
  bookings: BookingWithServices[];
  today: string;
  onClose: () => void;
  onSaved: (note: string) => void | Promise<void>;
}) {
  const cameraRef = useRef<HTMLInputElement>(null);
  const pickRef = useRef<HTMLInputElement>(null);
  const [prepared, setPrepared] = useState<{ blob: Blob; thumb: Blob | null; note: string } | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [caption, setCaption] = useState("");
  const [err, setErr] = useState("");
  const [working, setWorking] = useState(false);

  useEffect(() => () => { if (preview) URL.revokeObjectURL(preview); }, [preview]);

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    e.target.value = ""; // picking the same file again should still fire
    if (!f) return;
    setErr("");
    setWorking(true);
    try {
      const out = await prepareImage(f);
      setPrepared(out);
      setPreview(URL.createObjectURL(out.blob));
    } catch (x) {
      setPrepared(null);
      setPreview(null);
      setErr(x instanceof PhotoError ? x.message : "That doesn't look like a photo. Pick a picture from your camera roll, or take a new one.");
    } finally {
      setWorking(false);
    }
  }

  async function save() {
    if (!prepared) return;
    setWorking(true);
    setErr("");
    // Tag it to the visit it belongs to, so the photo carries what was actually done that day.
    let last: { id: string } | null = bookingId ? { id: bookingId } : null;
    if (!bookingId) for (const b of bookings) {
      if (b.client_id !== clientId || b.date > today || b.status !== "confirmed") continue;
      const l = last as BookingWithServices | null;
      if (!l || b.date + b.time > l.date + l.time) last = b;
    }
    try {
      await addClientPhoto(clientId, prepared.blob, cleanCaption(caption) || null, last?.id ?? null, prepared.thumb);
      await onSaved(prepared.note);
    } catch (x) {
      setErr(`Couldn't save that photo — ${x instanceof Error ? x.message : x}`);
      setWorking(false);
    }
  }

  return (
    <Sheet title="Add a nail photo" onClose={onClose}>
      <div className="stack">
        <p className="small muted" style={{ margin: 0 }}>Take one now, or pick a picture you already took.</p>
        <div className="fields2">
          <button type="button" onClick={() => cameraRef.current?.click()} disabled={working}><Camera size={17} />Camera</button>
          <button type="button" className="ghost" onClick={() => pickRef.current?.click()} disabled={working}><ImageIcon size={17} />Choose photo</button>
        </div>
        <input ref={cameraRef} type="file" accept="image/*" capture="environment" hidden onChange={onFile} />
        <input ref={pickRef} type="file" accept="image/*" hidden onChange={onFile} />
        {working && !prepared && <p className="small muted" style={{ margin: 0 }}>Shrinking the photo…</p>}
        {preview && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={preview} alt="Preview" style={{ width: "100%", maxHeight: 320, objectFit: "contain", borderRadius: 12, background: "var(--teal-soft)" }} />
        )}
        {prepared && <p className="small muted" style={{ margin: 0 }}>{prepared.note} · location data removed</p>}
        <label className="field">Note (optional)
          <input value={caption} maxLength={MAX_CAPTION} onChange={(e) => setCaption(e.target.value)}
            placeholder="e.g. almond, deep red, glitter accent" />
        </label>
        {err && <div className="notice danger" style={{ margin: 0 }}>{err}</div>}
        <div className="row end">
          <button className="ghost" onClick={onClose} disabled={working}>Cancel</button>
          <button onClick={save} disabled={!prepared || working}>{working && prepared ? "Saving…" : "Save photo"}</button>
        </div>
      </div>
    </Sheet>
  );
}

/**
 * The photos of one visit, inside that booking: the natural place to add one is
 * the appointment she has just finished, and it is tagged to exactly that visit.
 * Stays quiet (renders nothing) if photos are not set up.
 */
export function BookingPhotos({ clientId, bookingId, bookings, today, say }: {
  clientId: string;
  bookingId: string;
  bookings: BookingWithServices[];
  today: string;
  say?: (msg: string) => void;
}) {
  const [photos, setPhotos] = useState<ClientPhoto[] | null>(null);
  const [urls, setUrls] = useState<Record<string, string>>({});
  const [adding, setAdding] = useState(false);
  const [viewing, setViewing] = useState<ClientPhoto | null>(null);
  const [note, setNote] = useState("");

  const load = useCallback(async () => {
    try {
      const list = await getBookingPhotos(bookingId);
      setPhotos(list);
      setUrls(await thumbUrls(list.map((p) => p.storage_path)));
    } catch {
      setPhotos(null); // not set up, or offline: the booking still works
    }
  }, [clientId, bookingId]);
  useEffect(() => { load(); }, [load]);

  if (photos === null) return null;
  return (
    <div className="bp">
      <div className="bp-row">
        {photos.map((p) => urls[p.storage_path] && (
          <button type="button" key={p.id} className="bp-th" onClick={() => setViewing(p)} aria-label="View photo larger">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={urls[p.storage_path]} alt="" />
          </button>
        ))}
        <button type="button" className="bp-add" onClick={() => setAdding(true)}>
          <Camera size={22} strokeWidth={1.8} />{photos.length ? "Add" : "Add photo"}
        </button>
      </div>
      {!photos.length && <p className="small muted" style={{ margin: "8px 0 0" }}>Snap her nails before she leaves, so next time you both know exactly what she had.</p>}
      {note && <p className="small muted" style={{ margin: "8px 0 0" }}>{note}</p>}
      {adding && (
        <AddPhotoSheet clientId={clientId} bookingId={bookingId} bookings={bookings} today={today}
          onClose={() => setAdding(false)}
          onSaved={async (n) => { setAdding(false); await load(); setNote(`Photo saved · ${n}`); say?.("Photo saved."); }} />
      )}
      {viewing && urls[viewing.storage_path] && (
        <Sheet title="Photo" onClose={() => setViewing(null)}>
          <FullPhoto path={viewing.storage_path} thumb={urls[viewing.storage_path]} />
          {viewing.caption && <p className="small muted">{viewing.caption}</p>}
        </Sheet>
      )}
    </div>
  );
}

export const BOOKING_PHOTOS_CSS = `
.bp-row { display: flex; gap: 10px; overflow-x: auto; padding-bottom: 2px; scrollbar-width: none; }
.bp-row::-webkit-scrollbar { display: none; }
button.bp-th { flex: none; width: 84px; height: 84px; padding: 0; border: 0; border-radius: 16px; overflow: hidden; background: var(--teal-soft); }
button.bp-th img { width: 100%; height: 100%; object-fit: cover; display: block; }
button.bp-add { flex: none; width: 84px; height: 84px; padding: 6px; border-radius: 16px; border: 1.5px dashed var(--gold); background: var(--gold-soft);
  color: var(--gold-ink); flex-direction: column; gap: 4px; font-size: 13px; font-weight: 700; line-height: 1.15; text-align: center; }
`;

/** One photo at full size: the grid copy shows at once, the sharp one swaps in. */
export function FullPhoto({ path, thumb, className, style }: { path: string; thumb?: string; className?: string; style?: React.CSSProperties }) {
  const [full, setFull] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    photoUrls([path]).then((u) => { if (live && u[path]) setFull(u[path]); });
    return () => { live = false; };
  }, [path]);
  const src = full ?? thumb;
  if (!src) return null;
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={src} alt="" className={className} style={className ? style : { width: "100%", borderRadius: 12, display: "block", ...style }} />;
}
