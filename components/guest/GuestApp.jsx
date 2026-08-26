"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { formatDate, formatPrice } from "@/lib/format";
import { computePriceBreakdown } from "@/lib/priceDisplay";
import { LANGUAGES, DEFAULT_LANGUAGE, t, translateExtraCount } from "@/lib/i18n";

const LANGUAGE_STORAGE_KEY = "guestLanguage";

// Shared style tokens for the guest-facing frontend only — kept local to
// this file (the only place these components live) rather than duplicated
// per component. Colors/radii intentionally reuse Tailwind's stock warm
// "stone" neutral scale instead of inventing new hex values, since the
// reference site (unique-places.com) is blocked by this environment's
// network egress policy and couldn't be inspected directly for exact
// values — stone-50/100/200 approximate its beige framing, stone-900/black
// its dark text and primary buttons. See app/globals.css for the fonts.
const PRIMARY_BUTTON =
  "inline-flex w-full items-center justify-center rounded-md bg-stone-900 px-6 py-3.5 text-sm font-semibold uppercase tracking-wide text-white transition hover:bg-black disabled:cursor-not-allowed disabled:opacity-50";
const SECONDARY_BUTTON =
  "inline-flex items-center justify-center rounded-md border border-stone-300 bg-white px-5 py-2.5 text-sm font-medium uppercase tracking-wide text-stone-700 transition hover:border-stone-400 hover:bg-stone-50";
const INPUT_CLASS =
  "w-full rounded-md border border-stone-300 bg-white px-4 py-3 text-[15px] text-stone-900 placeholder:text-stone-400 focus:border-stone-900 focus:outline-none focus:ring-1 focus:ring-stone-900";
const ERROR_BANNER = "rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700";
const NOTICE_BANNER = "rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800";
const LABEL_CLASS = "block text-sm font-medium text-stone-700";
// Josefin Sans (weight 400) for headings/titles — see app/globals.css.
const HEADING_CLASS = "guest-heading";

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

// Guards against a real hydration race: <img error> is a non-bubbling DOM
// event, so if the request 404s (as it will until the logo asset is added)
// before React finishes hydrating, a plain onError handler can miss it
// entirely and leave a broken-image glyph on screen permanently. Checking
// img.complete/naturalWidth once after mount catches that already-failed
// case; onError still covers a request that fails after hydration.
function BrandLogo({ src, alt, className }) {
  const [visible, setVisible] = useState(true);
  const imgRef = useRef(null);

  useEffect(() => {
    const img = imgRef.current;
    if (img && img.complete && img.naturalWidth === 0) {
      setVisible(false);
    }
  }, []);

  if (!visible) return null;
  return (
    <img
      ref={imgRef}
      src={src}
      alt={alt}
      className={className}
      onError={() => setVisible(false)}
    />
  );
}

