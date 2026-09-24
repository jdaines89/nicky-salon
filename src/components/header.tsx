"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";

const TABS: [string, string, string][] = [
  ["/", "Today", "🏠"],
  ["/bookings/", "Bookings", "📅"],
  ["/clients/", "Clients", "👥"],
  ["/services/", "Services", "💎"],
  ["/marketing/", "Marketing", "📣"],
  ["/reports/", "Reports", "📊"],
];

/** Brand plus navigation. The tabs dock to the bottom of a phone, where a thumb reaches them. */
export function Header() {
  const path = usePathname();
  const [signedIn, setSignedIn] = useState(false);
  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSignedIn(Boolean(data.session)));
    const { data } = supabase.auth.onAuthStateChange((_e, s) => setSignedIn(Boolean(s)));
    return () => data.subscription.unsubscribe();
  }, []);

  return (
    <header className="top">
      <div className="shell">
        <Link href="/" className="brand">
          <span className="name">Nicky</span>
          <span className="tag">BEAUTY &amp; NAILS</span>
        </Link>
        {signedIn && (
          <nav className="tabs">
            {TABS.map(([href, label, ico]) => (
              <Link key={href} href={href} className={path === href ? "on" : ""}>
                <span className="ico" aria-hidden>{ico}</span>{label}
              </Link>
            ))}
          </nav>
        )}
        {signedIn && <button className="signout" onClick={() => supabase.auth.signOut()}>Sign out</button>}
      </div>
    </header>
  );
}
