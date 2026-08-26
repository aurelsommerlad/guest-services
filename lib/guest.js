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
} from "./apaleo";
import { getCatalog, addOrder } from "./store";
import { notifyFrontOffice } from "./notify";
import { formatDateTime } from "./format";
import { resolvePriceUnitLabel } from "./priceDisplay";
import { resolveBilingualText, resolveBilingualPriceUnitLabel } from "./catalogLocalization";
import { getReservationUnitGroupId, isUnitGroupAllowed } from "./unitGroupRestriction";
import { compareBySortOrder } from "./catalogSort";
import { t } from "./i18n";

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

  // Pass 1: exactly the existing booking/date/price logic, unchanged —
  // just collected into a list instead of pushed straight into `items`, so
  // pass 2 can resolve bilingual display text only for items that actually
  // survive (no point spending an Apaleo call on a filtered-out item).
  const candidates = [];
  for (const curatedItem of curated) {
    const offer = offersByServiceId.get(curatedItem.serviceId);
    if (!offer) continue; // not sellable for this reservation right now
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

    candidates.push({ curatedItem, bookingRule, nights, unitPrice, price, serviceDates });
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
    const { curatedItem, bookingRule, nights, unitPrice, price, serviceDates } = c;
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
    };
  });

  return { items, pastStay: false };
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
    const serviceDates = item?.serviceDates || [];
    if (!item || count <= 0 || !serviceDates.length) {
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
    try {
      // One book-service call per required date (per_night needs one per
      // night) — the same single-explicit-date pattern already relied on
      // to avoid the count-per-night multiplication bug, just repeated for
      // each date a booking rule requires. All required dates were already
      // confirmed available in getGuestCatalog before we get here, so we
      // only start posting once the whole set is known-good.
      for (const serviceDate of serviceDates) {
        try {
          await bookService({
            reservationId: reservation.id,
            serviceId: item.serviceId,
            count,
            serviceDate,
          });
        } catch (err) {
          throw new Error(`${serviceDate}: ${err.message}`);
        }
      }
      booked.push({ ...item, count });
    } catch (err) {
      failed.push({ serviceId: line.serviceId, reason: err.message });
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