// "DE | EN" — minimal, monochrome, no dropdown chrome, matching the rest
// of the guest-facing design system (black/grey, no blue). Placed directly
// below the centered logo.
function LanguageSwitcher({ language, onChange }) {
  return (
    <div className="flex items-center justify-center gap-2 text-xs font-medium uppercase tracking-wide text-stone-400">
      {LANGUAGES.map((lang, i) => (
        <span key={lang} className="flex items-center gap-2">
          {i > 0 && <span aria-hidden="true">|</span>}
          <button
            type="button"
            onClick={() => onChange(lang)}
            aria-pressed={language === lang}
            className={`transition hover:text-stone-700 ${language === lang ? "text-stone-900" : ""}`}
          >
            {lang.toUpperCase()}
          </button>
        </span>
      ))}
    </div>
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

function SearchForm({ language, onSubmit, loading, error }) {
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
          {t(language, "searchNumberLabel")}
        </label>
        <input
          id="number"
          type="text"
          required
          value={number}
          onChange={(e) => setNumber(e.target.value)}
          className={`mt-1.5 ${INPUT_CLASS}`}
          placeholder={t(language, "searchNumberPlaceholder")}
          autoComplete="off"
        />
        <p className="mt-1 text-xs text-stone-400">{t(language, "searchNumberHelperText")}</p>
      </div>
      <div>
        <label className={LABEL_CLASS} htmlFor="lastName">
          {t(language, "searchLastNameLabel")}
        </label>
        <input
          id="lastName"
          type="text"
          required
          value={lastName}
          onChange={(e) => setLastName(e.target.value)}
          className={`mt-1.5 ${INPUT_CLASS}`}
          placeholder={t(language, "searchLastNamePlaceholder")}
          autoComplete="off"
        />
      </div>
      {error && <p className={ERROR_BANNER}>{error}</p>}
      <button type="submit" disabled={loading} className={PRIMARY_BUTTON}>
        {loading ? t(language, "searchButtonLoading") : t(language, "searchButton")}
      </button>
    </form>
  );
}

function ReservationPicker({ language, reservations, onSelect }) {
  return (
    <div className="space-y-3">
      <p className="text-sm text-stone-600">{t(language, "multipleReservationsHint")}</p>
      {reservations.map((r) => (
        <button
          key={r.id}
          onClick={() => onSelect(r)}
          className="block w-full rounded-md border border-stone-200 bg-white px-4 py-3 text-left transition hover:border-stone-400"
        >
          <div className="font-semibold text-stone-900">
            {t(language, "reservationLabel")} {r.id}
          </div>
          <div className="text-sm text-stone-500">
            {formatDate(r.arrival, language)} – {formatDate(r.departure, language)}
          </div>
        </button>
      ))}
    </div>
  );
}

function InstantCatalogItem({ item, language, count, onChange }) {
  const restricted = item.unitGroupRestricted;
  // The unit price + its label in the top-right corner never changes with
  // quantity — only this optional breakdown line, shown once the guest has
  // selected at least one unit, reflects nights/quantity multiplication.
  const breakdown = computePriceBreakdown({
    unitPrice: item.unitPrice,
    nights: item.nights,
    price: item.price,
    count,
  });
  const displayName = item.displayName[language];
  const description = item.description[language];
  const priceUnitLabel = item.priceUnitLabel[language];

  return (
    <div className="flex flex-col gap-4 rounded-lg border border-stone-200 bg-white p-4 sm:flex-row sm:items-center sm:gap-6 sm:p-6">
      <div className="flex items-start gap-4 sm:flex-1 sm:items-center sm:gap-6">
        <div className="h-16 w-16 flex-shrink-0 overflow-hidden rounded-md bg-stone-100 sm:h-20 sm:w-20">
          {item.imageUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={item.imageUrl} alt={displayName} className="h-full w-full object-cover" />
          ) : (
            <div className="flex h-full w-full items-center justify-center">
              <DefaultItemIcon />
            </div>
          )}
        </div>
        <div className="min-w-0 flex-1">
          <h3 className={`${HEADING_CLASS} text-base text-stone-900 sm:text-lg`}>{displayName}</h3>
          {description && <p className="mt-1 text-sm text-stone-500">{description}</p>}
          {restricted ? (
            <p className="mt-2 text-xs font-medium text-amber-700 sm:text-sm">
              {t(language, "unitGroupRestrictedMessage")}
            </p>
          ) : (
            breakdown && (
              <p className="mt-2 text-xs text-stone-500 sm:text-sm">
                {formatPrice(breakdown.unitPrice, language)}
                {breakdown.nights && ` × ${breakdown.nights} ${t(language, "nights")}`}
                {breakdown.count && ` × ${breakdown.count}`}
                {" = "}
                {formatPrice(breakdown.total, language)}
              </p>
            )
          )}
        </div>
      </div>

      <div className="flex items-center justify-between gap-4 sm:flex-shrink-0 sm:flex-col sm:items-end sm:gap-3">
        <div className="text-right">
          <div className="text-lg font-semibold text-stone-900">{formatPrice(item.unitPrice, language)}</div>
          {priceUnitLabel && (
            <div className="text-xs uppercase tracking-wide text-stone-500">{priceUnitLabel}</div>
          )}
        </div>
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => onChange(Math.max(0, count - 1))}
            disabled={count === 0 || restricted}
            className="flex h-9 w-9 items-center justify-center rounded-full border border-stone-300 text-lg font-medium text-stone-600 transition hover:border-stone-400 hover:bg-stone-50 disabled:cursor-not-allowed disabled:opacity-40"
            aria-label={t(language, "decreaseQuantity")}
          >
            –
          </button>
          <span className="w-6 text-center text-base font-medium text-stone-900">{count}</span>
          <button
            type="button"
            onClick={() => onChange(count + 1)}
            disabled={restricted}
            className="flex h-9 w-9 items-center justify-center rounded-full bg-stone-900 text-lg font-medium text-white transition hover:bg-black disabled:cursor-not-allowed disabled:bg-stone-300 disabled:opacity-60"
            aria-label={t(language, "increaseQuantity")}
          >
            +
          </button>
        </div>
      </div>
    </div>
  );
}

