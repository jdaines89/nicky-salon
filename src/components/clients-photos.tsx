"use client";

import { Camera, Image as ImageIcon } from "lucide-react";
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
import { addClientPhoto, deleteClientPhoto, getClientPhotos, photoUrls } from "@/lib/db";
import { bookingTitle, fmtDayMonth } from "@/lib/salon";
import type { BookingWithServices, ClientPhoto } from "@/lib/types";

// Bigger than any phone photo, small enough that a mis-picked video is refused
// before it is read into memory on a weak LTE connection.
export const MAX_UPLOAD_BYTES = 15 * 1024 * 1024;
// Comfortably more than the widest phone screen she will view it on; q0.82 is
// where nail detail still reads and the file stops shrinking usefully.
export const MAX_EDGE_PX = 1400;
export const JPEG_QUALITY = 0.82;
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
export async function prepareImage(file: Blob): Promise<{ blob: Blob; note: string }> {
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
    let note = `${humanSize(file.size)} → ${humanSize(blob.size)}`;
    if (w !== img.width || h !== img.height) note += ` · resized to ${w}×${h}`;
    return { blob, note };
  } finally {
    img.done();
  }
}

/** Under a thumbnail: the date, then her own caption, else what she did that visit. */
function captionLine(p: ClientPhoto, serviceLabel: string | null): string {
  const when = (p.created_at || "").slice(0, 10);
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
      setUrls(await photoUrls(list.slice(0, SHOWN).map((p) => p.storage_path)));
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
                  <div className="row" style={{ flexWrap: "nowrap", gap: 2, alignItems: "flex-start" }}>
                    <div className="grow small muted" style={{ lineHeight: 1.3, paddingTop: 4, overflowWrap: "anywhere" }}>
                      {captionLine(p, bk ? bookingTitle(bk) : null)}
                    </div>
                    <button className="ghost" aria-label="Photo options" onClick={() => setMenuFor(p)}
                      style={{ minHeight: 36, padding: "2px 8px", border: 0, background: "none", color: "var(--ink-soft)" }}>⋯</button>
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
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={urls[viewing.storage_path]} alt="" style={{ width: "100%", borderRadius: 12, display: "block" }} />
          <p className="small muted">
            {captionLine(viewing, viewing.booking_id && byId.get(viewing.booking_id) ? bookingTitle(byId.get(viewing.booking_id)!) : null)}
          </p>
        </Sheet>
      )}
    </div>
  );
}

function AddPhotoSheet({ clientId, bookings, today, onClose, onSaved }: {
  clientId: string;
  bookings: BookingWithServices[];
  today: string;
  onClose: () => void;
  onSaved: (note: string) => void | Promise<void>;
}) {
  const cameraRef = useRef<HTMLInputElement>(null);
  const pickRef = useRef<HTMLInputElement>(null);
  const [prepared, setPrepared] = useState<{ blob: Blob; note: string } | null>(null);
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
    let last: BookingWithServices | null = null;
    for (const b of bookings) {
      if (b.client_id !== clientId || b.date > today || b.status !== "confirmed") continue;
      if (!last || b.date + b.time > last.date + last.time) last = b;
    }
    try {
      await addClientPhoto(clientId, prepared.blob, cleanCaption(caption) || null, last?.id ?? null);
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
