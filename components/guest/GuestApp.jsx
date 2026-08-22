"use client";

import { useMemo, useState } from "react";
import { formatDate, formatPrice } from "@/lib/format";
import { computePriceBreakdown } from "@/lib/priceDisplay";

const PAST_STAY_MESSAGE =
  "Diese Reservierung liegt bereits in der Vergangenheit. Über das Portal können daher keine weiteren Extras mehr gebucht werden – bitte wende Dich an die Rezeption.";
const NO_ITEMS_MESSAGE = "Für Deine Reservierung sind aktuell keine Extras verfügbar.";

// Shared style tokens for the guest-facing frontend only — kept local to
// this file (the only place these components live) rather than duplicated
// per component. Colors/radii intentionally reuse Tailwind's stock warm
// "stone" neutral scale instead of inventing new hex values, since the
// reference site (unique-places.com) is blocked by this environment's
// network egress policy and couldn't be inspected directly for exact
// values — stone-50/100/200 approximate its beige framing, stone-900/black
// its dark text and primary buttons. See app/globals.css for the font.
const PRIMARY_BUTTON =
  "inline-flex w-full items-center justify-center rounded-md bg-stone-900 px-6 py-3.5 text-sm font-semibold uppercase tracking-wide text-white transition hover:bg-black disabled:cursor-not-allowed disabled:opacity-50";
const COMPACT_DARK_BUTTON =
  "inline-flex flex-shrink-0 items-center justify-center whitespace-nowrap rounded-md bg-stone-900 px-5 py-3 text-sm font-semibold uppercase tracking-wide text-white transition hover:bg-black disabled:cursor-not-allowed disabled:opacity-50";
const SECONDARY_BUTTON =
  "inline-flex items-center justify-center rounded-md border border-stone-300 bg-white px-5 py-2.5 text-sm font-medium uppercase tracking-wide text-stone-700 transition hover:border-stone-400 hover:bg-stone-50";
const INPUT_CLASS =
  "w-full rounded-md border border-stone-300 bg-white px-4 py-3 text-[15px] text-stone-900 placeholder:text-stone-400 focus:border-stone-900 focus:outline-none focus:ring-1 focus:ring-stone-900";
const ERROR_BANNER = "rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700";
const NOTICE_BANNER = "rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800";
const LABEL_CLASS = "block text-sm font-medium text-stone-700";

async function postJSON(url, body) {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const error = new Error(data?.error || "Es ist ein Fehler aufgetreten.");
    error.data = data;
    throw error;
  }
  return data;
}

// Simple monochrome placeholder for extras without an uploaded image —
// deliberately generic (no brand-specific glyph), replacing the previous
// emoji fallback.
function DefaultItemIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      className="h-7 w-7 text-stone-400"
      aria-hidden="true"
    >
      <path strokeLinecap="round" strokeLinejoin="round" d="M4 19h16M6 19c0-5 1-9 6-9s6 4 6 9M12 6V4m-2 0h4" />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      className="mx-auto h-10 w-10 text-stone-900 sm:mx-0"
      aria-hidden="true"
    >
      <circle cx="12" cy="12" r="9.25" />
      <path strokeLinecap="round" strokeLinejoin="round" d="M8.5 12.5l2.5 2.5 4.5-5.5" />
    </svg>
  );
}