function RequestCatalogItem({ item, language, reservationId, lastName, guestName }) {
  // idle -> form -> submitting -> sent, or -> error (back to form)
  const [status, setStatus] = useState("idle");
  const [name, setName] = useState(guestName || "");
  const [email, setEmail] = useState("");
  const [error, setError] = useState("");
  const restricted = item.unitGroupRestricted;
  const displayName = item.displayName[language];
  const description = item.description[language];
  const priceUnitLabel = item.priceUnitLabel[language];

  async function handleSubmit(e) {
    e.preventDefault();
    setStatus("submitting");
    setError("");
    try {
      await postJSON("/api/guest/request", {
        reservationId,
        lastName,
        guestName: name,
        guestEmail: email,
        serviceId: item.serviceId,
        quantity: 1,
        language,
      });
      setStatus("sent");
    } catch (err) {
      setError(err.message);
      setStatus("error");
    }
  }

  return (
    <div className="flex flex-col gap-4 rounded-lg border border-stone-200 bg-white p-4 sm:flex-row sm:items-start sm:gap-6 sm:p-6">
      <div className="flex items-start gap-4 sm:flex-1 sm:gap-6">
        <div className="h-16 w-16 flex-shrink-0 overflow-hidden rounded-md bg-stone-100 sm:h-20 sm:w-20">
          {item.imageUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={item.imageUrl} alt={displayName} className="h-full w-full object-cover" />
          ) : (
            <div className="flex h-full w-full items-center justify-center">
              <DefaultItemIcon />
            </div>
          )}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className={`${HEADING_CLASS} text-base text-stone-900 sm:text-lg`}>{displayName}</h3>
            <span className="rounded-full border border-stone-300 px-2 py-0.5 text-[11px] font-medium uppercase tracking-wide text-stone-500">
              {t(language, "onRequestBadge")}
            </span>
          </div>
          {description && <p className="mt-1 text-sm text-stone-500">{description}</p>}
          {restricted ? (
            <p className="mt-2 text-xs font-medium text-amber-700 sm:text-sm">
              {t(language, "unitGroupRestrictedMessage")}
            </p>
          ) : (
            <p className="mt-2 text-xs text-stone-500 sm:text-sm">{t(language, "requestExplanation")}</p>
          )}
        </div>
      </div>

      <div className="flex flex-col items-stretch gap-3 sm:w-64 sm:flex-shrink-0">
        {item.unitPrice && (
          <div className="text-right">
            <div className="text-lg font-semibold text-stone-900">{formatPrice(item.unitPrice, language)}</div>
            <div className="text-xs uppercase tracking-wide text-stone-500">
              {priceUnitLabel ? `${priceUnitLabel} · ${t(language, "ifConfirmed")}` : t(language, "ifConfirmed")}
            </div>
          </div>
        )}

        {restricted ? (
          <button type="button" disabled className={`${SECONDARY_BUTTON} cursor-not-allowed opacity-40`}>
            {t(language, "requestButton")}
          </button>
        ) : status === "sent" ? (
          <div className="rounded-md border border-stone-200 bg-stone-50 px-3 py-2.5 text-sm text-stone-700">
            <p className="font-medium text-stone-900">{t(language, "requestSentTitle")}</p>
            <p className="mt-0.5 text-xs text-stone-500">{t(language, "requestExplanation")}</p>
          </div>
        ) : status === "form" || status === "submitting" || status === "error" ? (
          <form onSubmit={handleSubmit} className="space-y-2">
            <input
              type="text"
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={t(language, "requestNamePlaceholder")}
              className={`${INPUT_CLASS} py-2 text-sm`}
            />
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder={t(language, "requestEmailPlaceholder")}
              className={`${INPUT_CLASS} py-2 text-sm`}
            />
            {status === "error" && <p className="text-xs text-red-600">{error}</p>}
            <button type="submit" disabled={status === "submitting"} className={`${SECONDARY_BUTTON} w-full`}>
              {status === "submitting" ? t(language, "requestSendingButton") : t(language, "requestSendButton")}
            </button>
          </form>
        ) : (
          <button type="button" onClick={() => setStatus("form")} className={SECONDARY_BUTTON}>
            {t(language, "requestButton")}
          </button>
        )}
      </div>
    </div>
  );
}

