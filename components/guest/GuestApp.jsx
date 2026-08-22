"use client";

import { useMemo, useState } from "react";
import { formatDate, formatPrice } from "@/lib/format";

const PAST_STAY_MESSAGE =
  "Diese Reservierung liegt bereits in der Vergangenheit. Über das Portal können daher keine weiteren Extras mehr gebucht werden – bitte wenden Sie sich an die Rezeption.";
const NO_ITEMS_MESSAGE = "Für Ihre Reservierung sind aktuell keine Extras verfügbar.";

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

function SearchForm({ onSubmit, loading, error }) {
  const [number, setNumber] = useState("");
  const [lastName, setLastName] = useState("");

  return (
    <form
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit({ number, lastName });
      }}
    >
      <div>
        <label className="block text-sm font-medium text-slate-700" htmlFor="number">
          Reservierungs- oder Buchungsnummer
        </label>
        <input
          id="number"
          type="text"
          required
          value={number}
          onChange={(e) => setNumber(e.target.value)}
          className="mt-1 w-full rounded-lg border border-slate-300 px-4 py-3 text-base shadow-sm focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-200"
          placeholder="z. B. 1234567"
          autoComplete="off"
        />
      </div>
      <div>
        <label className="block text-sm font-medium text-slate-700" htmlFor="lastName">
          Nachname
        </label>
        <input
          id="lastName"
          type="text"
          required
          value={lastName}
          onChange={(e) => setLastName(e.target.value)}
          className="mt-1 w-full rounded-lg border border-slate-300 px-4 py-3 text-base shadow-sm focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-200"
          placeholder="Nachname des Gastes"
          autoComplete="off"
        />
      </div>
      {error && (
        <p className="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">{error}</p>
      )}
      <button
        type="submit"
        disabled={loading}
        className="w-full rounded-lg bg-brand-600 px-4 py-3 text-base font-semibold text-white shadow-sm transition hover:bg-brand-700 disabled:opacity-60"
      >
        {loading ? "Wird gesucht…" : "Reservierung finden"}
      </button>
    </form>
  );
}

function ReservationPicker({ reservations, onSelect }) {
  return (
    <div className="space-y-3">
      <p className="text-sm text-slate-600">
        Wir haben mehrere Reservierungen gefunden. Bitte wählen Sie die passende aus:
      </p>
      {reservations.map((r) => (
        <button
          key={r.id}
          onClick={() => onSelect(r)}
          className="block w-full rounded-lg border border-slate-200 bg-white px-4 py-3 text-left shadow-sm transition hover:border-brand-400 hover:shadow"
        >
          <div className="font-semibold text-slate-800">Reservierung {r.id}</div>
          <div className="text-sm text-slate-500">
            {formatDate(r.arrival)} – {formatDate(r.departure)}
          </div>
        </button>
      ))}
    </div>
  );
}

function CatalogItem({ item, count, onChange }) {
  return (
    <div className="flex gap-4 rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="h-20 w-20 flex-shrink-0 overflow-hidden rounded-lg bg-slate-100">
        {item.imageUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={item.imageUrl} alt={item.displayName} className="h-full w-full object-cover" />
        ) : (
          <div className="flex h-full w-full items-center justify-center text-2xl text-slate-300">
            ✨
          </div>
        )}
      </div>
      <div className="flex-1">
        <div className="flex items-start justify-between gap-2">
          <h3 className="font-semibold text-slate-800">{item.displayName}</h3>
          <span className="whitespace-nowrap font-semibold text-brand-700">
            {formatPrice(item.price)}
          </span>
        </div>
        {item.description && (
          <p className="mt-1 text-sm text-slate-500">{item.description}</p>
        )}
        {item.bookingRule === "per_night" && item.nights > 1 && (
          <p className="mt-1 text-xs text-slate-500">
            {formatPrice(item.unitPrice)} × {item.nights} Nächte = {formatPrice(item.price)}
          </p>
        )}
        <div className="mt-3 flex items-center gap-3">
          <button
            type="button"
            onClick={() => onChange(Math.max(0, count - 1))}
            className="h-9 w-9 rounded-full border border-slate-300 text-lg font-semibold text-slate-600 active:bg-slate-100"
            aria-label="Menge verringern"
          >
            –
          </button>
          <span className="w-6 text-center font-medium">{count}</span>
          <button
            type="button"
            onClick={() => onChange(count + 1)}
            className="h-9 w-9 rounded-full border border-slate-300 text-lg font-semibold text-slate-600 active:bg-slate-100"
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
  const totalCount = useMemo(
    () => Object.values(cart).reduce((sum, c) => sum + c, 0),
    [cart]
  );

  return (
    <div className="space-y-4 pb-28">
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
        <div className="fixed inset-x-0 bottom-0 border-t border-slate-200 bg-white/95 p-4 shadow-lg backdrop-blur">
          <div className="mx-auto max-w-lg space-y-3">
            <input
              type="text"
              value={guestName}
              onChange={(e) => setGuestName(e.target.value)}
              placeholder="Ihr Name (für die Buchung)"
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-200"
            />
            <button
              onClick={onBook}
              disabled={booking}
              className="w-full rounded-lg bg-brand-600 px-4 py-3 text-base font-semibold text-white shadow-sm transition hover:bg-brand-700 disabled:opacity-60"
            >
              {booking ? "Wird gebucht…" : `${totalCount} Extra${totalCount > 1 ? "s" : ""} jetzt buchen`}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function Confirmation({ result, onRestart }) {
  return (
    <div className="space-y-4 text-center">
      <div className="text-5xl">✅</div>
      <h2 className="text-xl font-semibold text-slate-800">Vielen Dank!</h2>
      <p className="text-slate-600">Ihre Extras wurden erfolgreich zu Ihrer Buchung hinzugefügt:</p>
      <ul className="mx-auto max-w-sm space-y-2 text-left">
        {result.booked.map((item, i) => (
          <li key={i} className="rounded-lg border border-slate-200 bg-white px-4 py-2">
            {item.count}x {item.displayName}
          </li>
        ))}
      </ul>
      {result.failed?.length > 0 && (
        <p className="text-sm text-amber-700">
          Einige Positionen konnten nicht gebucht werden – bitte wenden Sie sich für diese an die
          Rezeption.
        </p>
      )}
      <button
        onClick={onRestart}
        className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100"
      >
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

  return (
    <main className="mx-auto min-h-screen max-w-lg px-4 py-8 sm:py-12">
      <header className="mb-6 text-center">
        <h1 className="text-2xl font-bold text-slate-800">Ihre Extras</h1>
        <p className="mt-1 text-sm text-slate-500">
          Fügen Sie ganz bequem Zusatzleistungen zu Ihrer Reservierung hinzu.
        </p>
      </header>

      {step === "search" && <SearchForm onSubmit={handleSearch} loading={loading} error={error} />}

      {step === "select-reservation" && (
        <ReservationPicker
          reservations={reservations}
          onSelect={(r) => loadCatalog(r, lastName)}
        />
      )}

      {step === "catalog" && (
        <>
          {error && (
            <p className="mb-4 rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">{error}</p>
          )}
          {catalogMessage ? (
            <p className="rounded-lg bg-amber-50 px-4 py-3 text-sm text-amber-800">
              {catalogMessage}
            </p>
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
  );
}
