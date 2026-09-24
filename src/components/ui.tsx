"use client";

import { useEffect, useState, type ReactNode } from "react";
import { smsLink, telLink, waLink } from "@/lib/salon";

/** 'R 1,250' — whole Rand, the way she'd say it. */
export function rand(n: number): string {
  return "R " + Math.round(n).toLocaleString("en-ZA").replace(/ /g, " ");
}

/**
 * A bottom sheet on phones, a centred panel on wider screens. Unlike the old
 * Streamlit dialog, a tap outside does NOT close it: a stray tap mid-edit
 * used to throw away half a booking. Only Close, Cancel or Save do.
 */
export function Sheet({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = prev; };
  }, []);
  return (
    <div className="overlay" role="dialog" aria-modal="true" aria-label={title}>
      <div className="sheet">
        <div className="sheet-head">
          <h2 className="grow">{title}</h2>
          <button className="ghost" onClick={onClose} aria-label="Close">✕</button>
        </div>
        {children}
      </div>
    </div>
  );
}

/** Segmented control: big, tappable, and never needs a second tap to open. */
export function Seg<T extends string>({ value, options, onChange }: {
  value: T; options: readonly (T | [T, string])[]; onChange: (v: T) => void;
}) {
  return (
    <div className="seg" role="radiogroup">
      {options.map((o) => {
        const [v, label] = Array.isArray(o) ? o : [o, o];
        return (
          <button key={v} type="button" role="radio" aria-checked={v === value}
            className={v === value ? "on" : ""} onClick={() => onChange(v)}>{label}</button>
        );
      })}
    </div>
  );
}

/**
 * WhatsApp with the message already written; SMS and Call one tap deeper.
 * No API and no cost: the link just opens the client's chat on her phone.
 */
export function Contact({ phone, message }: { phone: string | null; message: string }) {
  const [more, setMore] = useState(false);
  const wa = waLink(phone, message), sms = smsLink(phone, message), tel = telLink(phone);
  if (!wa && !sms && !tel) return <span className="small muted">No number</span>;
  return (
    <div className="row" style={{ flexWrap: "nowrap" }}>
      {wa ? <a className="btn gold" href={wa} target="_blank" rel="noreferrer">💬 WhatsApp</a>
        : sms ? <a className="btn gold" href={sms}>✉️ SMS</a>
        : <a className="btn gold" href={tel!}>📞 Call</a>}
      {wa && (sms || tel) && (
        <div style={{ position: "relative" }}>
          <button className="ghost" aria-label="More ways to contact" onClick={() => setMore(!more)}>⋯</button>
          {more && (
            <div className="card tight" style={{ position: "absolute", right: 0, top: 48, zIndex: 10, minWidth: 180 }}>
              <div className="stack">
                {sms && <a className="btn ghost" href={sms}>✉️ SMS instead</a>}
                {tel && <a className="btn ghost" href={tel}>📞 Call</a>}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export function Kpi({ label, value, note, tone }: { label: string; value: ReactNode; note?: ReactNode; tone?: "up" | "down" }) {
  return (
    <div className="kpi">
      <div className="label">{label}</div>
      <div className="value">{value}</div>
      {note != null && <div className={`delta${tone ? " " + tone : ""}`}>{note}</div>}
    </div>
  );
}

export function statusBadge(status: string) {
  const cls = status === "confirmed" ? "" : status === "pending" ? "gold" : status === "no-show" ? "danger" : "muted";
  return <span className={`badge ${cls}`}>{status === "no-show" ? "No-show" : status[0].toUpperCase() + status.slice(1)}</span>;
}

/** A short-lived message at the bottom of the screen after a save. */
export function useToast(): [ReactNode, (msg: string) => void] {
  const [msg, setMsg] = useState<string | null>(null);
  useEffect(() => {
    if (!msg) return;
    const t = setTimeout(() => setMsg(null), 3500);
    return () => clearTimeout(t);
  }, [msg]);
  const node = msg ? (
    <div role="status" style={{
      position: "fixed", left: 16, right: 16, bottom: "calc(90px + env(safe-area-inset-bottom))", zIndex: 60,
      margin: "0 auto", maxWidth: 480, background: "var(--teal)", color: "#fff", borderRadius: 12, padding: "12px 16px",
      boxShadow: "0 6px 24px rgba(0,0,0,0.18)",
    }}>{msg}</div>
  ) : null;
  return [node, setMsg];
}