function SearchForm({ onSubmit, loading, error }) {
  const [number, setNumber] = useState("");
  const [lastName, setLastName] = useState("");

  return (
    <form
      className="space-y-5 rounded-lg border border-stone-200 bg-stone-50 p-5 sm:p-8"
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit({ number, lastName });
      }}
    >
      <div>
        <label className={LABEL_CLASS} htmlFor="number">
          Reservierungs- oder Buchungsnummer
        </label>
        <input
          id="number"
          type="text"
          required
          value={number}
          onChange={(e) => setNumber(e.target.value)}
          className={`mt-1.5 ${INPUT_CLASS}`}
          placeholder="z. B. 1234567"
          autoComplete="off"
        />
      </div>
      <div>
        <label className={LABEL_CLASS} htmlFor="lastName">
          Nachname
        </label>
        <input
          id="lastName"
          type="text"
          required
          value={lastName}
          onChange={(e) => setLastName(e.target.value)}
          className={`mt-1.5 ${INPUT_CLASS}`}
          placeholder="Dein Nachname"
          autoComplete="off"
        />
      </div>
      {error && <p className={ERROR_BANNER}>{error}</p>}
      <button type="submit" disabled={loading} className={PRIMARY_BUTTON}>
        {loading ? "Wird gesucht…" : "Reservierung finden"}
      </button>
    </form>
  );
}

function ReservationPicker({ reservations, onSelect }) {
  return (
    <div className="space-y-3">
      <p className="text-sm text-stone-600">
        Wir haben mehrere Reservierungen gefunden. Bitte wähle die passende aus:
      </p>
      {reservations.map((r) => (
        <button
          key={r.id}
          onClick={() => onSelect(r)}
          className="block w-full rounded-md border border-stone-200 bg-white px-4 py-3 text-left transition hover:border-stone-400"
        >
          <div className="font-semibold text-stone-900">Reservierung {r.id}</div>
          <div className="text-sm text-stone-500">
            {formatDate(r.arrival)} – {formatDate(r.departure)}
          </div>
        </button>
      ))}
    </div>
  );
}

function CatalogItem({ item, count, onChange }) {
  // The unit price + its label in the top-right corner never changes with
  // quantity — only this optional breakdown line, shown once the guest has
  // selected at least one unit, reflects nights/quantity multiplication.
  const breakdown = computePriceBreakdown({
    unitPrice: item.unitPrice,
    nights: item.nights,
    price: item.price,
    count,
  });

  return (
    <div className="flex flex-col gap-4 rounded-lg border border-stone-200 bg-white p-4 sm:flex-row sm:items-center sm:gap-6 sm:p-6">
      <div className="flex items-start gap-4 sm:flex-1 sm:items-center sm:gap-6">
        <div className="h-16 w-16 flex-shrink-0 overflow-hidden rounded-md bg-stone-100 sm:h-20 sm:w-20">
          {item.imageUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={item.imageUrl} alt={item.displayName} className="h-full w-full object-cover" />
          ) : (
            <div className="flex h-full w-full items-center justify-center">
              <DefaultItemIcon />
            </div>
          )}
        </div>
        <div className="min-w-0 flex-1">
          <h3 className="text-base font-semibold text-stone-900 sm:text-lg">{item.displayName}</h3>
          {item.description && <p className="mt-1 text-sm text-stone-500">{item.description}</p>}
          {breakdown && (
            <p className="mt-2 text-xs text-stone-500 sm:text-sm">
              {formatPrice(breakdown.unitPrice)}
              {breakdown.nights && ` × ${breakdown.nights} Nächte`}
              {breakdown.count && ` × ${breakdown.count}`}
              {" = "}
              {formatPrice(breakdown.total)}
            </p>
          )}
        </div>
      </div>

      <div className="flex items-center justify-between gap-4 sm:flex-shrink-0 sm:flex-col sm:items-end sm:gap-3">
        <div className="text-right">
          <div className="text-lg font-semibold text-stone-900">{formatPrice(item.unitPrice)}</div>
          {item.priceUnitLabel && (
            <div className="text-xs uppercase tracking-wide text-stone-500">{item.priceUnitLabel}</div>
          )}
        </div>
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => onChange(Math.max(0, count - 1))}
            disabled={count === 0}
            className="flex h-9 w-9 items-center justify-center rounded-full border border-stone-300 text-lg font-medium text-stone-600 transition hover:border-stone-400 hover:bg-stone-50 disabled:cursor-not-allowed disabled:opacity-40"
            aria-label="Menge verringern"
          >
            –
          </button>
          <span className="w-6 text-center text-base font-medium text-stone-900">{count}</span>
          <button
            type="button"
            onClick={() => onChange(count + 1)}
            className="flex h-9 w-9 items-center justify-center rounded-full bg-stone-900 text-lg font-medium text-white transition hover:bg-black"
            aria-label="Menge erhöhen"
          >
            +
          </button>
        </div>
      </div>
    </div>
  );
}

