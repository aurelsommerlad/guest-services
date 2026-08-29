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
 *
 * `phase` ("in_house" or "before_arrival", from determineStayExtensionPhase
 * — always computed server-side by the caller from Apaleo's own reservation
 * status/dates, NEVER trusted from the client) selects which pair of
 * property-configured discount percentages decideExtensionOffer's
 * unchanged gap logic runs on: in_house uses
 * extensionDiscountInHouseOneNightGap/Standard, before_arrival uses
 * extensionDiscountPreArrivalOneNightGap/Standard (see
 * lib/store.js's getExtensionConfig for how those are resolved, including
 * the legacy-field migration fallback). The gap===1 vs gap>minSellableStayNights
 * decision itself is entirely unaffected by phase — only which discount
 * number gets plugged into it.
 */
export function buildExtensionOffer({ reservation, timeSlices, gap, config, phase }) {
  const isInHouse = phase === "in_house";
  const decision = decideExtensionOffer({
    gap,
    minSellableStayNights: config?.minSellableStayNights,
    discountOneNightGap: isInHouse
      ? config?.extensionDiscountInHouseOneNightGap
      : config?.extensionDiscountPreArrivalOneNightGap,
    discountStandard: isInHouse ? config?.extensionDiscountInHouseStandard : config?.extensionDiscountPreArrivalStandard,
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
    phase,
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
/** YYYY-MM-DD date strings for every night arrival (inclusive) .. departure (exclusive). Mirrors the private copy in lib/guest.js — kept duplicated here rather than imported, per this module's dependency-free design (see the header above). */
function enumerateNights(arrivalDate, departureDate) {
  if (!arrivalDate || !departureDate) return [];
  const nights = [];
  const cursor = new Date(`${String(arrivalDate).slice(0, 10)}T00:00:00Z`);
  const end = new Date(`${String(departureDate).slice(0, 10)}T00:00:00Z`);
  while (cursor < end) {
    nights.push(cursor.toISOString().slice(0, 10));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return nights;
}

function setsEqual(a, b) {
  if (a.size !== b.size) return false;
  for (const value of a) if (!b.has(value)) return false;
  return true;
}

/**
 * Determines which of a reservation's currently-booked services should be
 * automatically extended to the new departure night, which are already
 * extended (idempotent retry), and which must never be touched — using
 * ONLY the shape of each service's own `dates[]` on THIS reservation, never
 * a hardcoded service id/code or the static service definition. This is
 * what makes any future per-night extra (dog, parking, baby cot, ...)
 * supported automatically:
 *   - any date entry `isMandatory: true` -> never touch. Apaleo/rate-plan
 *     managed (e.g. "Final cleaning on departure"), already tracks the
 *     reservation's current departure date itself.
 *   - `dates[]` (as a set of YYYY-MM-DD) exactly equal to every night of
 *     the ORIGINAL stay (arrival..oldDeparture-1) -> a genuine per-night
 *     extra for the whole stay -> needs the new night appended.
 *   - `dates[]` exactly equal to the original set PLUS `newDate` -> already
 *     extended (e.g. a retry after a previous attempt already succeeded
 *     for this service) -> nothing to do.
 *   - anything else (a single date, a partial subset, arrival/departure-day
 *     services like Early Check-in or Late Check-out, a guest's genuine
 *     one-off single-night request, ...) -> never touched.
 */
export function findExtendableServices({ services, arrivalDate, oldDepartureDate, newDate }) {
  const originalNights = new Set(enumerateNights(arrivalDate, oldDepartureDate));
  const extendedNights = new Set([...originalNights, newDate]);

  const toExtend = [];
  const alreadyExtended = [];

  for (const entry of services || []) {
    const dates = Array.isArray(entry?.dates) ? entry.dates : [];
    if (!dates.length) continue;
    if (dates.some((d) => d.isMandatory)) continue;

    const dateSet = new Set(dates.map((d) => d.serviceDate));
    const matchesOriginal = setsEqual(dateSet, originalNights);
    const matchesExtended = setsEqual(dateSet, extendedNights);
    if (!matchesOriginal && !matchesExtended) continue;

    const serviceId = entry?.service?.id;
    if (!serviceId) continue;

    const sortedDates = [...dates].sort((a, b) => String(a.serviceDate).localeCompare(String(b.serviceDate)));
    const lastDate = sortedDates[sortedDates.length - 1];
    const normalPricePerNight = {
      amount: Number(lastDate?.amount?.grossAmount),
      currency: lastDate?.amount?.currency || "EUR",
    };
    if (!Number.isFinite(normalPricePerNight.amount)) continue;

    const item = {
      serviceId,
      name: entry.service?.name || entry.service?.code || serviceId,
      normalPricePerNight,
      existingDates: dates.map((d) => ({
        serviceDate: d.serviceDate,
        count: d.count,
        amount: { amount: Number(d.amount?.grossAmount), currency: d.amount?.currency || "EUR" },
      })),
    };

    if (matchesExtended) {
      alreadyExtended.push(item);
    } else {
      toExtend.push(item);
    }
  }

  return { toExtend, alreadyExtended };
}

/**
 * Builds the complete `dates[]` array to send to Apaleo's book-service
 * action for one eligible per-night service: every existing date resent
 * with its own already-charged amount completely unchanged, plus one new
 * entry for `newDate` at the service's normal (undiscounted) price — the
 * extension discount NEVER applies to extras. `count` for the new date
 * matches whatever count the most recent existing date already used
 * (usually 1), so a service booked at quantity > 1 stays at that quantity
 * for the new night too.
 */
export function buildServiceExtensionDates({ existingDates, newDate, normalPricePerNight }) {
  const lastCount = existingDates[existingDates.length - 1]?.count ?? 1;
  return [
    ...existingDates.map((d) => ({ serviceDate: d.serviceDate, count: d.count, amount: d.amount })),
    { serviceDate: newDate, count: lastCount, amount: normalPricePerNight },
  ];
}

/**
 * Which reservation phase the guest-facing card should present as — purely
 * a presentation signal for the frontend (see components/guest/GuestApp.jsx's
 * StayExtensionCompactCard, which renders the same compact card for both
 * phases and only varies its subtitle/CTA styling by this value), NEVER
 * used to decide whether the offer itself is eligible (see
 * decideExtensionOffer above for that — this runs only once an offer
 * already exists).
 *
 * "in_house" when EITHER:
 *   - Apaleo's own reservation status is "InHouse" (the authoritative
 *     signal that check-in has actually happened), OR
 *   - as a fallback, the reservation's own arrival/departure dates (as
 *     Apaleo represents them — already the property's local calendar
 *     dates, e.g. "2026-08-24T16:00:00+02:00" sliced to "2026-08-24", not
 *     reinterpreted through any other timezone) show the stay has already
 *     started and not yet ended.
 * "before_arrival" otherwise.
 *
 * `today` defaults to the real current time and is only ever overridden in
 * tests (same pattern as lib/apaleo.js's isPastDate) — this always runs
 * server-side against the server's clock, never the guest's browser
 * clock/timezone.
 */
export function determineStayExtensionPhase({ status, arrivalDate, departureDate, today = new Date() } = {}) {
  if (status === "InHouse") return "in_house";

  const todayStr = today.toISOString().slice(0, 10);
  const arrival = arrivalDate ? String(arrivalDate).slice(0, 10) : null;
  const departure = departureDate ? String(departureDate).slice(0, 10) : null;
  if (arrival && departure && arrival <= todayStr && departure > todayStr) {
    return "in_house";
  }
  return "before_arrival";
}

/**
 * Finds non-mandatory services that are candidates for a "Late Check-out
 * style" departure-day move: exactly one `dates[]` entry, dated at the
 * reservation's CURRENT (pre-extension) departure date. This is only the
 * per-reservation half of the detection — callers must additionally
 * confirm, via the service's own static definition (see lib/apaleo.js's
 * getServiceDefinition), that `availability.mode === "Departure"` AND
 * `postNextDay === true` before treating a candidate as a genuine move —
 * otherwise an unrelated one-off extra that merely happens to land on the
 * departure day (or a mandatory rate-plan service like Final cleaning,
 * already excluded here) could be swept up. Naturally idempotent: once a
 * service has actually moved to the new departure date, its single date no
 * longer equals `oldDepartureDate`, so a retry finds no candidate for it
 * at all — it can never be moved a second time or moved further forward.
 */
export function findDepartureDateCandidates({ services, oldDepartureDate }) {
  const candidates = [];
  for (const entry of services || []) {
    const dates = Array.isArray(entry?.dates) ? entry.dates : [];
    if (dates.length !== 1) continue;
    if (dates[0]?.isMandatory) continue;
    if (dates[0]?.serviceDate !== oldDepartureDate) continue;

    const serviceId = entry?.service?.id;
    if (!serviceId) continue;
    const amount = Number(dates[0]?.amount?.grossAmount);
    if (!Number.isFinite(amount)) continue;

    candidates.push({
      serviceId,
      name: entry.service?.name || entry.service?.code || serviceId,
      count: dates[0].count,
      amount: { amount, currency: dates[0].amount?.currency || "EUR" },
    });
  }
  return candidates;
}

/**
 * Builds the single-entry `dates[]` to send to book-service to MOVE a
 * departure-day service (e.g. Late Check-out) from the old departure date
 * to the new one: exactly one date, the guest's already-paid count/amount
 * completely unchanged — never re-priced, never charged twice. Because
 * book-service replaces a service's whole date set per call (see
 * bookService's Fix #4 note in lib/apaleo.js), sending exactly this one
 * new date both removes the old date and adds the new one in a single
 * call — never a separate remove-service call, never two dates at once.
 */
export function buildLateCheckoutMoveDates({ newDepartureDate, count, amount }) {
  return [{ serviceDate: newDepartureDate, count, amount }];
}

/**
 * Verifies a departure-day service move actually landed correctly after
 * re-reading services post-move: the new departure date present exactly
 * once, the old departure date no longer present at all, and the
 * count/amount exactly unchanged from what the guest already paid. Never
 * assumed true just because the book-service call itself returned success.
 */
export function verifyLateCheckoutMove({ services, serviceId, oldDepartureDate, newDepartureDate, expectedAmount, expectedCount }) {
  const entry = (services || []).find((s) => s?.service?.id === serviceId);
  const dates = Array.isArray(entry?.dates) ? entry.dates : [];
  if (dates.length !== 1) return false;
  const [date] = dates;
  if (date.serviceDate !== newDepartureDate) return false;
  if (date.serviceDate === oldDepartureDate) return false;
  if (Number(date.count) !== Number(expectedCount)) return false;
  if (Number(date.amount?.grossAmount) !== Number(expectedAmount)) return false;
  return true;
}

/**
 * Finds the already-posted CityTax folio charge for one specific night,
 * across every folio for a reservation (see lib/apaleo.js's
 * listReservationFolios). Never re-derives city tax from the property's
 * ListCityTaxes config — a live comparison found the config value did not
 * match the actual folio amount — so this is the ONLY value ever used for
 * city tax, both for the pre-confirmation preview (the last existing
 * night's amount) and for verifying a new night's charge after the
 * amendment. Returns null when no such charge exists (e.g. the property
 * has no city tax, or — after an amendment — Apaleo unexpectedly did not
 * create one, which callers must treat as a verification failure, never
 * as "zero tax").
 */
export function findCityTaxAmount(folios, serviceDate) {
  for (const folio of folios || []) {
    for (const charge of folio?.charges || []) {
      if (charge?.type !== "CityTax" || charge?.serviceDate !== serviceDate) continue;
      const amount = Number(charge?.amount?.grossAmount);
      if (!Number.isFinite(amount)) continue;
      return { amount, currency: charge?.amount?.currency || "EUR" };
    }
  }
  return null;
}

/**
 * Composes the guest-facing total for the extension: the (already
 * discounted) accommodation price, plus every eligible extra at its normal
 * price, plus the estimated city tax for the new night when applicable.
 * This is the number shown prominently on the stay-extension card — the
 * accommodation discount never applies to the extras/city-tax rows, so
 * this sum can never be produced by applying one discount to a combined
 * total.
 */
export function buildExtensionPricePreview({ extensionPrice, extras, cityTax }) {
  let total = Number(extensionPrice?.amount) || 0;
  for (const extra of extras || []) total += Number(extra?.amount?.amount) || 0;
  if (cityTax) total += Number(cityTax.amount) || 0;
  return { amount: round2(total), currency: extensionPrice?.currency || "EUR" };
}

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