function CatalogView({
  items,
  language,
  cart,
  setCart,
  onBook,
  booking,
  guestName,
  setGuestName,
  reservationId,
  lastName,
}) {
  const instantItems = items.filter((item) => (item.fulfillmentMode || "instant") === "instant");
  const requestItems = items.filter((item) => item.fulfillmentMode === "request");

  const { totalCount, totalPrice } = useMemo(() => {
    let count = 0;
    let amount = 0;
    let currency = "EUR";
    for (const item of instantItems) {
      const qty = cart[item.serviceId] || 0;
      if (qty > 0 && item.price) {
        count += qty;
        amount += item.price.amount * qty;
        currency = item.price.currency || currency;
      }
    }
    return { totalCount: count, totalPrice: { amount: Math.round(amount * 100) / 100, currency } };
  }, [instantItems, cart]);

  return (
    <div className="space-y-4 pb-64 sm:pb-56">
      <div className="space-y-3">
        {instantItems.map((item) => (
          <InstantCatalogItem
            key={item.serviceId}
            item={item}
            language={language}
            count={cart[item.serviceId] || 0}
            onChange={(next) => setCart((prev) => ({ ...prev, [item.serviceId]: next }))}
          />
        ))}
        {requestItems.map((item) => (
          <RequestCatalogItem
            key={item.serviceId}
            item={item}
            language={language}
            reservationId={reservationId}
            lastName={lastName}
            guestName={guestName}
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
              placeholder={t(language, "guestNamePlaceholder")}
              className={INPUT_CLASS}
            />
            <div className="flex flex-wrap items-baseline justify-between gap-2 text-sm text-stone-600">
              <span>{translateExtraCount(language, totalCount)}</span>
              <span>
                <span className="font-semibold text-stone-900">
                  {t(language, "totalPriceLabel")} {formatPrice(totalPrice, language)}
                </span>
                <span className="ml-1 text-xs text-stone-500">{t(language, "vatIncluded")}</span>
              </span>
            </div>
            <button onClick={onBook} disabled={booking} className={PRIMARY_BUTTON}>
              {booking ? t(language, "bookingButton") : t(language, "bookNowButton")}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function Confirmation({ language, result, onRestart }) {
  return (
    <div className="space-y-5 text-center sm:text-left">
      <CheckIcon />
      <div>
        <h2 className={`${HEADING_CLASS} text-xl text-stone-900 sm:text-2xl`}>{t(language, "confirmationTitle")}</h2>
        <p className="mt-1 text-stone-600">{t(language, "confirmationBody")}</p>
      </div>
      <ul className="mx-auto max-w-sm space-y-2 text-left sm:mx-0">
        {result.booked.map((item, i) => (
          <li key={i} className="rounded-md border border-stone-200 bg-white px-4 py-3 text-stone-800">
            {item.count}x {item.displayName[language]}
          </li>
        ))}
      </ul>
      {result.failed?.length > 0 && <p className="text-sm text-amber-700">{t(language, "confirmationPartialFailure")}</p>}
      <button onClick={onRestart} className={SECONDARY_BUTTON}>
        {t(language, "restartButton")}
      </button>
    </div>
  );
}

export default function GuestApp() {
  const [language, setLanguageState] = useState(DEFAULT_LANGUAGE);
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

  // Language persistence: an explicit ?lang= wins on first load, otherwise
  // whatever the guest picked on a previous visit (localStorage), otherwise
  // German. Runs once on mount — switching language afterwards never
  // re-triggers this, so it never resets the reservation/cart/step state.
  useEffect(() => {
    let initial = DEFAULT_LANGUAGE;
    try {
      const fromUrl = new URLSearchParams(window.location.search).get("lang");
      const fromStorage = window.localStorage.getItem(LANGUAGE_STORAGE_KEY);
      if (fromUrl && LANGUAGES.includes(fromUrl)) initial = fromUrl;
      else if (fromStorage && LANGUAGES.includes(fromStorage)) initial = fromStorage;
      else initial = DEFAULT_LANGUAGE;
    } catch {
      // localStorage can throw in some private-browsing modes — German
      // default is a perfectly fine fallback.
      initial = DEFAULT_LANGUAGE;
    }
    setLanguageState(initial);
    document.documentElement.lang = initial;
  }, []);

  function setLanguage(next) {
    setLanguageState(next);
    document.documentElement.lang = next;
    try {
      window.localStorage.setItem(LANGUAGE_STORAGE_KEY, next);
    } catch {
      // Not persisting across reloads is fine — the switch still applies
      // immediately for the rest of this session.
    }
  }

  async function loadCatalog(res, name) {
    setLoading(true);
    setError("");
    try {
      const data = await postJSON("/api/guest/catalog", {
        reservationId: res.id,
        lastName: name,
        language,
      });
      if (data.pastStay) {
        setCatalogMessage(t(language, "pastStayMessage"));
        setCatalogItems([]);
      } else if (!data.items.length) {
        setCatalogMessage(t(language, "noItemsMessage"));
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
      const data = await postJSON("/api/guest/lookup", { number, lastName: name, language });
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
        language,
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
        <div className="mb-4 flex justify-center">
          <BrandLogo src="/logo/unique-places-logo.png" alt="Unique Places" className="h-10 w-auto sm:h-12" />
        </div>
        <div className="mb-6 sm:mb-10">
          <LanguageSwitcher language={language} onChange={setLanguage} />
        </div>

        <header className="mb-8 text-left">
          <h1 className={`${HEADING_CLASS} text-2xl text-stone-900 sm:text-3xl`}>{t(language, "pageTitle")}</h1>
          <p className="mt-2 text-sm text-stone-500 sm:text-base">{t(language, "pageSubtitle")}</p>
        </header>

        {step === "search" && (
          <SearchForm language={language} onSubmit={handleSearch} loading={loading} error={error} />
        )}

        {step === "select-reservation" && (
          <ReservationPicker language={language} reservations={reservations} onSelect={(r) => loadCatalog(r, lastName)} />
        )}

        {step === "catalog" && (
          <>
            {error && <p className={`mb-4 ${ERROR_BANNER}`}>{error}</p>}
            {catalogMessage ? (
              <p className={NOTICE_BANNER}>{catalogMessage}</p>
            ) : (
              <CatalogView
                items={catalogItems}
                language={language}
                cart={cart}
                setCart={setCart}
                onBook={handleBook}
                booking={booking}
                guestName={guestName}
                setGuestName={setGuestName}
                reservationId={reservation?.id}
                lastName={lastName}
              />
            )}
          </>
        )}

        {step === "confirmation" && orderResult && (
          <Confirmation language={language} result={orderResult} onRestart={handleRestart} />
        )}
      </main>
    </div>
  );
}
