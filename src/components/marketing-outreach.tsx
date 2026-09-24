"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { Contact } from "@/components/ui";
import type { Client } from "@/lib/types";

/**
 * Placeholder fill via plain replace, never a format function: a stray "{"
 * typed into a custom message must never crash the page.
 */
export function renderTpl(tpl: string, vals: Record<string, string | number>): string {
  let out = tpl;
  for (const [k, v] of Object.entries(vals)) out = out.split(`{${k}}`).join(String(v));
  return out;
}

/** The pre-written message, editable before it goes out to the whole list. */
export function MarketingTemplateEditor({ value, onChange, onReset, placeholders, isDefault }: {
  value: string; onChange: (v: string) => void; onReset: () => void; placeholders: string; isDefault: boolean;
}) {
  return (
    <details className="card tight">
      <summary style={{ cursor: "pointer", fontWeight: 600, minHeight: 40, display: "flex", alignItems: "center" }}>
        ✏️ Edit the message
      </summary>
      <div className="stack" style={{ marginTop: 8 }}>
        <textarea value={value} onChange={(e) => onChange(e.target.value)} rows={4} aria-label="Message" />
        <p className="small muted" style={{ margin: 0 }}>You can use: {placeholders}. They&apos;re filled in per client.</p>
        {!isDefault && <button type="button" className="ghost" onClick={onReset}>Reset to the original</button>}
      </div>
    </details>
  );
}

/**
 * One client: her name (a link to her profile), why she's on this list, and
 * WhatsApp with the message already written. SMS and Call sit one tap deeper.
 */
export function MarketingRow({ client, context, message, badge }: {
  client: Client; context: ReactNode; message: string; badge?: ReactNode;
}) {
  return (
    <div className="item" style={{ flexWrap: "wrap" }}>
      <div className="grow" style={{ minWidth: 160 }}>
        <Link href={`/clients/?id=${client.id}`} className="title">{client.name}</Link>
        <div className="meta">{badge}{badge ? " " : ""}{context}</div>
      </div>
      <Contact phone={client.phone} message={message} />
    </div>
  );
}
