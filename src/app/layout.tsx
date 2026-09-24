import type { Metadata, Viewport } from "next";
import "./globals.css";
import { AuthGate } from "@/components/auth-gate";
import { Header } from "@/components/header";
import { DataProvider } from "@/components/data";

export const metadata: Metadata = {
  title: "Nicky — Beauty & Nails",
  description: "Bookings, clients and takings for Nicky's Beauty & Nails.",
};

export const viewport: Viewport = { width: "device-width", initialScale: 1, themeColor: "#0E3B39" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en-ZA">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        <link
          rel="stylesheet"
          href="https://fonts.googleapis.com/css2?family=Fraunces:ital,opsz,wght@0,9..144,500;1,9..144,500&family=Work+Sans:wght@400;500;600;700&display=swap"
        />
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
