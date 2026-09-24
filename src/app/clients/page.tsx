"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useMemo, useState } from "react";
import { ClientForm } from "@/components/clients-form";
import { ClientProfile } from "@/components/clients-profile";
import { useSalon } from "@/components/data";
import { Seg, useToast } from "@/components/ui";
import { recallClientsOrdered } from "@/lib/insights";
import { clientInitial, clientVisits, fmtDayMonth, isEstimatedVisit } from "@/lib/salon";
import type { Client } from "@/lib/types";

type Filter = "all" | "recall" | "birthdays";
const FILTERS: [Filter, string][] = [["all", "All"], ["recall", "Recall list"], ["birthdays", "Birthdays this month"]];

function asFilter(v: string | null): Filter {
  return v === "recall" || v === "birthdays" ? v : "all";
}

export default function ClientsPage() {
  return (
    <Suspense fallback={<p className="loading">Loading…</p>}>
      <Clients />
    </Suspense>
  );
}

function Clients() {
  const { clients, bookings, today, clientById, reload } = useSalon();
  const router = useRouter();
  const params = useSearchParams();
  const filter = asFilter(params.get("filter"));
  const selectedId = params.get("id");
  const selected = selectedId ? clientById.get(selectedId) ?? null : null;

  const [search, setSearch] = useState("");
  const [form, setForm] = useState<{ editing: Client | null } | null>(null);
  const [toast, say] = useToast();

  function go(next: { filter?: Filter; id?: string | null }, replace = false) {
    const q = new URLSearchParams();
    const f = next.filter ?? filter;
    if (f !== "all") q.set("filter", f);
    const id = next.id === undefined ? selectedId : next.id;
    if (id) q.set("id", id);
    const qs = q.toString();
    const url = `/clients/${qs ? `?${qs}` : ""}`;
    if (replace) router.replace(url, { scroll: false });
    else router.push(url);
  }

  const mm = today.slice(5, 7);
  const filtered = useMemo(() => {
    let list: Client[];
    if (filter === "recall") {
      // Most overdue by her own rhythm first, as on the dashboard — not alphabetical.
      list = recallClientsOrdered(clients, bookings, today);
    } else if (filter === "birthdays") {
      list = clients.filter((c) => (c.birthday || "").startsWith(mm + "-"))
        .sort((a, b) => (a.birthday || "").localeCompare(b.birthday || "") || a.name.localeCompare(b.name));
    } else {
      list = [...clients].sort((a, b) => a.name.localeCompare(b.name));
    }
    const s = search.trim().toLowerCase();
    if (!s) return list;
    const digits = s.replace(/\D/g, "");
    return list.filter((c) => c.name.toLowerCase().includes(s)
      || (digits.length >= 3 && (c.phone || "").replace(/\D/g, "").includes(digits)));
  }, [clients, bookings, today, filter, search, mm]);

  const listCard = (
    <div className="card">
      <div className="row" style={{ flexWrap: "nowrap" }}>
        <input className="grow" type="search" placeholder="Search clients…" value={search}
          onChange={(e) => setSearch(e.target.value)} aria-label="Search clients" />
        <button onClick={() => setForm({ editing: null })} style={{ whiteSpace: "nowrap" }}>+ Add</button>
      </div>
      <div style={{ margin: "10px 0 4px" }}>
        <Seg value={filter} options={FILTERS} onChange={(f) => go({ filter: f }, true)} />
      </div>
      <p className="small muted" style={{ margin: "6px 0 0" }}>{filtered.length} of {clients.length} clients</p>
      {!filtered.length && (
        <p className="muted">
          {filter === "recall" ? "Nobody's overdue right now." : filter === "birthdays" ? "No birthdays this month." : search ? "No clients match that search." : "No clients yet. Add your first one."}
        </p>
      )}
      <div className="list">
        {filtered.map((c) => {
          const v = clientVisits(c, bookings, today)[0];
          const meta = v ? `Last visit ${isEstimatedVisit(v) ? "~" : ""}${fmtDayMonth(v.date)}${v.date.slice(0, 4) !== today.slice(0, 4) ? ` ${v.date.slice(0, 4)}` : ""}` : "New client";
          const on = c.id === selectedId;
          return (
            <button key={c.id} className="item" onClick={() => go({ id: c.id })}
              style={on ? { background: "var(--teal-soft)" } : undefined} aria-current={on ? "true" : undefined}>
              <span className="avatar">{clientInitial(c.name)}</span>
              <div className="grow">
                <div className="title">{c.name}</div>
                <div className="meta">
                  {meta}
                  {filter === "birthdays" && c.birthday ? ` · 🎂 ${fmtDayMonth(`2000-${c.birthday}`)}` : ""}
                </div>
              </div>
              <span className="muted" aria-hidden>›</span>
            </button>
          );
        })}
      </div>
    </div>
  );

  return (
    <>
      <style>{`
        .cl-layout { display: grid; gap: 14px; grid-template-columns: minmax(0, 1fr); }
        @media (min-width: 900px) {
          .cl-layout.has-profile { grid-template-columns: minmax(0, 1fr) minmax(0, 1.6fr); align-items: start; }
          .cl-layout.has-profile .cl-back { display: none; }
        }
        @media (max-width: 899px) { .cl-layout.has-profile .cl-list { display: none; } }
      `}</style>

      <h1>Clients</h1>
      <p className="sub">Your client book</p>

      <div className={`cl-layout${selectedId ? " has-profile" : ""}`}>
        <div className="cl-list">{listCard}</div>
        {selectedId && (
          <div>
            <button className="linkish cl-back" style={{ marginBottom: 10 }} onClick={() => go({ id: null })}>← All clients</button>
            {selected ? (
              <ClientProfile key={selected.id} client={selected} bookings={bookings} today={today}
                onEdit={() => setForm({ editing: selected })} say={say} />
            ) : (
              <div className="card"><p className="muted" style={{ margin: 0 }}>That client isn&apos;t on file any more.</p></div>
            )}
          </div>
        )}
      </div>

      {form && (
        <ClientForm editing={form.editing} today={today} onClose={() => setForm(null)}
          onSaved={async (created, msg) => {
            setForm(null);
            await reload();
            say(msg);
            if (created) go({ id: created.id });
          }} />
      )}
      {toast}
    </>
  );
}
