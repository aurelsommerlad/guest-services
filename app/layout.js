import "./globals.css";

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
    <html lang="de">
      <body className="bg-slate-50 text-slate-900">{children}</body>
    </html>
  );
}
