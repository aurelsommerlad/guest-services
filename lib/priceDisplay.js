// Presentation-only helpers for the guest-facing price display. These are
// deliberately dependency-free (no imports of other lib/* files) so they
// can be shared verbatim between server code (lib/guest.js) and the client
// component (components/guest/GuestApp.jsx) — the same reason lib/format.js
// is shared that way — and so they can be unit-tested directly with plain
// `node --test`, without pulling in lib/db.js's KV/Redis setup.
//
// bookingRule controls booking/date/quantity behavior (see lib/guest.js's
// resolveRequiredDates). priceUnitLabel controls ONLY how the unit price is
// described to the guest. Nothing here feeds back into booking logic,
// Apaleo service dates, or order creation.

// Unchanged (German, the original/default) — kept as its own flat export so
// every existing call site and test keeps working exactly as before.
export const DEFAULT_PRICE_UNIT_LABELS = {
  per_night: "pro Nacht",
  per_stay: "pro Aufenthalt",
  arrival_day: "einmalig",
  departure_day: "einmalig",
};

export const DEFAULT_PRICE_UNIT_LABELS_EN = {
  per_night: "per night",
  per_stay: "per stay",
  arrival_day: "one-time",
  departure_day: "one-time",
};

const DEFAULT_PRICE_UNIT_LABELS_BY_LANGUAGE = {
  de: DEFAULT_PRICE_UNIT_LABELS,
  en: DEFAULT_PRICE_UNIT_LABELS_EN,
};

/**
 * Resolves the guest-facing unit price label: the admin's custom text if
 * set, otherwise a sensible default for the booking rule in the requested
 * language. `language` is optional and defaults to "de", so every existing
 * 2-argument call site behaves exactly as before.
 */
export function resolvePriceUnitLabel(bookingRule, priceUnitLabel, language = "de") {
  const trimmed = typeof priceUnitLabel === "string" ? priceUnitLabel.trim() : "";
  if (trimmed) return trimmed;
  const table = DEFAULT_PRICE_UNIT_LABELS_BY_LANGUAGE[language] || DEFAULT_PRICE_UNIT_LABELS;
  return table[bookingRule] || "";
}

/**
 * Computes the guest-facing "unit × nights × count = total" breakdown for
 * the currently selected quantity. Returns null whenever there's nothing
 * to break down: no quantity selected yet (count 0), or a single unit of a
 * single-night item (nights and count both 1 — the unit price already IS
 * the total, so a second line would be redundant).
 *
 * `price` is the server-computed price for ONE count of the item (unit
 * price × nights, already rounded) — this function only multiplies that
 * by the guest-selected count; it never recomputes nights or dates.
 */
export function computePriceBreakdown({ unitPrice, nights, price, count }) {
  if (!(count >= 1) || !(nights > 1 || count > 1) || !price) {
    return null;
  }
  const total =
    count > 1 ? { amount: Math.round(price.amount * count * 100) / 100, currency: price.currency } : price;
  return {
    unitPrice,
    nights: nights > 1 ? nights : null,
    count: count > 1 ? count : null,
    total,
  };
}
