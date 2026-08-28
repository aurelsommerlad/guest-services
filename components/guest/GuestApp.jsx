"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { formatDate, formatPrice } from "@/lib/format";
import { computePriceBreakdown } from "@/lib/priceDisplay";
import { LANGUAGES, DEFAULT_LANGUAGE, t, translateExtraCount } from "@/lib/i18n";
import { resizeVehiclePlates, hasCompleteVehiclePlates } from "@/lib/vehicleRegistration";

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
// text-base (16px) is intentional, not the original 15px: iOS Safari
// auto-zooms the page on focus for any form control whose computed
// font-size is below 16px. Below that threshold this exact input (the
// reservation-lookup "Buchungsnummer"/"Nachname" fields) is what triggers
// the zoom the guest sees. 16px is the smallest size that avoids it.
const INPUT_CLASS =
  "w-full rounded-md border border-stone-300 bg-white px-4 py-3 text-base text-stone-900 placeholder:text-stone-400 focus:border-stone-900 focus:outline-none focus:ring-1 focus:ring-stone-900";
const ERROR_BANNER = "rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700";
const NOTICE_BANNER = "rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800";
const LABEL_CLASS = "block text-sm font-medium text-stone-700";
// Josefin Sans (weight 400) for headings/titles — see app/globals.css.
const HEADING_CLASS = "guest-heading";

// Blurs whatever form control currently has focus, if any — used right
// before a step transition (see loadCatalog/handleSearch below) so a
// focused input never carries into the next screen.
function blurActiveElement() {
  const active = typeof document !== "undefined" ? document.activeElement : null;
  if (active instanceof HTMLElement && typeof active.blur === "function") {
    active.blur();
  }
}

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

