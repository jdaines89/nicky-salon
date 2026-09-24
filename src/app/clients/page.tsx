"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { Fragment, Suspense, useMemo, useState } from "react";
import { Cake, ChevronLeft, ChevronRight, Heart, Search, UserPlus, Users } from "lucide-react";
import { ClientForm } from "@/components/clients-form";
import { ClientProfile } from "@/components/clients-profile";
import { useSalon } from "@/components/data";
import { Empty, useToast } from "@/components/ui";
import { recallClientsOrdered } from "@/lib/insights";
import { clientInitial, clientVisits, fmtDayMonth, isEstimatedVisit } from "@/lib/salon";
import type { Client } from "@/lib/types";

type Filter = "all" | "recall" | "birthdays";
const FILTERS: [Filter, string][] = [["all", "All"], ["recall", "Recall list"], ["birthdays", "Birthdays"]];

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
      <div className="search">
        <Search size={18} />
        <input type="search" placeholder="Search by name or number" value={search}
          onChange={(e) => setSearch(e.target.value)} aria-label="Search clients" />
      </div>
      <div className="chips" style={{ margin: "12px 0 6px" }}>
        {FILTERS.map(([f, label]) => (
          <button type="button" key={f} className={`chip${filter === f ? " on" : ""}`} onClick={() => go({ filter: f }, true)}>{label}</button>
        ))}
      </div>
      {!filtered.length && (
        <Empty icon={filter === "birthdays" ? Cake : filter === "recall" ? Heart : Users}
          title={filter === "recall" ? "Nobody's overdue" : filter === "birthdays" ? "No birthdays this month" : search ? "No one by that name" : "No clients yet"}>
          {filter === "all" && !search ? "Add your first one with the button above." : null}
        </Empty>
      )}
      <div className="list">
        {filtered.map((c, i) => {
          const v = clientVisits(c, bookings, today)[0];
          const meta = v ? `Last in ${isEstimatedVisit(v) ? "~" : ""}${fmtDayMonth(v.date)}${v.date.slice(0, 4) !== today.slice(0, 4) ? ` ${v.date.slice(0, 4)}` : ""}` : "New client";
          const on = c.id === selectedId;
          const letter = c.name.trim().charAt(0).toUpperCase();
          const showLetter = filter === "all" && !search.trim() && (i === 0 || filtered[i - 1].name.trim().charAt(0).toUpperCase() !== letter);
          return (
            <Fragment key={c.id}>
              {showLetter && <div className="cl-letter">{letter}</div>}
              <button className={`item${on ? " on" : ""}`} onClick={() => go({ id: c.id })} aria-current={on ? "true" : undefined}>
                <span className="avatar">{clientInitial(c.name)}</span>
                <div className="grow">
                  <div className="title">{c.name}</div>
                  <div className="meta">
                    {meta}
                    {filter === "birthdays" && c.birthday ? ` · Birthday ${fmtDayMonth(`2000-${c.birthday}`)}` : ""}
                  </div>
                </div>
                <ChevronRight size={18} className="chev" aria-hidden />
              </button>
            </Fragment>
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
        .cl-letter { font-family: var(--serif); font-size: 16px; color: var(--gold-2); padding: 12px 6px 2px; border-bottom: 1px solid var(--line); }
        .list > .item.on { background: var(--teal-soft); border-radius: 14px; }
      `}</style>

      <div className="page-head">
        <div className="grow">
          <h1>Clients</h1>
          <p className="sub">{clients.length} in your book</p>
        </div>
        <button className="gold pill" onClick={() => setForm({ editing: null })}><UserPlus size={18} />Add</button>
      </div>

      <div className={`cl-layout${selectedId ? " has-profile" : ""}`}>
        <div className="cl-list">{listCard}</div>
        {selectedId && (
          <div>
            <button className="linkish cl-back" style={{ marginBottom: 10, display: "inline-flex", alignItems: "center", gap: 2 }} onClick={() => go({ id: null })}><ChevronLeft size={18} />All clients</button>
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
