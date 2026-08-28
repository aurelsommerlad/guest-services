// Dependency-free (see lib/occupancyAmendment.js / lib/priceDisplay.js for
// why) — the core, safety-critical computation behind the "Stay one more
// night" upsell ("Eine Nacht länger bleiben"): deciding whether a one-night
// extension should be offered at all, its price, and the exact
// AmendReservation payload. Kept pure and separate from lib/apaleo.js/
// lib/guest.js so it's directly unit-testable with plain `node --test`,
// without live Apaleo access.
//
// This is NEVER booked as an Apaleo service — it amends the reservation's
// actual departure date (see buildStayExtensionAmendmentPayload below),
// mirroring the same AmendReservation approach already verified live for
// "Extra person"/"Zusatzperson" (see lib/occupancyAmendment.js): every
// existing time slice is resent unchanged with `requote: false`, so Apaleo
// never reprices the existing nights — only the newly appended slice for
// the extension night carries our own calculated price.

import { getAdultsCount } from "./occupancy.js";

function round2(amount) {
  return Math.round(amount * 100) / 100;
}

/** "2026-09-13" (or a full ISO timestamp) -> "2026-09-14". Pure UTC date-only arithmetic, no DST ambiguity. */
export function addOneDay(dateStr) {
  if (!dateStr) return null;
  const datePart = String(dateStr).slice(0, 10);
  const d = new Date(`${datePart}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return null;
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

/**
 * The average accommodation nightly price of the reservation's *existing*
 * stay, from its current Apaleo timeSlices — never including services
 * (parking, dog, baby cot, early/late check-in/out, ...), since those are a
 * completely separate Apaleo structure (see lib/apaleo.js's
 * getReservationServices vs. getReservationWithTimeSlices/
 * getReservationForExtension) and never appear inside timeSlices at all.
 * Rounded to EUR cents — this rounded value is itself what's shown to the
 * guest as "Ø Übernachtungspreis" / "Average nightly rate", so the
 * extension-price calculation below must be based on this already-rounded
 * number, not the raw average, to match exactly what the guest sees.
 */
export function computeAverageNightlyRate(timeSlices) {
  if (!Array.isArray(timeSlices) || !timeSlices.length) return null;
  let sum = 0;
  for (const slice of timeSlices) {
    const amount = Number(slice?.totalGrossAmount?.amount);
    if (!Number.isFinite(amount)) return null;
    sum += amount;
  }
  return round2(sum / timeSlices.length);
}

/**
 * The offer/no-offer decision. We generally do not sell 1-night stays, so a
 * one-night extension must never create a new, isolated, unsellable gap:
 *
 *   gap == 0                        -> no offer (nothing free right after departure)
 *   gap == 1                        -> offer (closes the gap entirely) at discountOneNightGap
 *   1 < gap <= minSellableStayNights -> no offer (would leave an unsellable remainder)
 *   gap > minSellableStayNights      -> offer (remainder is still sellable) at discountStandard
 *
 * `minSellableStayNights` is property-configurable (see lib/store.js's
 * getExtensionConfig) specifically so this boundary can move later without
 * a code change — it is never hard-coded here beyond the formula itself.
 */
export function decideExtensionOffer({ gap, minSellableStayNights, discountOneNightGap, discountStandard }) {
  const min = Number(minSellableStayNights);
  const oneNightDiscount = Number(discountOneNightGap);
  const standardDiscount = Number(discountStandard);
  if (!Number.isInteger(gap) || gap < 0) return { offer: false, reason: "invalid_gap" };
  if (!Number.isFinite(min) || min < 1) return { offer: false, reason: "invalid_config" };
  if (!Number.isFinite(oneNightDiscount) || !Number.isFinite(standardDiscount)) {
    return { offer: false, reason: "invalid_config" };
  }

  if (gap === 1) return { offer: true, discountPercent: oneNightDiscount, reason: "closes_gap" };
  if (gap > min) return { offer: true, discountPercent: standardDiscount, reason: "remaining_gap_sellable" };
  return { offer: false, reason: gap === 0 ? "no_availability" : "would_leave_unsellable_gap" };
}

/**
 * Assembles the full guest-facing offer (average rate, discounted
 * extension price, new departure date) from an already-fetched reservation
 * + its current timeSlices + the already-determined consecutive-free-night
 * gap (see lib/guest.js's getStayExtensionOffer for how `gap` and
 * `timeSlices` are obtained — both require live Apaleo calls, so this
 * function never fetches anything itself). Returns null whenever no offer
 * should be shown at all, per decideExtensionOffer above.
 */
export function buildExtensionOffer({ reservation, timeSlices, gap, config }) {
  const decision = decideExtensionOffer({
    gap,
    minSellableStayNights: config?.minSellableStayNights,
    discountOneNightGap: config?.extensionDiscountOneNightGap,
    discountStandard: config?.extensionDiscountStandard,
  });
  if (!decision.offer) return null;

  const averageNightlyRate = computeAverageNightlyRate(timeSlices);
  if (averageNightlyRate === null) return null;

  const currentDeparture = reservation?.departure ? String(reservation.departure).slice(0, 10) : null;
  const newDeparture = addOneDay(reservation?.departure);
  if (!currentDeparture || !newDeparture) return null;

  const currency = timeSlices[0]?.totalGrossAmount?.currency || "EUR";
  const extensionPriceAmount = round2(averageNightlyRate * (1 - decision.discountPercent / 100));

  return {
    currentDeparture,
    newDeparture,
    averageNightlyRate: { amount: averageNightlyRate, currency },
    extensionPrice: { amount: extensionPriceAmount, currency },
    discountPercent: decision.discountPercent,
    gap,
  };
}

/**
 * Builds the exact AmendReservation body for a one-night extension: every
 * existing time slice resent verbatim (its original ratePlanId + its exact
 * current totalGrossAmount, completely untouched — see the module header),
 * plus one appended slice for the new night using the already-calculated
 * `extensionPrice` and the reservation's own (unchanged) rate plan.
 * `requote: false` so Apaleo never reprices the existing nights. `adults`/
 * `childrenAges`/`arrival` are preserved from the reservation exactly as
 * they are — this call only ever changes `departure` and the time slice
 * list. Returns null if the input is missing what's needed to safely build
 * a complete, correct payload — callers must treat that as "refuse, don't
 * amend" rather than guessing.
 */
export function buildStayExtensionAmendmentPayload({ reservation, timeSlices, extensionPrice, currency = "EUR" }) {
  const price = Number(extensionPrice);
  if (!Number.isFinite(price) || price < 0) return null;
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
        amount: currentAmount,
        currency: slice?.totalGrossAmount?.currency || currency,
      },
    });
  }

  // The new night reuses the same rate plan as the reservation's own last
  // existing night (never a different/public/current rate — see the
  // investigation for this feature: the reservation's rate plan was
  // confirmed still valid/sellable for the extended date).
  const extensionRatePlanId = timeSlices[timeSlices.length - 1]?.ratePlan?.id;
  if (!extensionRatePlanId) return null;
  nextTimeSlices.push({
    ratePlanId: extensionRatePlanId,
    totalGrossAmount: { amount: round2(price), currency },
  });

  const newDeparture = addOneDay(reservation.departure);
  if (!newDeparture) return null;

  return {
    arrival: reservation.arrival,
    departure: newDeparture,
    adults: getAdultsCount(reservation),
    childrenAges: Array.isArray(reservation.childrenAges) ? reservation.childrenAges : null,
    timeSlices: nextTimeSlices,
    requote: false,
  };
}
