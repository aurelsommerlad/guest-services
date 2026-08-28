import crypto from "crypto";
import {
  findGuestReservations,
  findGuestReservationsByAnyReference,
  getServiceOffers,
  getServiceLocalized,
  findDefaultServiceDate,
  bookService,
  appendReservationComment,
  getArrivalDate,
  getDepartureDate,
  isPastDate,
  getUnitGroup,
  getReservationWithTimeSlices,
  getReservationForExtension,
  getUnitGroupNightlyAvailability,
  isUnitAvailable,
  amendReservation,
  updatePrimaryGuestVehicleRegistration,
  getReservationServices,
  listReservationFolios,
  bookServiceDates,
  getServiceDefinition,
} from "./apaleo.js";
import {
  getCatalog,
  addOrder,
  claimOccupancyAmendment,
  releaseOccupancyAmendment,
  claimVehicleBooking,
  releaseVehicleBooking,
  getExtensionConfig,
  claimStayExtension,
  releaseStayExtension,
  addExtensionRecord,
} from "./store.js";
import { notifyFrontOffice } from "./notify.js";
import { formatDateTime } from "./format.js";
import { resolvePriceUnitLabel } from "./priceDisplay.js";
import { resolveBilingualText, resolveBilingualPriceUnitLabel } from "./catalogLocalization.js";
import { getReservationUnitGroupId, isUnitGroupAllowed } from "./unitGroupRestriction.js";
import { getRemainingCapacity } from "./capacity.js";
import { buildExtraPersonPricing, buildOccupancyAmendmentPayload } from "./occupancyAmendment.js";
import {
  buildExtensionOffer,
  buildStayExtensionAmendmentPayload,
  findExtendableServices,
  buildServiceExtensionDates,
  findCityTaxAmount,
  buildExtensionPricePreview,
  findDepartureDateCandidates,
  buildLateCheckoutMoveDates,
  verifyLateCheckoutMove,
} from "./stayExtension.js";
import {
  normalizeVehiclePlates,
  buildPrimaryVehicleRegistration,
  formatVehiclePlatesComment,
  DEFAULT_VEHICLE_COUNTRY_CODE,
} from "./vehicleRegistration.js";
import { compareBySortOrder } from "./catalogSort.js";
import { t } from "./i18n.js";

// Thrown by increaseReservationOccupancy when a fresh, immediately-before-
// amending capacity re-check fails — carries a stable `reason` marker (not
// just free text) so placeGuestOrder can map it to the same specific
// guest-facing capacityExceededError message used for the maxQuantity
// re-check below, whichever of the two actually catches the problem.
class CapacityExceededError extends Error {
  constructor() {
    super("Für diese Buchung ist keine weitere Person mehr möglich.");
    this.reason = "capacity_exceeded";
  }
}

// Thrown by recordParkingVehiclePlates when saving the primary guest's
// vehicle registration to Apaleo fails — carries a stable `reason` marker
// so placeGuestOrder never proceeds to bookService in that case, and the
// guest is never told parking is booked while their plate wasn't actually
// recorded.
class VehicleRegistrationUpdateError extends Error {
  constructor() {
    super("Das Kennzeichen konnte nicht gespeichert werden.");
    this.reason = "vehicle_registration_update_failed";
  }
}

// Security: the guest search must never reveal whether the number or the
// last name was wrong — always the same generic message on any mismatch.
export function getLookupErrorMessage(language) {
  return t(language, "lookupError");
}

// A DIFFERENT, still-generic message for the one case that's allowed to say
// more: an OTA/external reference matched more than one distinct
// reservation for the given last name. Safe to be more specific here
// because the guest already proved they know a valid number+name
// combination — this never fires on a wrong number or wrong name.
export function getAmbiguousLookupErrorMessage(language) {
  return t(language, "lookupAmbiguousError");
}

/**
 * Finds reservation(s) matching a guest-supplied booking/reservation number
 * and last name. Returns an empty array on any kind of mismatch — callers
 * must turn that into the generic error message, never a specific one.
 */
export async function searchReservations(number, lastName) {
  return findGuestReservations(number, lastName);
}

/**
 * The full guest-facing lookup used by /api/guest/lookup: the existing
 * Apaleo booking/reservation number path (searchReservations above,
 * unchanged), falling back to an OTA/external-reference search (e.g. a
 * Booking.com confirmation number) only when that finds nothing. See
 * lib/apaleo.js's findGuestReservationsByAnyReference for the exact
 * matching/ambiguity rules.
 */
export async function searchReservationsByAnyReference(number, lastName) {
  return findGuestReservationsByAnyReference(number, lastName);
}

export function extractOfferPrice(offer, serviceDate) {
  const dateEntry = (offer?.dates || []).find((d) => d.serviceDate === serviceDate);
  // Apaleo nests the actual number one level deeper than a plain
  // MonetaryValue: dates[].amount.grossAmount for the selected date,
  // falling back to the service-level totalAmount.grossAmount.
  const amount = dateEntry?.amount?.grossAmount ?? offer?.totalAmount?.grossAmount ?? null;
  if (amount === null || amount === undefined) return null;
  const currency = dateEntry?.amount?.currency || offer?.totalAmount?.currency || "EUR";
  return { amount, currency };
}