function CatalogView({ items, cart, setCart, onBook, booking, guestName, setGuestName }) {
  const [coupon, setCoupon] = useState("");

  const { totalCount, totalPrice } = useMemo(() => {
    let count = 0;
    let amount = 0;
    let currency = "EUR";
    for (const item of items) {
      const qty = cart[item.serviceId] || 0;
      if (qty > 0 && item.price) {
        count += qty;
        amount += item.price.amount * qty;
        currency = item.price.currency || currency;
      }
    }
    return { totalCount: count, totalPrice: { amount: Math.round(amount * 100) / 100, currency } };
  }, [items, cart]);

  return (
    <div className="space-y-4 pb-64 sm:pb-56">
      <div className="space-y-3">
        {items.map((item) => (
          <CatalogItem
            key={item.serviceId}
            item={item}
            count={cart[item.serviceId] || 0}
            onChange={(next) => setCart((prev) => ({ ...prev, [item.serviceId]: next }))}
          />
        ))}
      </div>

      {totalCount > 0 && (
        <div className="fixed inset-x-0 bottom-0 border-t border-stone-200 bg-stone-50/97 backdrop-blur">
          <div className="mx-auto max-w-3xl space-y-3 px-4 py-4 sm:px-6 sm:py-5 lg:max-w-5xl">
            <input
              type="text"
              value={guestName}
              onChange={(e) => setGuestName(e.target.value)}
              placeholder="Dein Name (für die Buchung)"
              className={INPUT_CLASS}
            />
            <div className="flex gap-2">
              <input
                type="text"
                value={coupon}
                onChange={(e) => setCoupon(e.target.value)}
                placeholder="Gutscheincode"
                className={`flex-1 ${INPUT_CLASS}`}
              />
              <button type="button" disabled={!coupon.trim()} className={COMPACT_DARK_BUTTON}>
                Anwenden
              </button>
            </div>
            <div className="flex flex-wrap items-baseline justify-between gap-2 text-sm text-stone-600">
              <span>
                {totalCount} Extra{totalCount > 1 ? "s" : ""} ausgewählt
              </span>
              <span>
                <span className="font-semibold text-stone-900">Gesamtpreis {formatPrice(totalPrice)}</span>
                <span className="ml-1 text-xs text-stone-500">inkl. MwSt.</span>
              </span>
            </div>
            <button onClick={onBook} disabled={booking} className={PRIMARY_BUTTON}>
              {booking ? "Wird gebucht…" : "Jetzt buchen"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function Confirmation({ result, onRestart }) {
  return (
    <div className="space-y-5 text-center sm:text-left">
      <CheckIcon />
      <div>
        <h2 className="text-xl font-semibold text-stone-900 sm:text-2xl">Vielen Dank!</h2>
        <p className="mt-1 text-stone-600">Deine Extras wurden erfolgreich zu Deiner Buchung hinzugefügt:</p>
      </div>
      <ul className="mx-auto max-w-sm space-y-2 text-left sm:mx-0">
        {result.booked.map((item, i) => (
          <li key={i} className="rounded-md border border-stone-200 bg-white px-4 py-3 text-stone-800">
            {item.count}x {item.displayName}
          </li>
        ))}
      </ul>
      {result.failed?.length > 0 && (
        <p className="text-sm text-amber-700">
          Einige Positionen konnten nicht gebucht werden – bitte wende Dich für diese an die Rezeption.
        </p>
      )}
      <button onClick={onRestart} className={SECONDARY_BUTTON}>
        Neue Suche
      </button>
    </div>
  );
}

export default function GuestApp() {
  const [step, setStep] = useState("search");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [lastName, setLastName] = useState("");
  const [reservations, setReservations] = useState([]);
  const [reservation, setReservation] = useState(null);
  const [catalogItems, setCatalogItems] = useState([]);
  const [catalogMessage, setCatalogMessage] = useState("");
  const [cart, setCart] = useState({});
  const [guestName, setGuestName] = useState("");
  const [booking, setBooking] = useState(false);
  const [orderResult, setOrderResult] = useState(null);

  async function loadCatalog(res, name) {
    setLoading(true);
    setError("");
    try {
      const data = await postJSON("/api/guest/catalog", {
        reservationId: res.id,
        lastName: name,
      });
      if (data.pastStay) {
        setCatalogMessage(PAST_STAY_MESSAGE);
        setCatalogItems([]);
      } else if (!data.items.length) {
        setCatalogMessage(NO_ITEMS_MESSAGE);
        setCatalogItems([]);
      } else {
        setCatalogMessage("");
        setCatalogItems(data.items);
      }
      setReservation(res);
      setGuestName(name);
      setStep("catalog");
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  async function handleSearch({ number, lastName: name }) {
    setLoading(true);
    setError("");
    setLastName(name);
    try {
      const data = await postJSON("/api/guest/lookup", { number, lastName: name });
      if (data.reservations.length === 1) {
        await loadCatalog(data.reservations[0], name);
      } else {
        setReservations(data.reservations);
        setStep("select-reservation");
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  async function handleBook() {
    const lines = Object.entries(cart)
      .filter(([, count]) => count > 0)
      .map(([serviceId, count]) => ({ serviceId, count }));
    if (!lines.length) return;

    setBooking(true);
    setError("");
    try {
      const result = await postJSON("/api/guest/order", {
        reservationId: reservation.id,
        lastName,
        guestName,
        lines,
      });
      setOrderResult(result);
      setStep("confirmation");
    } catch (err) {
      setError(err.message);
    } finally {
      setBooking(false);
    }
  }

  function handleRestart() {
    setStep("search");
    setReservations([]);
    setReservation(null);
    setCatalogItems([]);
    setCatalogMessage("");
    setCart({});
    setOrderResult(null);
    setError("");
  }

  const isWideStep = step === "catalog";

  return (
    <div className="guest-shell min-h-screen bg-white">
      <main
        className={`mx-auto px-4 py-8 sm:px-6 sm:py-12 ${
          isWideStep ? "max-w-3xl lg:max-w-5xl" : "max-w-lg"
        }`}
      >
        <header className="mb-8 text-left">
          <h1 className="text-2xl font-semibold text-stone-900 sm:text-3xl">Deine Extras</h1>
          <p className="mt-2 text-sm text-stone-500 sm:text-base">
            Füge ganz bequem Zusatzleistungen zu Deiner Reservierung hinzu.
          </p>
        </header>

        {step === "search" && <SearchForm onSubmit={handleSearch} loading={loading} error={error} />}

        {step === "select-reservation" && (
          <ReservationPicker reservations={reservations} onSelect={(r) => loadCatalog(r, lastName)} />
        )}

        {step === "catalog" && (
          <>
            {error && <p className={`mb-4 ${ERROR_BANNER}`}>{error}</p>}
            {catalogMessage ? (
              <p className={NOTICE_BANNER}>{catalogMessage}</p>
            ) : (
              <CatalogView
                items={catalogItems}
                cart={cart}
                setCart={setCart}
                onBook={handleBook}
                booking={booking}
                guestName={guestName}
                setGuestName={setGuestName}
              />
            )}
          </>
        )}

        {step === "confirmation" && orderResult && (
          <Confirmation result={orderResult} onRestart={handleRestart} />
        )}
      </main>
    </div>
  );
}
