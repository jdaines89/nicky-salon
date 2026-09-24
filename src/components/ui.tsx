"use client";

import { useEffect, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { CheckCircle2, MessageCircle, MoreHorizontal, Phone, Send, X, type LucideIcon } from "lucide-react";
import { smsLink, telLink, waLink } from "@/lib/salon";

/** 'R 1,250' — whole Rand, the way she'd say it. */
export function rand(n: number): string {
  return "R " + Math.round(n).toLocaleString("en-ZA").replace(/ /g, " ");
}

/**
 * A bottom sheet on phones, a centred panel on wider screens. Unlike the old
 * Streamlit dialog, a tap outside does NOT close it: a stray tap mid-edit
 * used to throw away half a booking. Only Close, Cancel or Save do.
 * Rendered into <body> so no ancestor's transform or filter can trap it.
 */
export function Sheet({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    setMounted(true);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = prev; };
  }, []);
  if (!mounted) return null;
  return createPortal(
    <div className="overlay" role="dialog" aria-modal="true" aria-label={title}>
      <div className="sheet">
        <div className="sheet-head">
          <h2 className="grow">{title}</h2>
          <button type="button" className="x" onClick={onClose} aria-label="Close"><X size={20} /></button>
        </div>
        {children}
      </div>
    </div>,
    document.body,
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
    <div className="row" style={{ flexWrap: "nowrap", gap: 6 }}>
      {wa ? <a className="btn soft pill" href={wa} target="_blank" rel="noreferrer" style={{ minHeight: 42 }}><MessageCircle size={17} />WhatsApp</a>
        : sms ? <a className="btn soft pill" href={sms} style={{ minHeight: 42 }}><Send size={16} />SMS</a>
        : <a className="btn soft pill" href={tel!} style={{ minHeight: 42 }}><Phone size={16} />Call</a>}
      {wa && (sms || tel) && (
        <div style={{ position: "relative" }}>
          <button type="button" className="ghost icon pill" style={{ width: 42, minHeight: 42 }} aria-label="More ways to contact" onClick={() => setMore(!more)}>
            <MoreHorizontal size={18} />
          </button>
          {more && (
            <div className="menu" style={{ top: 48 }}>
              {sms && <a className="btn" href={sms}><Send size={17} />SMS instead</a>}
              {tel && <a className="btn" href={tel}><Phone size={17} />Call</a>}
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

/** A friendly empty state: an icon, what's missing, and what to do about it. */
export function Empty({ icon: Icon, title, children }: { icon: LucideIcon; title: string; children?: ReactNode }) {
  return (
    <div className="empty">
      <Icon size={26} strokeWidth={1.6} aria-hidden />
      <b>{title}</b>
      {children}
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
  const node = msg ? <div role="status" className="toast"><CheckCircle2 size={20} />{msg}</div> : null;
  return [node, setMsg];
}
