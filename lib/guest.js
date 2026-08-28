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
  getUnitGroup,
  getReservationWithTimeSlices,
  amendReservation,
  updatePrimaryGuestVehicleRegistration,
} from "./apaleo";
import {
  getCatalog,
  addOrder,
  claimOccupancyAmendment,
  releaseOccupancyAmendment,
  claimVehicleBooking,
  releaseVehicleBooking,
} from "./store";
import { notifyFrontOffice } from "./notify";
import { formatDateTime } from "./format";
import { resolvePriceUnitLabel } from "./priceDisplay";
import { resolveBilingualText, resolveBilingualPriceUnitLabel } from "./catalogLocalization";
import { getReservationUnitGroupId, isUnitGroupAllowed } from "./unitGroupRestriction";
import { getRemainingCapacity } from "./capacity";
import { buildExtraPersonPricing, buildOccupancyAmendmentPayload } from "./occupancyAmendment";
import {
  normalizeVehiclePlates,
  buildPrimaryVehicleRegistration,
  formatVehiclePlatesComment,
  DEFAULT_VEHICLE_COUNTRY_CODE,
} from "./vehicleRegistration";
import { compareBySortOrder } from "./catalogSort";
import { t } from "./i18n";

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
