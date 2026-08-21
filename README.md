# Apaleo Upsell App

Gäste identifizieren sich über ihre Reservierungs- oder Buchungsnummer plus
Nachname und können Zusatzleistungen (Extras) zu ihrer Buchung hinzufügen,
die automatisch direkt aufs Apaleo-Folio gebucht werden. Ein Admin-Bereich
erlaubt es, pro Hotel einzelne Apaleo-Services samt Bild/Anzeigename/
Beschreibung fürs Gäste-Frontend freizuschalten und Nutzer mit Rollen zu
verwalten.

## Tech-Stack

- Next.js (App Router, JavaScript) — Deploy auf Vercel per GitHub-Push.
- Tailwind CSS, mobile-first.
- Vercel KV (Upstash Redis) für alle Anwendungsdaten inkl. Bilder
  (Base64), mit automatischem Fallback auf `.data/db.json` lokal.
- JWT-Session in httpOnly-Cookie (`jose`), Passwort-Hashing mit `bcryptjs`.

## Lokale Entwicklung

```bash
npm install
cp .env.example .env.local
# .env.local befüllen: APALEO_CLIENT_ID, APALEO_CLIENT_SECRET, JWT_SECRET
npm run dev
```

Ohne gesetzte `KV_REST_API_URL` / `KV_REST_API_TOKEN` läuft die App lokal
vollständig gegen `.data/db.json`.

## Apaleo-Setup

1. Als Account Admin auf [apaleo.dev](https://apaleo.dev) einen neuen
   **Simple Client** (Client Credentials Grant) registrieren.
2. Benötigte Scopes exakt:
   ```
   reservations.read reservations.manage offers.read setup.read folios.read
   ```
3. Client ID + Secret als `APALEO_CLIENT_ID` / `APALEO_CLIENT_SECRET`
   hinterlegen.

## Deploy auf Vercel

1. GitHub-Repo pushen.
2. In Vercel: Projekt aus dem Repo erstellen (Next.js wird automatisch
   erkannt, Zero-Config).
3. Unter "Storage": Vercel KV (Upstash Redis) erstellen und verknüpfen →
   setzt `KV_REST_API_URL` / `KV_REST_API_TOKEN` automatisch.
4. Environment Variables ergänzen: `APALEO_CLIENT_ID`,
   `APALEO_CLIENT_SECRET`, `JWT_SECRET` (z. B. via
   `openssl rand -base64 48`).
5. Redeploy auslösen, `/admin` aufrufen → Ersteinrichtung erstes
   Admin-Konto.

## Projektstruktur

```
app/
  page.js                        Gäste-Startseite (Suche → Katalog → Buchung)
  admin/
    setup/page.js                 Ersteinrichtung (erstes Admin-Konto)
    login/page.js                 Admin-Login
    (dashboard)/
      layout.js                   Nav + Rollen-Gate
      catalog/page.js              Katalog-Verwaltung (admin, manager)
      users/page.js                 Benutzerverwaltung (admin)
      orders/page.js                Bestellübersicht (admin, manager, viewer)
  api/
    guest/{lookup,catalog,order}/route.js
    admin/{setup,login,logout,properties,services,catalog,upload,orders,users,users/[id],users/me/password}/route.js
    images/[id]/route.js           Liefert hochgeladene Service-Bilder aus
components/
  guest/GuestApp.jsx               Gesamter Gäste-Flow (Client Component)
  admin/{SetupForm,LoginForm,DashboardNav,CatalogManager,UsersManager,OrdersView}.jsx
lib/
  db.js       Vercel KV (Upstash) / lokaler JSON-Fallback
  images.js   Bild-Upload als Base64 in derselben KV-Datenbank
  apaleo.js   Apaleo API Client
  auth.js     JWT-Session, bcrypt, Rollenprüfung
  store.js    Datenzugriff (users, catalog, orders)
  guest.js    Business-Logik Gäste-Flow
  notify.js   E-Mail-Erweiterungspunkt (aktuell nur Log)
  format.js   Preis-/Datumsformatierung
```

## Bekannte Stolpersteine, die von Anfang an berücksichtigt sind

1. **`book-service` bucht sonst pro Nacht statt pro gewählter Menge.**
   Ohne `dates`-Array wählt Apaleo selbst ein Datumsmuster (meist jede
   Nacht), und `count` gilt pro Datum. `lib/apaleo.js` ruft daher vor jeder
   Buchung `service-offers` ab, ermittelt das früheste `isDefaultDate`, und
   bucht explizit ein einzelnes Datum mit der vollen gewählten Menge.
2. **Reservierungskommentar wird ergänzt, nicht überschrieben.** Nach
   jeder erfolgreichen Buchung wird der bestehende `comment` (internes,
   fürs Frontoffice sichtbares Feld) per JSON-Patch um eine neue Zeile
   ergänzt.
3. **Service-Offers schlagen für abgereiste Reservierungen mit HTTP 422
   fehl.** `lib/apaleo.js` vergleicht das Abreisedatum vorab mit heute und
   überspringt den API-Call bei vergangenen Aufenthalten; ein 422 wird
   zusätzlich im Catch-Block als Sicherheitsnetz behandelt. Das Frontend
   zeigt dafür eine eigene, verständliche Meldung statt der generischen
   "keine Extras verfügbar"-Meldung.

## Rollen & Zugriffskontrolle

Rollenprüfung erfolgt serverseitig in jedem API-Route-Handler (`lib/auth.js`
→ `requireRole`), nicht nur im Frontend:

- **admin**: Katalog, Benutzerverwaltung, Bestellungen.
- **manager**: Katalog, Bestellungen.
- **viewer**: nur Bestellungen (lesend).

## Sicherheitshinweis Gäste-Suche

Bei der Reservierungssuche im Gäste-Portal wird bei einem Fehlschlag immer
dieselbe generische Fehlermeldung angezeigt — es wird nie verraten, ob die
Nummer oder der Nachname falsch war.

## Bewusst nicht enthalten (Erweiterungspunkte)

- Kein automatischer E-Mail-Versand ans Frontoffice — `lib/notify.js` ist
  als Erweiterungspunkt vorbereitet (`notifyFrontOffice(order)`).
- Kein mehrsprachiges Frontend (nur Deutsch).