/** YYYY-MM-DD date strings for every night of the stay: arrival inclusive, departure exclusive. */
function enumerateNights(arrivalDate, departureDate) {
  if (!arrivalDate || !departureDate) return [];
  const nights = [];
  const cursor = new Date(`${arrivalDate}T00:00:00Z`);
  const end = new Date(`${departureDate}T00:00:00Z`);
  while (cursor < end) {
    nights.push(cursor.toISOString().slice(0, 10));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return nights;
}

/**
 * Resolves which Apaleo service date(s) a curated item's booking rule
 * requires for this reservation, restricted to dates the live
 * service-offers response actually returned for that service — we never
 * invent a date Apaleo didn't offer. `complete` is false whenever any
 * required date is missing, so callers can refuse the whole item rather
 * than book a partial set of nights.
 */
export function resolveRequiredDates(bookingRule, offer, reservation) {
  const availableDates = new Set((offer?.dates || []).map((d) => d.serviceDate));

  let required;
  switch (bookingRule) {
    case "per_night":
      required = enumerateNights(getArrivalDate(reservation), getDepartureDate(reservation));
      break;
    case "arrival_day": {
      const arrival = getArrivalDate(reservation);
      required = arrival ? [arrival] : [];
      break;
    }
    case "departure_day": {
      const departure = getDepartureDate(reservation);
      required = departure ? [departure] : [];
      break;
    }
    case "per_stay":
    default: {
      const defaultDate = findDefaultServiceDate(offer);
      required = defaultDate ? [defaultDate] : [];
      break;
    }
  }

  const dates = required.filter((d) => availableDates.has(d));
  const complete = required.length > 0 && dates.length === required.length;
  return { dates, complete };
}

/**
 * Merges the admin-curated catalog for a property with live service-offers
 * for a specific reservation, so the guest only ever sees services that are
 * both approved for guest-facing sale AND actually bookable right now.
 */
export async function getGuestCatalog(reservation, propertyId) {
  if (!propertyId) {
    // Guards against a repeat of a bug where an Apaleo response shape we
    // didn't expect (e.g. property.id missing) silently resolved to the
    // catalog:undefined Redis key and looked like "no extras curated".
    console.error(
      `getGuestCatalog: keine propertyId für Reservierung ${reservation?.id} ermittelt.`
    );
    throw new Error("Für diese Reservierung konnte keine Property ermittelt werden.");
  }
  const curated = (await getCatalog(propertyId)).filter((item) => item.active);
  if (!curated.length) {
    return { items: [], pastStay: false };
  }

  const departureDate = getDepartureDate(reservation);
  const { items: offers, pastStay } = await getServiceOffers(reservation.id, departureDate);
  if (pastStay) {
    return { items: [], pastStay: true };
  }

  const offersByServiceId = new Map();
  for (const offer of offers) {
    const serviceId = offer?.service?.id;
    if (serviceId) offersByServiceId.set(serviceId, offer);
  }

  // Resolved once per reservation (not per item) — see
  // lib/unitGroupRestriction.js for exactly where this comes from in the
  // real Apaleo response and the fail-closed semantics if it's missing.
  const reservationUnitGroupId = getReservationUnitGroupId(reservation);

  // Only fetched when at least one curated item actually needs it — most
  // catalogs never use requiresRemainingCapacity, and this must not become
  // an extra Apaleo call on every guest catalog load. See lib/capacity.js
  // for the maxPersons-based math and its fail-closed-to-0 semantics.
  let remainingCapacity = 0;
  if (curated.some((item) => item.requiresRemainingCapacity || item.actionType === "increase_occupancy")) {
    const unitGroup = await getUnitGroup(reservationUnitGroupId);
    remainingCapacity = getRemainingCapacity(unitGroup, reservation);
  }

  // Pass 1: exactly the existing booking/date/price logic, unchanged —
  // just collected into a list instead of pushed straight into `items`, so
  // pass 2 can resolve bilingual display text only for items that actually
  // survive (no point spending an Apaleo call on a filtered-out item).
  const candidates = [];
  for (const curatedItem of curated) {
    const actionType = curatedItem.actionType === "increase_occupancy" ? "increase_occupancy" : "service";

    if (actionType === "increase_occupancy") {
      // Never booked as an Apaleo service at all (see amendReservation
      // below) — so there's no service-offer to match against, and no
      // bookingRule/serviceDate resolution applies. Capacity-gated
      // unconditionally (app/api/admin/catalog/route.js forces
      // requiresRemainingCapacity true for this actionType at save time,
      // so this is never accidentally left un-gated).
      if (remainingCapacity <= 0) continue;
      const nights = enumerateNights(getArrivalDate(reservation), getDepartureDate(reservation)).length;
      const pricing = buildExtraPersonPricing({
        pricePerNight: curatedItem.extraPersonPricePerNight,
        nights,
      });
      // Not configured with a valid price, or no valid stay length —
      // don't show a broken/free item rather than guessing a price.
      if (!pricing) continue;
      candidates.push({
        curatedItem,
        actionType,
        bookingRule: "per_person_per_night",
        nights: pricing.nights,
        unitPrice: pricing.unitPrice,
        price: pricing.price,
        serviceDates: null,
      });
      continue;
    }

    const offer = offersByServiceId.get(curatedItem.serviceId);
    if (!offer) continue; // not sellable for this reservation right now
    // requiresRemainingCapacity extras (e.g. a capacity-limited service)
    // are hidden entirely — not shown-but-disabled — once the booked unit
    // group has no remaining guest capacity. See section 5 of the spec:
    // unlike unitGroupRestricted, there is no "shown but blocked" state.
    if (curatedItem.requiresRemainingCapacity && remainingCapacity <= 0) continue;
    const bookingRule = curatedItem.bookingRule || "per_stay";
    const { dates: serviceDates, complete } = resolveRequiredDates(bookingRule, offer, reservation);
    // Refuse the whole item rather than book a partial set of required
    // dates (e.g. only 2 of 4 nights available for a per_night service).
    if (!complete) continue;

    const nights = bookingRule === "per_night" ? serviceDates.length : 1;
    const unitPrice = extractOfferPrice(offer, serviceDates[0]);
    const price = unitPrice
      ? { amount: Math.round(unitPrice.amount * nights * 100) / 100, currency: unitPrice.currency }
      : null;

    candidates.push({ curatedItem, actionType, bookingRule, nights, unitPrice, price, serviceDates });
  }

  // Guest-facing display order (see Admin > Catalog's "Reihenfolge" field /
  // lib/catalogSort.js) — sorted before pass 2 so localizedResults below
  // stays aligned to `candidates` by index after this reorder.
  candidates.sort((a, b) => compareBySortOrder(a.curatedItem, b.curatedItem));

  // Pass 2: fetch each shown service's localized Apaleo name/description in
  // parallel (one call per item, never sequential) — Apaleo is the primary
  // source for these; see lib/catalogLocalization.js for the exact
  // priority order (curated override > localized Apaleo > other-language
  // Apaleo > the old single-language generic catalog field last, since
  // that's exactly the field that used to strand extras in English).
  const localizedResults = await Promise.all(
    candidates.map((c) => getServiceLocalized(c.curatedItem.serviceId))
  );

  const items = candidates.map((c, i) => {
    const { curatedItem, actionType, bookingRule, nights, unitPrice, price, serviceDates } = c;
    const localized = localizedResults[i];

    const displayName = resolveBilingualText({
      overrideDe: curatedItem.displayNameDe,
      overrideEn: curatedItem.displayNameEn,
      apaleoDe: localized?.name?.de,
      apaleoEn: localized?.name?.en,
      genericFallback: curatedItem.displayName,
      finalFallback: curatedItem.code || curatedItem.serviceId,
    });
    const description = resolveBilingualText({
      overrideDe: curatedItem.descriptionDe,
      overrideEn: curatedItem.descriptionEn,
      apaleoDe: localized?.description?.de,
      apaleoEn: localized?.description?.en,
      genericFallback: curatedItem.description,
      finalFallback: "",
    });
    // Presentation only — never affects booking, dates, or price math above.
    const priceUnitLabel = resolveBilingualPriceUnitLabel({
      overrideDe: curatedItem.priceUnitLabelDe,
      overrideEn: curatedItem.priceUnitLabelEn,
      genericPriceUnitLabel: curatedItem.priceUnitLabel,
      bookingRule,
      resolvePriceUnitLabel,
    });

    return {
      serviceId: curatedItem.serviceId,
      code: curatedItem.code,
      displayName,
      description,
      category: curatedItem.category,
      imageUrl: curatedItem.imageUrl,
      bookingRule,
      actionType,
      fulfillmentMode: curatedItem.fulfillmentMode || "instant",
      priceUnitLabel,
      unitPrice,
      nights,
      price,
      serviceDates,
      // Kept visible either way (never filtered out) — the frontend shows a
      // specific restriction message and disables selection instead. See
      // BOOKING SAFETY: this same flag, freshly recomputed from a
      // freshly-fetched reservation, is what placeGuestOrder re-checks
      // immediately before calling bookService below.
      unitGroupRestricted: !isUnitGroupAllowed(curatedItem.allowedUnitGroupIds, reservationUnitGroupId),
      // Set for requiresRemainingCapacity items, and unconditionally for
      // every increase_occupancy item regardless of that flag's stored
      // value — never let the guest select more additional guests than the
      // unit group's actual remaining capacity, defense in depth beyond the
      // admin route already forcing requiresRemainingCapacity true for this
      // actionType at save time. null otherwise, i.e. "no cap".
      maxQuantity:
        curatedItem.requiresRemainingCapacity || actionType === "increase_occupancy" ? remainingCapacity : null,
      // See lib/vehicleRegistration.js — only true for catalog items
      // explicitly configured to require a license plate (e.g. parking).
      // Never inferred from the service's name/code.
      requiresVehicleRegistration: Boolean(curatedItem.requiresVehicleRegistration),
      // Pre-fills the first plate field so the guest corrects/confirms it
      // rather than retyping it from scratch (see lib/apaleo.js's
      // getReservationById — primaryGuest is always present on the base
      // reservation response, no extra Apaleo call needed here).
      existingVehicleRegistration: curatedItem.requiresVehicleRegistration
        ? reservation?.primaryGuest?.vehicleRegistration?.number || null
        : null,
    };
  });

  return { items, pastStay: false };
}

/**
 * Increases a reservation's adult count by `count` and adds
 * `extraPersonPricePerNight × count` to every existing accommodation time
 * slice, via Apaleo's AmendReservation action — never books an Apaleo
 * service. Re-verifies remaining capacity against a freshly-fetched
 * reservation immediately before amending (never trusts the catalog
 * snapshot the guest's browser sent), and guards against a duplicate
 * concurrent amendment (double submit, two tabs) with a short-lived claim.
 * Throws CapacityExceededError (mapped to the existing capacity_exceeded
 * guest-facing message) if the fresh check fails; any other failure leaves
 * the reservation exactly as it was, since AmendReservation is never called
 * until the payload is fully built and validated.
 */
async function increaseReservationOccupancy({ reservationId, serviceId, extraPersonPricePerNight, count }) {
  const claimed = await claimOccupancyAmendment(reservationId, serviceId);
  if (!claimed) {
    throw new Error("Diese Änderung wird bereits verarbeitet.");
  }
  try {
    const fresh = await getReservationWithTimeSlices(reservationId);
    if (!fresh) {
      throw new Error("Die Reservierung wurde nicht gefunden.");
    }
    const reservationUnitGroupId = getReservationUnitGroupId(fresh);
    const unitGroup = await getUnitGroup(reservationUnitGroupId);
    const remainingCapacity = getRemainingCapacity(unitGroup, fresh);
    if (count > remainingCapacity) {
      throw new CapacityExceededError();
    }
    const payload = buildOccupancyAmendmentPayload({
      reservation: fresh,
      timeSlices: fresh.timeSlices,
      extraPersonPricePerNight,
      additionalPersonCount: count,
    });
    if (!payload) {
      throw new Error("Die Reservierung konnte nicht sicher geändert werden.");
    }
    await amendReservation(reservationId, payload);
  } finally {
    await releaseOccupancyAmendment(reservationId, serviceId);
  }
}

/**
 * Saves the guest-entered license plate(s) to Apaleo, called immediately
 * BEFORE the parking service itself is booked (see placeGuestOrder below) —
 * if this fails, the service is never booked, so the guest is never told
 * parking is confirmed while their plate wasn't actually recorded. The
 * first plate goes to primaryGuest.vehicleRegistration, the only
 * Apaleo-native field for this (verified live — see lib/apaleo.js's
 * updatePrimaryGuestVehicleRegistration). Any additional plates (quantity >
 * 1) are appended to the reservation's internal comment, since Apaleo has
 * no native field for more than one vehicle registration per reservation
 * (also verified live before this was implemented). A failure appending
 * that comment is logged but non-fatal — same posture as the order-summary
 * comment appended at the end of placeGuestOrder below — since the
 * authoritative primaryGuest field was already saved successfully by then.
 */
async function recordParkingVehiclePlates(reservationId, plates) {
  const primary = buildPrimaryVehicleRegistration(plates, DEFAULT_VEHICLE_COUNTRY_CODE);
  if (!primary) return;
  try {
    await updatePrimaryGuestVehicleRegistration(reservationId, primary);
  } catch (err) {
    throw new VehicleRegistrationUpdateError();
  }
  const comment = formatVehiclePlatesComment(plates);
  if (comment) {
    await appendReservationComment(reservationId, comment).catch((err) => {
      console.error("Konnte zusätzliche Kennzeichen nicht im Kommentar speichern:", err);
    });
  }
}

/**
 * Books each requested line item directly onto the reservation's folio,
 * then appends (not overwrites) an internal reservation comment summarizing
 * what was booked, and records the order in our own log.
 */
export async function placeGuestOrder({ reservation, propertyId, lines, guestName }) {
  const { items: catalogItems } = await getGuestCatalog(reservation, propertyId);
  // Request-only extras are never booked through this path — guests submit
  // them via a separate request flow (lib/requests.js) that never calls
  // Apaleo. Excluding them here is defense in depth against a forged
  // client payload trying to instant-book a request-only item.
  const available = new Map(
    catalogItems
      .filter((item) => (item.fulfillmentMode || "instant") === "instant")
      .map((item) => [item.serviceId, item])
  );

  const booked = [];
  const failed = [];

  for (const line of lines) {
    const item = available.get(line.serviceId);
    const count = Number(line.count) || 0;
    const isOccupancyIncrease = item?.actionType === "increase_occupancy";
    const serviceDates = item?.serviceDates || [];
    if (!item || count <= 0 || (!isOccupancyIncrease && !serviceDates.length)) {
      failed.push({ serviceId: line.serviceId, reason: "nicht verfügbar" });
      continue;
    }
    // Booking safety: `item` above was just computed by the getGuestCatalog
    // call at the top of this function, from a reservation the caller (see
    // /api/guest/order) re-fetched fresh for this request — so this is
    // never trusting a stale catalog snapshot from the guest's browser. A
    // restriction that only became true since the guest loaded the catalog
    // (e.g. an admin edit, or a unit reassignment) is caught right here,
    // immediately before bookService is ever called.
    if (item.unitGroupRestricted) {
      failed.push({ serviceId: line.serviceId, reason: "Apartmenttyp nicht erlaubt" });
      continue;
    }
    // Same booking-safety principle as unitGroupRestricted above: `item`
    // was just recomputed from a freshly re-fetched reservation, so a
    // capacity change since the guest loaded the catalog (another booking,
    // an admin edit) is caught here, immediately before bookService. Never
    // silently reduces `count` to whatever still fits — the whole line is
    // rejected instead (see /api/guest/order's capacity_exceeded handling
    // for the specific guest-facing message this reason maps to).
    if (Number.isFinite(item.maxQuantity) && count > item.maxQuantity) {
      failed.push({ serviceId: line.serviceId, reason: "capacity_exceeded" });
      continue;
    }
    // Booking safety (same freshly-recomputed-`item` principle as above): a
    // catalog item configured with requiresVehicleRegistration (e.g.
    // parking) may never be booked without exactly `count` license plates —
    // re-validated here server-side regardless of what the guest's browser
    // already checked. lib/vehicleRegistration.js's normalizeVehiclePlates
    // is the single source of truth for this rule, shared with the
    // guest-facing quantity stepper, so the two can never drift apart.
    let vehiclePlates = null;
    if (item.requiresVehicleRegistration) {
      vehiclePlates = normalizeVehiclePlates(line.vehiclePlates, count);
      if (!vehiclePlates) {
        failed.push({ serviceId: line.serviceId, reason: "vehicle_registration_required" });
        continue;
      }
    }
    if (isOccupancyIncrease) {
      // Never booked as an Apaleo service (see increaseReservationOccupancy
      // above) — amends the reservation's adult count and accommodation
      // price directly instead.
      try {
        await increaseReservationOccupancy({
          reservationId: reservation.id,
          serviceId: item.serviceId,
          extraPersonPricePerNight: item.unitPrice.amount,
          count,
        });
        booked.push({ ...item, count });
      } catch (err) {
        failed.push({ serviceId: line.serviceId, reason: err.reason || err.message });
      }
      continue;
    }
    try {
      // For a requiresVehicleRegistration item, claim exclusive booking
      // rights first — same double-submission guard as
      // claimOccupancyAmendment above — so two concurrent submissions
      // (double-click, two tabs) can never both save the vehicle
      // registration and both book the service.
      const claimed = vehiclePlates ? await claimVehicleBooking(reservation.id, item.serviceId) : true;
      if (!claimed) {
        throw new Error("Diese Buchung wird bereits verarbeitet.");
      }
      try {
        // Vehicle registration is saved BEFORE the service is booked (see
        // recordParkingVehiclePlates above) — a failure here fails this
        // line without ever calling bookService.
        if (vehiclePlates) {
          await recordParkingVehiclePlates(reservation.id, vehiclePlates);
        }
        // A single book-service call carries every required date at once
        // (per_night sends all nights together) — Apaleo's book-service
        // action replaces a service's whole date set on each call rather
        // than merging into it, so one call per date silently dropped every
        // previously booked date (see the Fix #4 note on bookService in
        // lib/apaleo.js). All required dates were already confirmed
        // available in getGuestCatalog before we get here, and `amount`
        // reuses that same live-offer unit price — never hard-coded.
        try {
          await bookService({
            reservationId: reservation.id,
            serviceId: item.serviceId,
            count,
            serviceDates,
            amount: item.unitPrice,
          });
        } catch (err) {
          throw new Error(`${serviceDates.join(", ")}: ${err.message}`);
        }
        booked.push({ ...item, count });
      } finally {
        if (vehiclePlates) await releaseVehicleBooking(reservation.id, item.serviceId);
      }
    } catch (err) {
      failed.push({ serviceId: line.serviceId, reason: err.reason || err.message });
    }
  }

  if (booked.length) {
    // Admin-facing text (the Apaleo reservation comment and our own order
    // log, both rendered in the German-only admin area) always uses the
    // German name, regardless of which language the guest was browsing in
    // — `displayName` on each booked item is the bilingual { de, en }
    // object built in getGuestCatalog above.
    const summary = booked.map((b) => `${b.count}x ${b.displayName.de}`).join(", ");
    const commentText = `[Gäste-Portal ${formatDateTime(new Date())}] Extras gebucht: ${summary}`;
    await appendReservationComment(reservation.id, commentText).catch((err) => {
      // A comment failure must never roll back services already booked.
      console.error("Konnte Reservierungskommentar nicht ergänzen:", err);
    });

    const order = {
      id: crypto.randomUUID(),
      createdAt: new Date().toISOString(),
      propertyId,
      reservationId: reservation.id,
      bookingId: reservation.bookingId || null,
      guestName,
      items: booked.map((b) => ({
        serviceId: b.serviceId,
        displayName: b.displayName.de,
        count: b.count,
        price: b.price,
      })),
    };
    await addOrder(order);
    await notifyFrontOffice(order);
  }

  return { booked, failed };
}

// --- Stay extension ("Eine Nacht länger bleiben" / "Stay one more night") --
//
// Never booked as an Apaleo service — see lib/stayExtension.js for the
// pure offer/price/payload logic this section wires up to live Apaleo
// availability + AmendReservation calls.

function addDaysUTC(dateStr, days) {
  const d = new Date(`${dateStr}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return null;
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

// Thrown by confirmStayExtension whenever the extension can no longer be
// safely offered at the moment of confirmation (availability disappeared,
// the reservation state changed, or it was already extended) — carries a
// stable `reason` marker so the API route can map it to the required
// guest-facing message ("Die Verlängerungsnacht ist inzwischen leider
// nicht mehr verfügbar." / "Unfortunately, the additional night is no
// longer available.") regardless of which specific check caught it.
class StayExtensionUnavailableError extends Error {
  constructor() {
    super("Die Verlängerungsnacht ist inzwischen leider nicht mehr verfügbar.");
    this.reason = "stay_extension_unavailable";
  }
}

/**
 * How many CONSECUTIVE nights, starting immediately at `departureDate`, are
 * safely offerable as the extension night. "Safely" means: never at risk of
 * moving the guest to a different physical apartment (see the investigation
 * for this feature).
 *   - A specific unit already assigned (the normal case): each night is
 *     only counted if that EXACT unit (not just some unit in the group) is
 *     free for it.
 *   - No unit assigned yet: only trusted when the unit group has exactly
 *     one physical unit (`physicalCount === 1`) — there's no other
 *     apartment the guest could end up in. Otherwise treated as unsafe
 *     (gap 0), since we cannot guarantee which unit will end up assigned.
 * Stops at the first night that fails either check, or once the gap has
 * grown one past `minSellableStayNights` — decideExtensionOffer (see
 * lib/stayExtension.js) only ever needs to know "gap == 1" or
 * "gap > minSellableStayNights", never the exact size beyond that point,
 * so this never looks further than the property's own configured
 * threshold requires. Passing the config value in here (rather than a
 * fixed constant) means raising minSellableStayNights later automatically
 * looks far enough ahead — a hard-coded cap could otherwise silently
 * under-count the gap and make the offer disappear.
 */
export async function determineConsecutiveFreeNights({
  propertyId,
  unitGroupId,
  assignedUnitId,
  departureDate,
  minSellableStayNights,
}) {
  const lookaheadNights = Math.max(Number(minSellableStayNights) || 0, 0) + 1;
  const rangeEnd = addDaysUTC(departureDate, lookaheadNights);
  if (!rangeEnd) return 0;
  const nightly = await getUnitGroupNightlyAvailability(propertyId, unitGroupId, departureDate, rangeEnd);

  let gap = 0;
  for (const entry of nightly) {
    const group = entry?.unitGroups?.[0];
    if (!group || !(Number(group.availableCount) > 0)) break;

    if (assignedUnitId) {
      const unitFree = await isUnitAvailable(propertyId, unitGroupId, assignedUnitId, entry.from, entry.to);
      if (!unitFree) break;
    } else if (Number(group.physicalCount) !== 1) {
      break;
    }
    gap += 1;
  }
  return gap;
}

/**
 * Resolves the "stay one more night" offer for a reservation, or null if
 * none should be shown — every eligibility condition (section 5 of the
 * spec) fails closed: feature disabled, ineligible reservation state, no
 * safe availability, or any unexpected error all result in null rather
 * than a guess. Called once per guest catalog load (see
 * app/api/guest/catalog/route.js), always against a freshly fetched
 * reservation — never the client-supplied one.
 */
export async function getStayExtensionOffer(reservation) {
  try {
    const propertyId = reservation?.property?.id;
    if (!propertyId) return null;

    const config = await getExtensionConfig(propertyId);
    if (!config.extensionNightEnabled) return null;

    const fresh = await getReservationForExtension(reservation.id);
    if (!fresh) return null;

    // Apaleo's own authoritative "is this currently allowed" signal —
    // correctly reflects reservation status, timing, and channel
    // restrictions without us reimplementing that logic (verified live,
    // including for a Booking.com/ChannelManager reservation).
    const actions = Array.isArray(fresh.actions) ? fresh.actions : [];
    const amendDepartureAllowed = actions.find((a) => a.action === "AmendDeparture")?.isAllowed === true;
    if (!amendDepartureAllowed) return null;
    if (isPastDate(getDepartureDate(fresh))) return null;

    const unitGroupId = getReservationUnitGroupId(fresh);
    if (!unitGroupId) return null;
    const assignedUnitId = fresh.unit?.id || null;
    const departureDate = getDepartureDate(fresh);
    if (!departureDate) return null;

    const gap = await determineConsecutiveFreeNights({
      propertyId,
      unitGroupId,
      assignedUnitId,
      departureDate,
      minSellableStayNights: config.minSellableStayNights,
    });

    const offer = buildExtensionOffer({ reservation: fresh, timeSlices: fresh.timeSlices, gap, config });
    if (!offer) return null;

    return await attachExtensionPricePreview(offer, fresh, { arrivalDate: getArrivalDate(fresh), departureDate });
  } catch (err) {
    // Never let a failure computing this optional upsell break the guest's
    // whole extras page — the rest of the catalog must still load.
    console.error("getStayExtensionOffer: konnte Angebot nicht berechnen:", err);
    return null;
  }
}

/**
 * Adds the guest-facing price preview (extras + city tax on top of the
 * already-discounted accommodation price) to an offer built by
 * buildExtensionOffer. Never fails the whole offer if a preview call errors
 * — an offer with a missing/partial preview (extras: [], cityTax: null) is
 * still a valid, confirmable offer; only the display is less complete.
 * Reused by both getStayExtensionOffer (preview, before any mutation) and
 * confirmStayExtension (recomputed fresh immediately before amending, per
 * the real-time-revalidation requirement).
 */
async function attachExtensionPricePreview(offer, reservation, { arrivalDate, departureDate }) {
  let extras = [];
  let cityTax = null;
  try {
    const services = await getReservationServices(reservation.id);
    const { toExtend } = findExtendableServices({
      services,
      arrivalDate,
      oldDepartureDate: departureDate,
      // The new night's own serviceDate is the OLD departure date (nights
      // are keyed by their start date, e.g. the dog fee's night-before-
      // departure entry is dated at that night's start, not at
      // offer.newDeparture, which is the new CHECKOUT date one day later)
      // — confirmed live against real HUESLE reservations' per-night
      // service and accommodation timeSlice dates.
      newDate: departureDate,
    });
    const localized = await Promise.all(toExtend.map((s) => getServiceLocalized(s.serviceId)));
    extras = toExtend.map((s, i) => ({
      serviceId: s.serviceId,
      name: resolveBilingualText({
        overrideDe: null,
        overrideEn: null,
        apaleoDe: localized[i]?.name?.de,
        apaleoEn: localized[i]?.name?.en,
        genericFallback: typeof s.name === "string" ? s.name : "",
        finalFallback: s.serviceId,
      }),
      amount: s.normalPricePerNight,
    }));

    if (reservation.hasCityTax) {
      const folios = await listReservationFolios(reservation.id);
      const lastExistingNight = addDaysUTC(departureDate, -1);
      cityTax = lastExistingNight ? findCityTaxAmount(folios, lastExistingNight) : null;
    }
  } catch (err) {
    console.error("attachExtensionPricePreview: konnte Zusatzkosten nicht ermitteln:", err);
  }

  const totalPrice = buildExtensionPricePreview({ extensionPrice: offer.extensionPrice, extras, cityTax });
  return { ...offer, extras, cityTax, totalPrice };
}

/**
 * Confirms a "stay one more night" extension. Re-derives everything from
 * scratch against a freshly fetched reservation immediately before
 * amending — never trusts the offer the guest's browser saw when the page
 * loaded (per the real-time-revalidation requirement): eligibility,
 * availability, average rate, and price are all recomputed here. Guarded
 * against duplicate/concurrent submissions two ways: a short-lived
 * cross-instance claim (double-click, two tabs racing at the same instant)
 * and, independently, comparing the freshly fetched departure against the
 * departure the client says it saw — if they differ, the stay was already
 * changed (by this feature or otherwise) and we refuse rather than extend
 * a second time.
 */
export async function confirmStayExtension({ reservationId, expectedCurrentDeparture }) {
  const claimed = await claimStayExtension(reservationId);
  if (!claimed) {
    throw new StayExtensionUnavailableError();
  }
  try {
    const fresh = await getReservationForExtension(reservationId);
    if (!fresh) throw new StayExtensionUnavailableError();

    const currentDeparture = getDepartureDate(fresh);
    if (!currentDeparture || currentDeparture !== expectedCurrentDeparture) {
      // Either already extended (by this feature, staff, or anything
      // else) or otherwise changed since the offer was shown — never
      // extend on top of a stay that has already moved.
      throw new StayExtensionUnavailableError();
    }

    const propertyId = fresh.property?.id;
    if (!propertyId) throw new StayExtensionUnavailableError();

    const config = await getExtensionConfig(propertyId);
    if (!config.extensionNightEnabled) throw new StayExtensionUnavailableError();

    const actions = Array.isArray(fresh.actions) ? fresh.actions : [];
    const amendDepartureAllowed = actions.find((a) => a.action === "AmendDeparture")?.isAllowed === true;
    if (!amendDepartureAllowed) throw new StayExtensionUnavailableError();
    if (isPastDate(currentDeparture)) throw new StayExtensionUnavailableError();

    const unitGroupId = getReservationUnitGroupId(fresh);
    if (!unitGroupId) throw new StayExtensionUnavailableError();
    const assignedUnitId = fresh.unit?.id || null;

    const gap = await determineConsecutiveFreeNights({
      propertyId,
      unitGroupId,
      assignedUnitId,
      departureDate: currentDeparture,
      minSellableStayNights: config.minSellableStayNights,
    });

    const offer = buildExtensionOffer({ reservation: fresh, timeSlices: fresh.timeSlices, gap, config });
    if (!offer) throw new StayExtensionUnavailableError();

    const payload = buildStayExtensionAmendmentPayload({
      reservation: fresh,
      timeSlices: fresh.timeSlices,
      extensionPrice: offer.extensionPrice.amount,
      currency: offer.extensionPrice.currency,
    });
    if (!payload) throw new StayExtensionUnavailableError();

    const arrivalDate = getArrivalDate(fresh);

    // C. Amend accommodation by exactly one night. Everything above this
    // line only ever reads — nothing has been mutated yet, so any failure
    // up to here leaves the reservation completely untouched.
    await amendReservation(reservationId, payload);

    // D. Re-read services fresh — never reuse a pre-amend snapshot, so a
    // retry after a partially-completed previous attempt always converges
    // to the correct end state instead of duplicating or re-deriving stale
    // dates.
    const servicesBeforeExtend = await getReservationServices(reservationId);
    const mandatoryServiceIdsBefore = mandatoryServiceIds(servicesBeforeExtend);

    // The new night's own serviceDate is the OLD departure date (nights are
    // keyed by their start date — see attachExtensionPricePreview's note
    // above), not offer.newDeparture, which is the new checkout date one
    // day later.
    const newNightServiceDate = offer.currentDeparture;

    const { toExtend, alreadyExtended } = findExtendableServices({
      services: servicesBeforeExtend,
      arrivalDate,
      oldDepartureDate: offer.currentDeparture,
      newDate: newNightServiceDate,
    });

    // E. Extend each eligible per-night service, one complete-date
    // book-service call per service. A failure on one service never rolls
    // back the accommodation extension or blocks the others — each is
    // recorded independently for the audit trail.
    const extrasResult = alreadyExtended.map((item) => ({
      serviceId: item.serviceId,
      name: item.name,
      extended: true,
      alreadyDone: true,
    }));
    for (const item of toExtend) {
      const dates = buildServiceExtensionDates({
        existingDates: item.existingDates,
        newDate: newNightServiceDate,
        normalPricePerNight: item.normalPricePerNight,
      });
      try {
        await bookServiceDates({ reservationId, serviceId: item.serviceId, dates });
        extrasResult.push({
          serviceId: item.serviceId,
          name: item.name,
          extended: true,
          amount: item.normalPricePerNight,
        });
      } catch (err) {
        console.error(
          `confirmStayExtension: Erweiterung von Service ${item.serviceId} auf Reservierung ${reservationId} fehlgeschlagen:`,
          err
        );
        extrasResult.push({
          serviceId: item.serviceId,
          name: item.name,
          extended: false,
          error: err.message,
        });
      }
    }

    // E2. Move any departure-day, "moves with checkout" service (e.g. Late
    // Check-out) from the old departure date to the new one, instead of
    // duplicating/leaving it stranded on a date that is no longer the
    // departure. Detected purely from the reservation's own data (a
    // non-mandatory service with exactly one date, still at the old
    // departure) plus the service's own static definition — never a
    // hardcoded service id/code. A failure here never rolls back the
    // accommodation extension either; recorded independently below.
    const departureCandidates = findDepartureDateCandidates({
      services: servicesBeforeExtend,
      oldDepartureDate: offer.currentDeparture,
    });
    const lateCheckoutMoves = [];
    for (const candidate of departureCandidates) {
      const definition = await getServiceDefinition(candidate.serviceId);
      const isMoveEligible = definition?.availability?.mode === "Departure" && definition?.postNextDay === true;
      if (!isMoveEligible) continue;

      const dates = buildLateCheckoutMoveDates({
        newDepartureDate: offer.newDeparture,
        count: candidate.count,
        amount: candidate.amount,
      });
      try {
        await bookServiceDates({ reservationId, serviceId: candidate.serviceId, dates });
        lateCheckoutMoves.push({
          serviceId: candidate.serviceId,
          name: candidate.name,
          oldDeparture: offer.currentDeparture,
          newDeparture: offer.newDeparture,
          amount: candidate.amount,
          count: candidate.count,
          moved: true,
          verified: null, // filled in below, once services are re-read
        });
      } catch (err) {
        console.error(
          `confirmStayExtension: Verschieben von Service ${candidate.serviceId} auf Reservierung ${reservationId} fehlgeschlagen:`,
          err
        );
        lateCheckoutMoves.push({
          serviceId: candidate.serviceId,
          name: candidate.name,
          oldDeparture: offer.currentDeparture,
          newDeparture: offer.newDeparture,
          amount: candidate.amount,
          count: candidate.count,
          moved: false,
          verified: false,
          error: err.message,
        });
      }
    }

    // F/G. Re-read reservation + services + folio, and verify.
    const afterFresh = await getReservationForExtension(reservationId);
    const newDepartureConfirmed = getDepartureDate(afterFresh) === offer.newDeparture;

    let cityTax = { applicable: Boolean(fresh.hasCityTax), verified: null, amount: null };
    if (fresh.hasCityTax) {
      const folios = await listReservationFolios(reservationId);
      const found = findCityTaxAmount(folios, newNightServiceDate);
      cityTax = { applicable: true, verified: Boolean(found), amount: found };
      if (!found) {
        // Per the business rule: never invent or manually add a tax here —
        // just make the gap impossible to miss for staff.
        console.error(
          `confirmStayExtension: CityTax-Beleg für die neue Nacht ${newNightServiceDate} (Reservierung ${reservationId}) wurde nach der Verlängerung nicht gefunden.`
        );
      }
    }

    const servicesAfterExtend = await getReservationServices(reservationId);
    const mandatoryServiceIdsAfter = mandatoryServiceIds(servicesAfterExtend);
    const mandatoryServicesIntact = [...mandatoryServiceIdsBefore].every((id) =>
      mandatoryServiceIdsAfter.has(id)
    );

    // Verify each attempted move actually landed — never assumed just
    // because the book-service call itself returned success.
    for (const move of lateCheckoutMoves) {
      if (!move.moved) continue;
      move.verified = verifyLateCheckoutMove({
        services: servicesAfterExtend,
        serviceId: move.serviceId,
        oldDepartureDate: move.oldDeparture,
        newDepartureDate: move.newDeparture,
        expectedAmount: move.amount.amount,
        expectedCount: move.count,
      });
    }

    const allExtrasOk = extrasResult.every((e) => e.extended);
    const allMovesOk = lateCheckoutMoves.every((m) => m.moved && m.verified);
    const status =
      newDepartureConfirmed &&
      allExtrasOk &&
      allMovesOk &&
      (!cityTax.applicable || cityTax.verified) &&
      mandatoryServicesIntact
        ? "confirmed"
        : "confirmed_with_issues";

    // H. Store the detailed audit result — this always reflects what
    // actually happened, including any ancillary issue, never just "ok"
    // because the accommodation amend itself succeeded.
    await addExtensionRecord({
      id: crypto.randomUUID(),
      reservationId,
      oldDeparture: offer.currentDeparture,
      newDeparture: offer.newDeparture,
      newDepartureConfirmed,
      originalAverageNightlyRate: offer.averageNightlyRate,
      discountPercent: offer.discountPercent,
      extensionPrice: offer.extensionPrice,
      extras: extrasResult,
      lateCheckoutMoves,
      cityTax,
      mandatoryServicesIntact,
      createdAt: new Date().toISOString(),
      status,
    });

    return { newDeparture: offer.newDeparture, extensionPrice: offer.extensionPrice };
  } finally {
    await releaseStayExtension(reservationId);
  }
}

function mandatoryServiceIds(services) {
  return new Set(
    (services || [])
      .filter((entry) => (entry.dates || []).some((d) => d.isMandatory))
      .map((entry) => entry.service?.id)
      .filter(Boolean)
  );
}
