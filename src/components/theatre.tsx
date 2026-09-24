"use client";

import { useEffect, useState } from "react";
import { nowSa, todaySa } from "@/lib/salon";

const CURTAIN_KEY = "nicky-curtain";

/**
 * Once a day, the first time she opens the app, velvet curtains part on her
 * name. It is over in about a second and a tap skips it; it never shows twice
 * in a day and never for anyone who prefers reduced motion.
 */
export function Curtain() {
  const [phase, setPhase] = useState<"off" | "closed" | "open">("off");
  useEffect(() => {
    try {
      if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
      const today = todaySa();
      if (localStorage.getItem(CURTAIN_KEY) === today) return;
      localStorage.setItem(CURTAIN_KEY, today);
    } catch { return; }
    setPhase("closed");
    const a = setTimeout(() => setPhase("open"), 700);
    const b = setTimeout(() => setPhase("off"), 1900);
    return () => { clearTimeout(a); clearTimeout(b); };
  }, []);
  if (phase === "off") return null;
  const h = nowSa().hour;
  const when = h < 12 ? "Good morning" : h < 18 ? "Good afternoon" : "Good evening";
  return (
    <div className={`curtain${phase === "open" ? " open" : ""}`} onClick={() => setPhase("off")} aria-hidden>
      <div className="panel l" /><div className="panel r" /><div className="valance" />
      <div className="bill">
        <div className="who">Nicky</div>
        <div className="what">BEAUTY &amp; NAILS</div>
        <div className="when">{when}. The stage is yours.</div>
      </div>
    </div>
  );
}

/** Ask for a round of applause from anywhere: `applaud()`. */
export function applaud() {
  window.dispatchEvent(new Event("nicky-applause"));
}

/** A small burst of gold and velvet confetti, over in a second. */
export function Applause() {
  const [bursts, setBursts] = useState<number[]>([]);
  useEffect(() => {
    const on = () => {
      if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
      const id = Date.now();
      setBursts((b) => [...b, id]);
      setTimeout(() => setBursts((b) => b.filter((x) => x !== id)), 1300);
    };
    window.addEventListener("nicky-applause", on);
    return () => window.removeEventListener("nicky-applause", on);
  }, []);
  return (
    <>
      {bursts.map((id) => (
        <div key={id} className="applause" aria-hidden>
          {Array.from({ length: 28 }, (_, i) => {
            const angle = (-160 + (i / 27) * 140) * (Math.PI / 180);
            const dist = 120 + ((i * 37) % 90);
            return (
              <i key={i} style={{
                background: i % 3 === 0 ? "var(--teal)" : i % 3 === 1 ? "var(--gold)" : "var(--hero-gold)",
                animationDelay: `${(i % 5) * 20}ms`,
                ["--x" as string]: `${Math.cos(angle) * dist}px`,
                ["--y" as string]: `${Math.sin(angle) * dist}px`,
                ["--r" as string]: `${(i * 67) % 360}deg`,
              }} />
            );
          })}
        </div>
      ))}
    </>
  );
}
