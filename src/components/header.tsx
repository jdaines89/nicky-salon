"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import {
  BarChart3, CalendarDays, Ellipsis, Gem, Home, LogOut, Megaphone, Plus, UserRound, Users,
  type LucideIcon,
} from "lucide-react";
import { supabase } from "@/lib/supabase";
import { Sheet } from "@/components/ui";

type Tab = [href: string, label: string, Icon: LucideIcon];
const MAIN: Tab[] = [
  ["/", "Today", Home],
  ["/bookings/", "Diary", CalendarDays],
];
const PEOPLE: Tab = ["/clients/", "Clients", Users];
const MORE: Tab[] = [
  ["/services/", "Services", Gem],
  ["/marketing/", "Marketing", Megaphone],
  ["/reports/", "Reports", BarChart3],
];

/**
 * Brand plus navigation. On a phone the four places she uses most dock to the
 * bottom with a raised Book button in the middle, under her thumb; the rest
 * sit one tap away under More. On a wide screen everything is in the header.
 */
export function Header() {
  const path = usePathname();
  const [email, setEmail] = useState<string | null>(null);
  const [menu, setMenu] = useState(false);
  const [more, setMore] = useState(false);
  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setEmail(data.session?.user.email ?? null));
    const { data } = supabase.auth.onAuthStateChange((_e, s) => setEmail(s?.user.email ?? null));
    return () => data.subscription.unsubscribe();
  }, []);
  useEffect(() => { setMenu(false); setMore(false); }, [path]);
  const signedIn = email !== null;
  const moreOn = MORE.some(([h]) => h === path);

  const link = ([href, label, Icon]: Tab, cls = "") => (
    <Link key={href} href={href} className={`${path === href ? "on" : ""} ${cls}`.trim()} aria-current={path === href ? "page" : undefined}>
      <Icon size={22} strokeWidth={1.9} aria-hidden />{label}
    </Link>
  );

  return (
    <header className="top">
      <div className="shell">
        <Link href="/" className="brand" aria-label="Nicky Beauty & Nails, home">
          <span className="mono" aria-hidden>N</span>
          <span className="words"><span className="name">Nicky</span><span className="tag">BEAUTY &amp; NAILS</span></span>
        </Link>
        {signedIn && (
          <nav className="tabs" aria-label="Main">
            {MAIN.map((t) => link(t))}
            <Link href="/bookings/?new=1" className="book" aria-label="New booking"><Plus size={28} strokeWidth={2.4} /></Link>
            {link(PEOPLE)}
            <button type="button" className={`tab phone-only${moreOn ? " on" : ""}`} onClick={() => setMore(true)} aria-label="More">
              <Ellipsis size={22} strokeWidth={1.9} aria-hidden />More
            </button>
            {MORE.map((t) => link(t, "wide-only"))}
          </nav>
        )}
        {signedIn && (
          <div className="me">
            <button type="button" aria-label="Account" aria-expanded={menu} onClick={() => setMenu(!menu)}><UserRound size={19} /></button>
            {menu && (
              <div className="menu" role="menu">
                <div className="who">Signed in as<br /><b style={{ color: "var(--ink)" }}>{email}</b></div>
                <button type="button" role="menuitem" onClick={() => supabase.auth.signOut()}><LogOut size={18} />Sign out</button>
              </div>
            )}
          </div>
        )}
      </div>
      {more && (
        <Sheet title="More" onClose={() => setMore(false)}>
          <div className="more-grid">
            {MORE.map(([href, label, Icon]) => (
              <Link key={href} href={href} className={path === href ? "on" : ""}><Icon size={26} strokeWidth={1.8} />{label}</Link>
            ))}
          </div>
          <button type="button" className="ghost" style={{ width: "100%", marginTop: 14 }} onClick={() => supabase.auth.signOut()}>
            <LogOut size={18} />Sign out
          </button>
        </Sheet>
      )}
    </header>
  );
}
