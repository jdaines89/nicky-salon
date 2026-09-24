"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { ChevronRight, ImagePlus, Share2, Sparkles } from "lucide-react";
import { useSalon } from "@/components/data";
import { Empty, Sheet, useToast } from "@/components/ui";
import { getAllPhotos, photoUrls } from "@/lib/db";
import { bookingTitle, firstName, fmtDayMonth } from "@/lib/salon";
import type { ClientPhoto } from "@/lib/types";

const PAGE = 36;

/**
 * Her work, all in one place: every nail photo from every client, newest
 * first. The photos already live on each client's profile; this is the same
 * set seen as a portfolio, the thing a creative person actually wants to
 * scroll through, and to share a favourite from.
 */
export default function Lookbook() {
  const { bookings, clientById } = useSalon();
  const [photos, setPhotos] = useState<ClientPhoto[] | null>(null);
  const [urls, setUrls] = useState<Record<string, string>>({});
  const [state, setState] = useState<"loading" | "ready" | "missing" | "error">("loading");
  const [shown, setShown] = useState(PAGE);
  const [filter, setFilter] = useState<string | null>(null);
  const [viewing, setViewing] = useState<ClientPhoto | null>(null);
  const [toast, say] = useToast();
  const bookingById = useMemo(() => new Map(bookings.map((b) => [b.id, b])), [bookings]);

  useEffect(() => {
    getAllPhotos().then((list) => { setPhotos(list); setState("ready"); }).catch((e) => {
      const msg = e instanceof Error ? e.message : String(e);
      // Never hard-fail: photos are optional infrastructure.
      setState(/client_photos|does not exist|schema cache|42P01|PGRST205/i.test(msg) ? "missing" : "error");
    });
  }, []);

  const serviceOf = (p: ClientPhoto) => {
    const b = p.booking_id ? bookingById.get(p.booking_id) : undefined;
    return b ? bookingTitle(b) : null;
  };
  const services = useMemo(() => {
    const counts = new Map<string, number>();
    for (const p of photos ?? []) { const s = serviceOf(p); if (s) counts.set(s, (counts.get(s) ?? 0) + 1); }
    return [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6).map(([s]) => s);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [photos, bookingById]);
  const list = (photos ?? []).filter((p) => !filter || serviceOf(p) === filter);
  const visible = list.slice(0, shown);

  useEffect(() => {
    const need = visible.map((p) => p.storage_path).filter((path) => !urls[path]);
    if (!need.length) return;
    photoUrls(need).then((u) => setUrls((prev) => ({ ...prev, ...u })));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible.map((p) => p.id).join(",")]);

  async function share(p: ClientPhoto) {
    const url = urls[p.storage_path];
    if (!url) return;
    try {
      const blob = await (await fetch(url)).blob();
      const file = new File([blob], "nicky-nails.jpg", { type: "image/jpeg" });
      if (navigator.canShare?.({ files: [file] })) {
        await navigator.share({ files: [file] });
        return;
      }
    } catch (e) {
      if (e instanceof DOMException && e.name === "AbortError") return;
    }
    window.open(url, "_blank", "noopener");
    say("Opened the photo. Press and hold it to save or share.");
  }

  const client = viewing ? clientById.get(viewing.client_id) : undefined;
  return (
    <>
      <style>{LOOKBOOK_CSS}</style>
      <div className="eyebrow" style={{ marginTop: 6 }}>Your work</div>
      <h1>Lookbook</h1>
      <p className="sub">{photos?.length ? `${photos.length} sets, newest first.` : "Every set you photograph, in one place."}</p>

      {state === "loading" && <div className="lb-grid">{Array.from({ length: 6 }, (_, i) => <div key={i} className="lb-tile skeleton" />)}</div>}
      {state === "missing" && <div className="notice"><Sparkles size={18} /><span>Photos aren&apos;t switched on for this salon yet.</span></div>}
      {state === "error" && <div className="notice danger"><span>Couldn&apos;t load the photos. Check your connection and open this page again.</span></div>}
      {state === "ready" && !photos?.length && (
        <div className="card">
          <Empty icon={ImagePlus} title="Your lookbook starts with one photo">
            After a set, open the client and tap Add photo. Every photo lands here too, ready to scroll through or share.
          </Empty>
          <div className="row" style={{ justifyContent: "center", marginTop: 8 }}><Link href="/clients/" className="btn soft pill">Go to clients</Link></div>
        </div>
      )}

      {state === "ready" && !!photos?.length && (
        <>
          {services.length > 1 && (
            <div className="chips" style={{ marginBottom: 14 }}>
              <button type="button" className={`chip${filter === null ? " on" : ""}`} onClick={() => { setFilter(null); setShown(PAGE); }}>All</button>
              {services.map((s) => (
                <button type="button" key={s} className={`chip${filter === s ? " on" : ""}`} onClick={() => { setFilter(s); setShown(PAGE); }}>{s}</button>
              ))}
            </div>
          )}
          <div className="lb-grid">
            {visible.map((p, i) => {
              const c = clientById.get(p.client_id);
              const url = urls[p.storage_path];
              return (
                <button type="button" key={p.id} className={`lb-tile${i % 7 === 0 ? " big" : ""}`} onClick={() => setViewing(p)} aria-label={`Photo of ${c?.name ?? "a client"}'s nails`}>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  {url ? <img src={url} alt="" loading="lazy" /> : <span className="skeleton" />}
                  <span className="lb-cap">{c ? firstName(c.name) : ""}{serviceOf(p) ? ` · ${serviceOf(p)}` : ""}</span>
                </button>
              );
            })}
          </div>
          {list.length > shown && (
            <div className="row" style={{ justifyContent: "center", marginTop: 16 }}>
              <button type="button" className="ghost pill" onClick={() => setShown(shown + PAGE)}>Show more</button>
            </div>
          )}
        </>
      )}

      {viewing && (
        <Sheet title={client ? firstName(client.name) : "Photo"} onClose={() => setViewing(null)}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          {urls[viewing.storage_path] && <img src={urls[viewing.storage_path]} alt="" className="lb-full" />}
          <div className="lb-meta">
            <div className="grow">
              <div style={{ fontWeight: 650 }}>{serviceOf(viewing) ?? "Nail set"}</div>
              <div className="small muted">{viewing.created_at ? fmtDayMonth(viewing.created_at.slice(0, 10)) : ""}{viewing.caption ? ` · ${viewing.caption}` : ""}</div>
            </div>
            <button type="button" className="soft pill" onClick={() => share(viewing)}><Share2 size={17} />Share</button>
          </div>
          {client && <Link href={`/clients/?id=${client.id}`} className="btn ghost" style={{ width: "100%", marginTop: 10 }}>Open {firstName(client.name)}&apos;s profile<ChevronRight size={17} /></Link>}
        </Sheet>
      )}
      {toast}
    </>
  );
}

const LOOKBOOK_CSS = `
.lb-grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 6px; grid-auto-flow: dense; }
@media (min-width: 700px) { .lb-grid { grid-template-columns: repeat(5, minmax(0, 1fr)); gap: 10px; } }
.lb-tile { position: relative; aspect-ratio: 1; padding: 0; border: 0; border-radius: 14px; overflow: hidden; background: var(--paper-2); min-height: 0; display: block; }
.lb-tile.big { grid-column: span 2; grid-row: span 2; }
.lb-tile img, .lb-tile .skeleton { width: 100%; height: 100%; object-fit: cover; display: block; border-radius: 0; transition: transform .4s var(--ease); }
.lb-tile:hover img { transform: scale(1.04); }
.lb-tile:active { transform: scale(0.98); }
.lb-cap { position: absolute; left: 0; right: 0; bottom: 0; padding: 18px 8px 6px; font-size: 11.5px; font-weight: 650; color: #fff; text-align: left;
  background: linear-gradient(transparent, rgba(0,0,0,0.55)); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; opacity: 0; transition: opacity .2s; }
.lb-tile.big .lb-cap, .lb-tile:hover .lb-cap { opacity: 1; }
.lb-full { width: 100%; border-radius: 18px; display: block; max-height: 64vh; object-fit: contain; background: var(--paper-2); }
.lb-meta { display: flex; align-items: center; gap: 12px; margin-top: 12px; }
`;