// A minimal thin-stroke arrow connecting arrival → departure — deliberately
// not an emoji/text arrow so the stroke weight/color can match the
// surrounding Roboto 300 date text exactly (currentColor, no fill, no
// circle/background). See ReservationSummary below.
function ArrowIcon() {
  return (
    <svg
      viewBox="0 0 24 10"
      width="22"
      height="10"
      fill="none"
      stroke="currentColor"
      strokeWidth="1"
      className="flex-shrink-0"
      aria-hidden="true"
    >
      <line x1="0" y1="5" x2="19" y2="5" />
      <path d="M14 1 L19 5 L14 9" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

// Compact reservation summary shown once the guest's reservation has been
// identified — property name, guest name, and arrival/departure —
// deliberately restrained (no card, no icons besides the arrow, no labels
// like "Gast"/"Anreise"/"Abreise") so it reads as part of the page rather
// than a generic app widget. `reservation` here is exactly what
// /api/guest/lookup already returned (see lib/reservationSummary.js) — no
// extra request. Adult/child counts are intentionally not shown here (the
// reservation object still carries them for the rest of the app, e.g.
// capacity checks — this component just doesn't render that field).
function ReservationSummary({ language, reservation }) {
  if (!reservation) return null;
  const { propertyName, guestName, arrival, departure } = reservation;

  return (
    <div className="mb-8 space-y-1.5 text-center sm:text-left">
      {propertyName && (
        <p className={`${HEADING_CLASS} break-words text-lg text-stone-900 sm:text-xl`}>{propertyName}</p>
      )}
      {guestName && <p className="break-words text-sm font-medium text-stone-600">{guestName}</p>}
      <div className="flex items-center justify-center gap-2 text-sm text-stone-500 sm:justify-start">
        <span>{formatDate(arrival, language)}</span>
        <ArrowIcon />
        <span>{formatDate(departure, language)}</span>
      </div>
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

function InstantCatalogItem({ item, language, count, onChange, plates, onPlateChange }) {
  const restricted = item.unitGroupRestricted;
  // maxQuantity is only ever set for requiresRemainingCapacity items (e.g.
  // "Extra person") — null/undefined for every other item, so this never
  // caps anything that didn't already have a cap before.
  const atMaxQuantity = Number.isFinite(item.maxQuantity) && count >= item.maxQuantity;
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
          <div className="flex items-start justify-between gap-3">
            <h3 className={`${HEADING_CLASS} min-w-0 flex-1 break-words text-base text-stone-900 sm:text-lg`}>
              {displayName}
            </h3>
            <div className="w-24 flex-shrink-0 text-right sm:w-auto">
              <div className="text-lg font-semibold text-stone-900">{formatPrice(item.unitPrice, language)}</div>
              {priceUnitLabel && (
                <div className="break-words text-xs font-light uppercase tracking-normal text-stone-400 sm:text-[13px]">
                  {priceUnitLabel}
                </div>
              )}
            </div>
          </div>
          {description && <p className="mt-1 break-words text-sm text-stone-500">{description}</p>}
          {restricted ? (
            <p className="mt-2 break-words text-xs font-medium text-amber-700 sm:text-sm">
              {t(language, "unitGroupRestrictedMessage")}
            </p>
          ) : (
            breakdown && (
              <p className="mt-2 break-words text-xs text-stone-500 sm:text-sm">
                {formatPrice(breakdown.unitPrice, language)}
                {breakdown.nights && ` × ${breakdown.nights} ${t(language, "nights")}`}
                {breakdown.count && ` × ${breakdown.count}`}
                {" = "}
                {formatPrice(breakdown.total, language)}
              </p>
            )
          )}
          {!restricted && item.actionType === "increase_occupancy" && count > 0 && (
            <p className="mt-2 break-words text-xs font-medium text-stone-600 sm:text-sm">
              {t(language, "extraPersonAmendmentNotice")}
            </p>
          )}
          {!restricted && item.requiresVehicleRegistration && count > 0 && (
            <div className="mt-3 space-y-2.5">
              {Array.from({ length: count }).map((_, i) => {
                const value = plates?.[i] || "";
                const showRequiredHint = !value.trim();
                return (
                  <div key={i} className="min-w-0">
                    <label className="block break-words text-xs font-medium text-stone-500">
                      {count > 1 ? `${t(language, "licensePlateLabel")} ${i + 1}` : t(language, "licensePlateLabel")}
                    </label>
                    <input
                      type="text"
                      required
                      value={value}
                      onChange={(e) => onPlateChange(i, e.target.value)}
                      placeholder={t(language, "licensePlatePlaceholder")}
                      className={`mt-1 w-full max-w-full rounded-md border border-stone-300 bg-white px-3 py-2 text-base sm:text-sm text-stone-900 placeholder:text-stone-400 focus:border-stone-900 focus:outline-none focus:ring-1 focus:ring-stone-900`}
                    />
                    {showRequiredHint && (
                      <p className="mt-1 break-words text-xs text-amber-700">{t(language, "licensePlateRequiredError")}</p>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      <div className="flex flex-shrink-0 items-center justify-end gap-3">
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
          disabled={restricted || atMaxQuantity}
          className="flex h-9 w-9 items-center justify-center rounded-full bg-stone-900 text-lg font-medium text-white transition hover:bg-black disabled:cursor-not-allowed disabled:bg-stone-300 disabled:opacity-60"
          aria-label={t(language, "increaseQuantity")}
        >
          +
        </button>
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
            <h3 className={`${HEADING_CLASS} break-words text-base text-stone-900 sm:text-lg`}>{displayName}</h3>
            <span className="rounded-full border border-stone-300 px-2 py-0.5 text-[11px] font-medium uppercase tracking-wide text-stone-500">
              {t(language, "onRequestBadge")}
            </span>
          </div>
          {description && <p className="mt-1 break-words text-sm text-stone-500">{description}</p>}
          {restricted ? (
            <p className="mt-2 break-words text-xs font-medium text-amber-700 sm:text-sm">
              {t(language, "unitGroupRestrictedMessage")}
            </p>
          ) : (
            <p className="mt-2 break-words text-xs text-stone-500 sm:text-sm">{t(language, "requestExplanation")}</p>
          )}
        </div>
      </div>

      <div className="flex min-w-0 flex-col items-stretch gap-3 sm:w-64 sm:flex-shrink-0">
        {item.unitPrice && (
          <div className="min-w-0 text-right">
            <div className="text-lg font-semibold text-stone-900">{formatPrice(item.unitPrice, language)}</div>
            <div className="break-words text-xs font-light uppercase tracking-normal text-stone-400 sm:text-[13px]">
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
              className={`${INPUT_CLASS} py-2 text-base sm:text-sm`}
            />
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder={t(language, "requestEmailPlaceholder")}
              className={`${INPUT_CLASS} py-2 text-base sm:text-sm`}
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

// "Stay one more night" upsell — never an Apaleo service and never part of
// the regular extras cart (see lib/stayExtension.js / lib/guest.js): its
// own distinct card with a single confirm action, entirely self-contained
// (same pattern as RequestCatalogItem above), so it can be shown or
// omitted independently of the rest of the catalog's state (empty, past
// stay, etc.).
function StayExtensionCard({ language, offer, reservationId, lastName, onExtended }) {
  // idle -> submitting -> success, or -> error (back to idle)
  const [status, setStatus] = useState("idle");
  const [error, setError] = useState("");

  async function handleConfirm() {
    setStatus("submitting");
    setError("");
    try {
      const data = await postJSON("/api/guest/stay-extension", {
        reservationId,
        lastName,
        currentDeparture: offer.currentDeparture,
        language,
      });
      setStatus("success");
      onExtended(data.newDeparture);
    } catch (err) {
      setError(err.message);
      setStatus("error");
    }
  }

  if (status === "success") {
    return (
      <div className="rounded-lg border border-stone-200 bg-white p-4 sm:p-6">
        <h3 className={`${HEADING_CLASS} break-words text-base text-stone-900 sm:text-lg`}>
          {t(language, "stayExtensionTitle")}
        </h3>
        <p className="mt-2 break-words text-sm text-stone-600">{t(language, "stayExtensionSuccessMessage")}</p>
      </div>
    );
  }

  const extras = offer.extras || [];
  const cityTax = offer.cityTax || null;
  const totalPrice = offer.totalPrice || offer.extensionPrice;
  // Only shown when there's actually something to itemize — a reservation
  // with no extendable extras and no city tax just shows the simple
  // regular-price/total-price footer, same as before.
  const hasBreakdown = extras.length > 0 || Boolean(cityTax);

  return (
    <div className="rounded-lg border border-stone-200 bg-white p-4 sm:p-6">
      <h3 className={`${HEADING_CLASS} break-words text-base text-stone-900 sm:text-lg`}>
        {t(language, "stayExtensionTitle")}
      </h3>
      <p className="mt-1 break-words text-sm text-stone-500">{t(language, "stayExtensionSubtitle")}</p>

      <div className="mt-4">
        <p className="break-words text-xs uppercase tracking-wide text-stone-400">
          {t(language, "stayExtensionNewDepartureLabel")}
        </p>
        <p className="break-words text-sm font-medium text-stone-900">{formatDate(offer.newDeparture, language)}</p>
      </div>

      {hasBreakdown && (
        <div className="mt-4 space-y-1.5 rounded-md bg-stone-50 p-3 text-sm">
          <div className="flex items-center justify-between gap-2">
            <span className="break-words text-stone-700">{t(language, "stayExtensionAccommodationLabel")}</span>
            <span className="flex items-center gap-2">
              <span className="whitespace-nowrap rounded bg-emerald-100 px-1.5 py-0.5 text-xs font-medium text-emerald-700">
                {offer.discountPercent}
                {t(language, "stayExtensionDiscountSuffix")}
              </span>
              <span className="whitespace-nowrap font-medium text-stone-900">
                {formatPrice(offer.extensionPrice, language)}
              </span>
            </span>
          </div>
          {extras.map((extra) => (
            <div key={extra.serviceId} className="flex items-center justify-between gap-2">
              <span className="break-words text-stone-700">{extra.name?.[language] || extra.name?.de}</span>
              <span className="whitespace-nowrap text-stone-900">{formatPrice(extra.amount, language)}</span>
            </div>
          ))}
          {cityTax && (
            <div className="flex items-center justify-between gap-2">
              <span className="break-words text-stone-700">{t(language, "stayExtensionCityTaxLabel")}</span>
              <span className="whitespace-nowrap text-stone-900">{formatPrice(cityTax, language)}</span>
            </div>
          )}
          <div className="flex items-center justify-between gap-2 border-t border-stone-200 pt-1.5 font-semibold">
            <span className="break-words text-stone-900">{t(language, "stayExtensionTotalLabel")}</span>
            <span className="whitespace-nowrap text-stone-900">{formatPrice(totalPrice, language)}</span>
          </div>
        </div>
      )}

      <div className="mt-4 flex flex-wrap items-end justify-between gap-4">
        <div className="min-w-0">
          <p className="break-words text-xs uppercase tracking-wide text-stone-400">
            {t(language, "stayExtensionAverageRateLabel")}
          </p>
          <p className="break-words text-sm font-medium text-stone-500 line-through">
            {formatPrice(offer.averageNightlyRate, language)}
          </p>
        </div>
        <div className="min-w-0 text-right">
          <p className="break-words text-xs uppercase tracking-wide text-stone-400">
            {t(language, "stayExtensionPriceLabel")}
          </p>
          <p className="break-words text-2xl font-semibold text-stone-900">{formatPrice(totalPrice, language)}</p>
          {!hasBreakdown && (
            <p className="mt-0.5 break-words text-xs font-medium text-stone-600">
              {offer.discountPercent}
              {t(language, "stayExtensionDiscountSuffix")}
            </p>
          )}
        </div>
      </div>

      {error && <p className="mt-3 break-words text-sm text-red-600">{error}</p>}

      <button
        type="button"
        onClick={handleConfirm}
        disabled={status === "submitting"}
        className={`${PRIMARY_BUTTON} mt-4`}
      >
        {status === "submitting" ? t(language, "stayExtensionButtonLoading") : t(language, "stayExtensionButton")}
      </button>
    </div>
  );
}

function CatalogView({
  items,
  language,
  cart,
  onQuantityChange,
  vehiclePlates,
  onPlateChange,
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

  // Booking-safety gate mirrored server-side (see lib/guest.js's
  // placeGuestOrder / lib/vehicleRegistration.js) — this is guest-side
  // convenience only, never the authoritative check.
  const hasIncompletePlates = instantItems.some((item) => {
    if (!item.requiresVehicleRegistration) return false;
    const count = cart[item.serviceId] || 0;
    return !hasCompleteVehiclePlates(vehiclePlates[item.serviceId], count);
  });

  return (
    <div className="space-y-4 pb-64 sm:pb-56">
      <div className="space-y-3">
        {instantItems.map((item) => (
          <InstantCatalogItem
            key={item.serviceId}
            item={item}
            language={language}
            count={cart[item.serviceId] || 0}
            onChange={(next) => onQuantityChange(item, next)}
            plates={vehiclePlates[item.serviceId]}
            onPlateChange={(index, value) => onPlateChange(item.serviceId, index, value)}
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
        <div className="fixed inset-x-0 bottom-0 w-full max-w-full border-t border-stone-200 bg-stone-50/97 backdrop-blur">
          <div className="mx-auto max-w-3xl space-y-3 px-5 py-4 sm:px-6 sm:py-5 lg:max-w-5xl">
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
            <button onClick={onBook} disabled={booking || hasIncompletePlates} className={PRIMARY_BUTTON}>
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
          <li key={i} className="break-words rounded-md border border-stone-200 bg-white px-4 py-3 text-stone-800">
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
  // "Stay one more night" upsell — null whenever no valid offer exists (see
  // lib/guest.js's getStayExtensionOffer); shown independently of
  // catalogItems/catalogMessage, since it's never an Apaleo service.
  const [extensionOffer, setExtensionOffer] = useState(null);
  const [cart, setCart] = useState({});
  // { [serviceId]: string[] } — only populated for requiresVehicleRegistration
  // items (e.g. parking); see lib/vehicleRegistration.js.
  const [vehiclePlates, setVehiclePlates] = useState({});
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
    // Defensive: on iOS Safari, an input left focused while the page
    // transitions away from it can keep the visual viewport in whatever
    // zoom state that input's focus put it in. The lookup inputs are fixed
    // to 16px now (see INPUT_CLASS), which is the actual fix — this blur is
    // just belt-and-braces so the keyboard/zoom settle immediately rather
    // than lingering through the transition to the Extras page.
    blurActiveElement();
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
      setExtensionOffer(data.extensionOffer || null);
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
    // See loadCatalog's matching comment — closes the keyboard and lets any
    // iOS zoom state settle right away on submit, instead of carrying it
    // through to whichever step comes next.
    blurActiveElement();
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

  // Keeps cart quantity and per-item license-plate fields in lockstep — see
  // lib/vehicleRegistration.js's resizeVehiclePlates for the exact
  // preserve/grow/shrink rules (pre-fills index 0 from the reservation's
  // existing plate, drops trailing entries safely on a lower quantity).
  function handleQuantityChange(item, next) {
    setCart((prev) => ({ ...prev, [item.serviceId]: next }));
    if (item.requiresVehicleRegistration) {
      setVehiclePlates((prev) => ({
        ...prev,
        [item.serviceId]: resizeVehiclePlates(prev[item.serviceId], next, item.existingVehicleRegistration),
      }));
    }
  }

  function handlePlateChange(serviceId, index, value) {
    setVehiclePlates((prev) => {
      const next = [...(prev[serviceId] || [])];
      next[index] = value;
      return { ...prev, [serviceId]: next };
    });
  }

  async function handleBook() {
    const lines = Object.entries(cart)
      .filter(([, count]) => count > 0)
      .map(([serviceId, count]) => {
        const item = catalogItems.find((i) => i.serviceId === serviceId);
        const line = { serviceId, count };
        if (item?.requiresVehicleRegistration) {
          line.vehiclePlates = (vehiclePlates[serviceId] || []).map((p) => p.trim());
        }
        return line;
      });
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
    setExtensionOffer(null);
    setCart({});
    setVehiclePlates({});
    setOrderResult(null);
    setError("");
  }

  // Reflects the new departure immediately (the reservation summary at the
  // top of the page). Deliberately does NOT clear extensionOffer: the card
  // stays mounted so its own "success" state (see StayExtensionCard) can
  // render in place of the form/button — clearing it here would unmount
  // the card before the guest ever saw a confirmation. A second night
  // would need its own fresh offer computed from the new state (this
  // session doesn't reload automatically), but the card's own status
  // already makes re-submission impossible without that reload.
  function handleStayExtended(newDeparture) {
    setReservation((prev) => (prev ? { ...prev, departure: newDeparture } : prev));
  }

  const isWideStep = step === "catalog";

  return (
    <div className="guest-shell min-h-screen w-full max-w-full bg-white">
      <main
        className={`mx-auto w-full max-w-full px-5 py-8 sm:px-6 sm:py-12 ${
          isWideStep ? "max-w-3xl lg:max-w-5xl" : "max-w-lg"
        }`}
      >
        <div className="mb-4 flex justify-center">
          <BrandLogo src="/logo/unique-places-logo.png" alt="Unique Places" className="h-10 w-auto sm:h-12" />
        </div>
        <div className="mb-6 sm:mb-10">
          <LanguageSwitcher language={language} onChange={setLanguage} />
        </div>

        <ReservationSummary language={language} reservation={reservation} />

        <header className="mb-8 text-left">
          <h1 className={`${HEADING_CLASS} break-words text-2xl text-stone-900 sm:text-3xl`}>
            {t(language, "pageTitle")}
          </h1>
          <p className="mt-2 break-words text-sm text-stone-500 sm:text-base">{t(language, "pageSubtitle")}</p>
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
            {extensionOffer && (
              <div className="mb-4">
                <StayExtensionCard
                  language={language}
                  offer={extensionOffer}
                  reservationId={reservation?.id}
                  lastName={lastName}
                  onExtended={handleStayExtended}
                />
              </div>
            )}
            {catalogMessage ? (
              <p className={NOTICE_BANNER}>{catalogMessage}</p>
            ) : (
              <CatalogView
                items={catalogItems}
                language={language}
                cart={cart}
                onQuantityChange={handleQuantityChange}
                vehiclePlates={vehiclePlates}
                onPlateChange={handlePlateChange}
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
