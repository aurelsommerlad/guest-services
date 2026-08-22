import { Josefin_Sans, Roboto } from "next/font/google";
import "./globals.css";

// Registered as CSS variables only (not applied to <body> directly), so
// they're available to the guest-facing frontend (via the `guest-shell`
// class in globals.css) without changing the admin area's default font.
// Josefin Sans is used for headings/titles (weight 400), Roboto for body
// and UI text (weight 300 by default) — see globals.css for how the two
// are wired up, and components/guest/GuestApp.jsx's `.guest-heading`
// usage for headings. Extra weights beyond the spec's base (Roboto 400/
// 500/700, Josefin Sans 500/600) are loaded too so existing font-medium/
// font-semibold utility classes on buttons and labels keep rendering at a
// legible weight instead of silently falling back to the nearest loaded
// one — this is what keeps small UI text from looking overly thin.
const headingFont = Josefin_Sans({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  variable: "--font-heading",
  display: "swap",
});

const bodyFont = Roboto({
  subsets: ["latin"],
  weight: ["300", "400", "500", "700"],
  variable: "--font-body",
  display: "swap",
});

export const metadata = {
  title: "Gäste-Services",
  description: "Zusatzleistungen bequem zur Buchung hinzufügen",
};

export const viewport = {
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }) {
  return (
    <html lang="de" className={`${headingFont.variable} ${bodyFont.variable}`}>
      <body className="bg-slate-50 text-slate-900">{children}</body>
    </html>
  );
}
