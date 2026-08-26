// Dependency-free (see lib/priceDisplay.js / lib/capacity.js for why) — the
// core, safety-critical computation behind "Extra person"/"Zusatzperson"
// catalog items (actionType "increase_occupancy"): building the guest-facing
// price and the exact AmendReservation payload. Kept pure and separate from
// lib/apaleo.js/lib/guest.js so both are directly unit-testable with plain
// `node --test`, without live Apaleo access.
//
// Verified live against a disposable test reservation before this was
// implemented (see the investigation for this feature): AmendReservation's
// `timeSlices[].totalGrossAmount` is an explicit override, honored exactly
// as sent with `requote: false` — Apaleo does not reprice on top of it.
// Adding `extraPersonPricePerNight × additionalPersonCount` to each
// existing slice's totalGrossAmount, while resending its original
// ratePlanId unchanged, adds exactly that surcharge and nothing else.

import { getAdultsCount } from "./occupancy.js";

function round2(amount) {
  return Math.round(amount * 100) / 100;
}

/**
 * The guest-facing unit price / total price for an "Extra person" catalog
 * item — deliberately the same shape (`{amount, currency}` for unitPrice,
 * and a per-person stay total for `price`) as every other per_night item,
 * so the existing computePriceBreakdown / InstantCatalogItem rendering
 * ("30,00 € × 4 Nächte × 2 = 240,00 €") needs no changes at all.
 */
export function buildExtraPersonPricing({ pricePerNight, nights, currency = "EUR" }) {
  const price = Number(pricePerNight);
  if (!Number.isFinite(price) || price < 0 || !Number.isFinite(nights) || nights <= 0) {
    return null;
  }
  return {
    unitPrice: { amount: price, currency },
    nights,
    price: { amount: round2(price * nights), currency },
  };
}

/**
 * Builds the exact AmendReservation body for adding `additionalPersonCount`
 * guests: same arrival/departure/childrenAges as the current reservation,
 * adults increased by additionalPersonCount, and every existing time slice
 * resent with its original ratePlanId plus its totalGrossAmount increased
 * by `extraPersonPricePerNight × additionalPersonCount` — never a full
 * reprice. `timeSlices` must be the reservation's *current*,
 * freshly-fetched time slices (see lib/apaleo.js's
 * getReservationWithTimeSlices) — never a cached/stale snapshot, per the
 * booking-safety requirement that this is re-derived immediately before
 * the actual amendment.
 *
 * Returns null if the input is missing what's needed to safely build a
 * complete, correct payload (e.g. a time slice with no ratePlan.id) —
 * callers must treat that as "refuse, don't amend" rather than guessing.
 */
export function buildOccupancyAmendmentPayload({ reservation, timeSlices, extraPersonPricePerNight, additionalPersonCount }) {
  const price = Number(extraPersonPricePerNight);
  const count = Number(additionalPersonCount);
  if (!Number.isFinite(price) || price < 0) return null;
  if (!Number.isInteger(count) || count <= 0) return null;
  if (!reservation?.arrival || !reservation?.departure) return null;
  if (!Array.isArray(timeSlices) || !timeSlices.length) return null;

  const nextTimeSlices = [];
  for (const slice of timeSlices) {
    const ratePlanId = slice?.ratePlan?.id;
    const currentAmount = Number(slice?.totalGrossAmount?.amount);
    if (!ratePlanId || !Number.isFinite(currentAmount)) return null;
    nextTimeSlices.push({
      ratePlanId,
      totalGrossAmount: {
        amount: round2(currentAmount + price * count),
        currency: slice?.totalGrossAmount?.currency || "EUR",
      },
    });
  }

  return {
    arrival: reservation.arrival,
    departure: reservation.departure,
    adults: getAdultsCount(reservation) + count,
    childrenAges: Array.isArray(reservation.childrenAges) ? reservation.childrenAges : null,
    timeSlices: nextTimeSlices,
    requote: false,
  };
}
