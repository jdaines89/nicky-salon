"use client";

import { useEffect, useState } from "react";
import { Check } from "lucide-react";

/*
 * Looks she can pick for herself. Each is only a set of colour tokens in
 * globals.css (`:root[data-look=…]`), remembered on this device. The choice
 * is applied before first paint by the script in layout.tsx, so a dark look
 * never flashes cream on the way in.
 */
export const LOOKS = [
  { id: "stage", name: "Stage", note: "Velvet and gold", swatch: ["#FBF6F1", "#7A1F3D", "#C9953F"] },
  { id: "classic", name: "Classic", note: "Teal and gold", swatch: ["#F5F1EA", "#0F3B38", "#BD9155"] },
  { id: "sage", name: "Sage", note: "Soft and earthy", swatch: ["#F2F1EA", "#3F5A48", "#C4876A"] },
  { id: "blush", name: "Blush", note: "Plum and rose", swatch: ["#F8F1EE", "#6B3A4C", "#C79A6B"] },
  { id: "midnight", name: "Midnight", note: "Dark, for evenings", swatch: ["#121218", "#8B7AE0", "#E0B77E"] },
] as const;
export type LookId = (typeof LOOKS)[number]["id"];

export const LOOK_KEY = "nicky-look";
export const DEFAULT_LOOK: LookId = "stage";
const THEME_COLOR: Record<LookId, string> = { stage: "#FBF6F1", classic: "#F5F1EA", sage: "#F2F1EA", blush: "#F8F1EE", midnight: "#121218" };

/** Runs inline in <head>: keep it tiny and dependency-free. */
export const LOOK_BOOT = `(function(){var l="stage";try{l=localStorage.getItem("${LOOK_KEY}")||l}catch(e){}if(l!=="classic")document.documentElement.setAttribute("data-look",l)})()`;

function apply(id: LookId) {
  const root = document.documentElement;
  if (id === "classic") root.removeAttribute("data-look");
  else root.setAttribute("data-look", id);
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", THEME_COLOR[id]);
}

export function LookPicker() {
  const [look, setLook] = useState<LookId>(DEFAULT_LOOK);
  useEffect(() => {
    try {
      const saved = localStorage.getItem(LOOK_KEY) as LookId | null;
      if (saved && LOOKS.some((l) => l.id === saved)) setLook(saved);
    } catch { /* private window: keep the default */ }
  }, []);
  function pick(id: LookId) {
    setLook(id);
    apply(id);
    try { localStorage.setItem(LOOK_KEY, id); } catch { /* still applied for this visit */ }
  }
  return (
    <div className="looks" role="radiogroup" aria-label="Look">
      {LOOKS.map((l) => (
        <button type="button" key={l.id} role="radio" aria-checked={look === l.id} className={`look${look === l.id ? " on" : ""}`} onClick={() => pick(l.id)}>
          <span className="look-sw" style={{ background: l.swatch[0] }} aria-hidden>
            <i style={{ background: l.swatch[1] }} /><i style={{ background: l.swatch[2] }} />
            {look === l.id && <b><Check size={14} strokeWidth={3} /></b>}
          </span>
          <span className="look-name">{l.name}</span>
          <span className="look-note">{l.note}</span>
        </button>
      ))}
    </div>
  );
}
