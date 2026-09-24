import type { Metadata, Viewport } from "next";
// Fonts ship with the site: no third-party request, and they load on weak LTE.
import "@fontsource-variable/fraunces/full.css";
import "@fontsource-variable/fraunces/full-italic.css";
import "@fontsource-variable/plus-jakarta-sans";
import "./globals.css";
import { AuthGate } from "@/components/auth-gate";
import { Header } from "@/components/header";
import { DataProvider } from "@/components/data";
import { LOOK_BOOT } from "@/components/look";

export const metadata: Metadata = {
  title: "Nicky — Beauty & Nails",
  description: "Bookings, clients and takings for Nicky's Beauty & Nails.",
};

export const viewport: Viewport = { width: "device-width", initialScale: 1, themeColor: "#F5F1EA", viewportFit: "cover" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en-ZA" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: LOOK_BOOT }} />
      </head>
      <body>
        <Header />
        <main className="shell">
          <AuthGate>
            <DataProvider>{children}</DataProvider>
          </AuthGate>
        </main>
      </body>
    </html>
  );
}
