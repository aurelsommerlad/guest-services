import crypto from "crypto";
import {
  findGuestReservations,
  getServiceOffers,
  findDefaultServiceDate,
  bookService,
  appendReservationComment,
  getDepartureDate,
} from "./apaleo";
import { getCatalog, addOrder } from "./store";
import { notifyFrontOffice } from "./notify";
import { formatDateTime } from "./format";

// Security: the guest search must never reveal whether the number or the
// last name was wrong — always the same generic message on any mismatch.
export const GENERIC_LOOKUP_ERROR =
  "Wir konnten keine passende Reservierung finden. Bitte überprüfen Sie Ihre Eingaben oder wenden Sie sich an die Rezeption.";

/**
 * Finds reservation(s) matching a guest-supplied booking/reservation number
 * and last name. Returns an empty array on any kind of mismatch — callers
 * must turn that into the generic error message, never a specific one.
 */
export async function searchReservations(number, lastName) {
  return findGuestReservations(number, lastName);
}

function extractOfferPrice(offer, serviceDate) {
  const dateEntry = (offer?.dates || []).find((d) => d.serviceDate === serviceDate);
  // Apaleo nests the actual number one level deeper than a plain
  // MonetaryValue: dates[].amount.grossAmount for the selected date,
  // falling back to the service-level totalAmount.grossAmount.
  const amount = dateEntry?.amount?.grossAmount ?? offer?.totalAmount?.grossAmount ?? null;
  if (amount === null || amount === undefined) return null;
  const currency = dateEntry?.amount?.currency || offer?.totalAmount?.currency || "EUR";
  return { amount, currency };
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

  const items = [];
  for (const curatedItem of curated) {
    const offer = offersByServiceId.get(curatedItem.serviceId);
    if (!offer) continue; // not sellable for this reservation right now
    const serviceDate = findDefaultServiceDate(offer);
    if (!serviceDate) continue;
    items.push({
      serviceId: curatedItem.serviceId,
      code: curatedItem.code,
      displayName: curatedItem.displayName,
      description: curatedItem.description,
      category: curatedItem.category,
      imageUrl: curatedItem.imageUrl,
      price: extractOfferPrice(offer, serviceDate),
      serviceDate,
    });
  }

  return { items, pastStay: false };
}

/**
 * Books each requested line item directly onto the reservation's folio,
 * then appends (not overwrites) an internal reservation comment summarizing
 * what was booked, and records the order in our own log.
 */
export async function placeGuestOrder({ reservation, propertyId, lines, guestName }) {
  const { items: catalogItems } = await getGuestCatalog(reservation, propertyId);
  const available = new Map(catalogItems.map((item) => [item.serviceId, item]));

  const booked = [];
  const failed = [];

  for (const line of lines) {
    const item = available.get(line.serviceId);
    const count = Number(line.count) || 0;
    if (!item || count <= 0) {
      failed.push({ serviceId: line.serviceId, reason: "nicht verfügbar" });
      continue;
    }
    try {
      await bookService({
        reservationId: reservation.id,
        serviceId: item.serviceId,
        count,
        serviceDate: item.serviceDate,
      });
      booked.push({ ...item, count });
    } catch (err) {
      failed.push({ serviceId: line.serviceId, reason: err.message });
    }
  }

  if (booked.length) {
    const summary = booked.map((b) => `${b.count}x ${b.displayName}`).join(", ");
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
        displayName: b.displayName,
        count: b.count,
        price: b.price,
      })),
    };
    await addOrder(order);
    await notifyFrontOffice(order);
  }

  return { booked, failed };
}
