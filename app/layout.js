import { Poppins } from "next/font/google";
import "./globals.css";

// Registered as a CSS variable only (not applied to <body> directly), so
// it's available to the guest-facing frontend (via the `guest-shell` class
// in globals.css) without changing the admin area's default font — this
// codebase's original UNIQUE PLACES look couldn't be inspected directly
// (unique-places.com is blocked by this environment's network egress
// policy), so Poppins is a closest-match approximation derived from
// screenshots, not a value pulled from the site's own CSS. Swap the
// `Poppins` import for the real font if/when it's confirmed.
const guestFont = Poppins({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-guest",
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
    <html lang="de" className={guestFont.variable}>
      <body className="bg-slate-50 text-slate-900">{children}</body>
    </html>
  );
}
