import type { Metadata, Viewport } from "next";
import "bootstrap/dist/css/bootstrap.min.css";
import "./globals.css";
import Nav from "@/components/Nav";
import Providers from "@/components/Providers";

export const metadata: Metadata = {
  title: "AH Planner",
  description: "Weekmenu, boodschappen en voorraad voor het hele gezin",
  manifest: "/manifest.webmanifest",
  appleWebApp: { capable: true, title: "AH Planner", statusBarStyle: "black-translucent" },
  icons: { icon: "/icons/icon-192.png", apple: "/icons/apple-touch-icon.png" },
  formatDetection: { telephone: false },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#003d9b",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="nl">
      <body>
        <Providers>
          <Nav />
          <main className="container py-3 py-md-4 main-with-tabbar">{children}</main>
        </Providers>
      </body>
    </html>
  );
}
