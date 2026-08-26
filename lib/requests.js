import crypto from "crypto";
import {
  getReservationById,
  getServiceOffers,
  getArrivalDate,
  getDepartureDate,
  bookService,
  appendReservationComment,
  getUnitGroup,
} from "./apaleo";
import { resolveRequiredDates } from "./guest";
import { getReservationUnitGroupId, isUnitGroupAllowed } from "./unitGroupRestriction";
import { getRemainingCapacity } from "./capacity";
import {
  getCatalog,
  getRequestById,
  createRequestRecord,
  updateRequestRecord,
  claimRequestProcessing,
  releaseRequestProcessing,
} from "./store";
import { notifyNewRequest } from "./notify";
import { formatDateTime } from "./format";

/**
 * Creates a request-only extra record ("Auf Anfrage"). Never calls Apaleo —
 * request-only extras are booked later, only after staff approval (see
 * approveRequest below). Persists the record first, then attempts a Slack
 * notification; a Slack failure must never surface to the guest, so it is
 * only logged (see notifyNewRequest itself).
 */
export async function createGuestRequest({
  reservation,
  propertyId,
  propertyName,
  item,
  quantity,
  guestName,
  guestEmail,
}) {
  const record = {
    requestId: crypto.randomUUID(),
    reservationId: reservation.id,
    bookingId: reservation.bookingId || null,
    propertyId,
    propertyName: propertyName || reservation?.property?.name || null,
    serviceId: item.serviceId,
    // Admin-facing (the requests queue and Slack notifications stay
    // German) — item.displayName is the bilingual { de, en } object built
    // in getGuestCatalog, regardless of which language the guest was using.
    serviceName: item.displayName.de,
    guestName,
    guestEmail: guestEmail || null,
    requestedQuantity: quantity,
    requestedServiceDate: item.serviceDates?.[0] || null,
    displayedPrice: item.price?.amount ?? item.unitPrice?.amount ?? null,
    currency: item.price?.currency || item.unitPrice?.currency || "EUR",
    arrivalDate: getArrivalDate(reservation),
    departureDate: getDepartureDate(reservation),
    status: "pending",
    slackNotifiedAt: null,
    approvedAt: null,
    rejectedAt: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  // Persist BEFORE any notification attempt (see spec: validate -> persist -> notify).
  await createRequestRecord(record);

  try {
    await notifyNewRequest(record);
  } catch (err) {
    // notifyNewRequest already catches its own errors; this is an extra
    // safety net so a request submission can never fail on notification.
    console.error(`Slack-Benachrichtigung für Anfrage ${record.requestId} fehlgeschlagen:`, err);
  }

  return record;
}

/**
 * Approves a pending request: re-verifies everything against LIVE Apaleo
 * data (never trusts what was true at request-creation time), then books
 * the service and marks the request approved. If any check fails, or the
 * Apaleo booking call itself fails, the request is left "pending" with a
 * useful error message — it is never silently marked approved.
 *
 * Concurrency: claimRequestProcessing is an atomic, cross-instance-safe
 * claim (see lib/store.js) that prevents two concurrent approve calls (or
 * an approve racing a reject) for the same requestId from both proceeding,
 * which would otherwise risk a duplicate Apaleo booking.
 */
export async function approveRequest(requestId) {
  console.log(`[Approve] starting approval for requestId: ${requestId}`);
  const claimed = await claimRequestProcessing(requestId);
  if (!claimed) {
    console.log(`[Approve] requestId ${requestId} is already being processed - refusing concurrent approval.`);
    return { success: false, error: "Diese Anfrage wird bereits bearbeitet." };
  }

  try {
    const request = await getRequestById(requestId);
    if (!request) {
      console.log(`[Approve] requestId ${requestId} not found.`);
      return { success: false, error: "Anfrage nicht gefunden." };
    }
    if (request.status !== "pending") {
      console.log(`[Approve] requestId ${requestId} is not pending (status=${request.status}) - refusing.`);
      return { success: false, error: "Diese Anfrage wurde bereits bearbeitet." };
    }

    // Everything from here down re-derives the current Apaleo/catalog truth
    // from scratch — nothing on the stored request record is trusted for
    // the actual booking decision. Any failure along the way (including a
    // network/Apaleo outage) must leave the request "pending" with a real
    // error, never throw uncaught and never mark it approved.
    let reservation, offer, bookingRule, requiredDates, serviceDate;
    try {
      reservation = await getReservationById(request.reservationId);
      if (!reservation) {
        return { success: false, error: "Die Reservierung wurde nicht gefunden." };
      }

      const departureDate = getDepartureDate(reservation);
      const { items: offers, pastStay } = await getServiceOffers(reservation.id, departureDate);
      if (pastStay) {
        return { success: false, error: "Der Aufenthalt liegt bereits in der Vergangenheit." };
      }

      offer = offers.find((o) => o?.service?.id === request.serviceId);
      if (!offer) {
        return { success: false, error: "Dieser Service wird für die Reservierung nicht mehr angeboten." };
      }

      // The booking rule is looked up fresh from the current catalog, not
      // from anything cached on the request, so an admin change to the rule
      // (e.g. Early Check-in configured as arrival_day) always applies.
      const catalogItems = await getCatalog(request.propertyId);
      const catalogItem = catalogItems.find((i) => i.serviceId === request.serviceId);
      if (!catalogItem || !catalogItem.active) {
        return { success: false, error: "Dieses Extra ist im Katalog nicht mehr aktiv." };
      }

      // Same restriction the guest already saw before submitting the
      // request (see lib/guest.js's getGuestCatalog), re-verified fresh
      // here too — never trust that the reservation's unit assignment or
      // the catalog's allowedUnitGroupIds are still what they were when the
      // request was created.
      const reservationUnitGroupId = getReservationUnitGroupId(reservation);
      if (!isUnitGroupAllowed(catalogItem.allowedUnitGroupIds, reservationUnitGroupId)) {
        return { success: false, error: "Dieses Extra ist für den gebuchten Apartmenttyp nicht verfügbar." };
      }

      // Same booking-safety re-check as the instant path (lib/guest.js's
      // placeGuestOrder) for requiresRemainingCapacity extras (e.g. "Extra
      // person") — re-derived fresh, never trusting whatever was true when
      // the guest originally submitted the request.
      if (catalogItem.requiresRemainingCapacity) {
        const unitGroup = await getUnitGroup(reservationUnitGroupId);
        const remainingCapacity = getRemainingCapacity(unitGroup, reservation);
        if (request.requestedQuantity > remainingCapacity) {
          return { success: false, error: "Für diese Buchung ist keine weitere Person mehr möglich." };
        }
      }

      bookingRule = catalogItem.bookingRule || "per_stay";

      const resolved = resolveRequiredDates(bookingRule, offer, reservation);
      requiredDates = resolved.dates;
      if (!resolved.complete) {
        return { success: false, error: "Das erforderliche Datum ist für diesen Service nicht mehr verfügbar." };
      }

      serviceDate =
        request.requestedServiceDate && requiredDates.includes(request.requestedServiceDate)
          ? request.requestedServiceDate
          : requiredDates[0];
      if (request.requestedServiceDate && !requiredDates.includes(request.requestedServiceDate)) {
        return { success: false, error: "Das angefragte Datum ist nicht mehr verfügbar." };
      }

      const dateEntry = (offer.dates || []).find((d) => d.serviceDate === serviceDate);
      const availableCount = dateEntry?.availableCount ?? offer?.availableCount ?? null;
      if (availableCount !== null && availableCount !== undefined && availableCount < request.requestedQuantity) {
        return { success: false, error: "Nicht genügend Verfügbarkeit für die angefragte Menge." };
      }
    } catch (err) {
      console.error(`[Approve] re-verification against Apaleo failed for requestId ${requestId}:`, err);
      return { success: false, error: `Verfügbarkeit konnte nicht erneut geprüft werden: ${err.message}` };
    }

    console.log(
      `[Approve] requestId ${requestId} verified OK - booking serviceId=${request.serviceId} serviceDate=${serviceDate} count=${request.requestedQuantity} on reservation ${reservation.id}`
    );

    try {
      await bookService({
        reservationId: reservation.id,
        serviceId: request.serviceId,
        count: request.requestedQuantity,
        serviceDate,
      });
    } catch (err) {
      // Apaleo booking failed: the request stays pending so an admin can
      // retry, and the real error is surfaced instead of a generic one.
      console.error(`[Approve] Apaleo bookService failed for requestId ${requestId}:`, err);
      return { success: false, error: `Buchung bei Apaleo fehlgeschlagen: ${err.message}` };
    }

    console.log(`[Approve] Apaleo booking succeeded for requestId ${requestId}`);

    const commentText = `[Gäste-Portal ${formatDateTime(new Date())}] Anfrage bestätigt: ${request.requestedQuantity}x ${request.serviceName}`;
    await appendReservationComment(reservation.id, commentText).catch((err) => {
      console.error("Konnte Reservierungskommentar nicht ergänzen:", err);
    });

    const updated = await updateRequestRecord(requestId, {
      status: "approved",
      approvedAt: new Date().toISOString(),
    });

    console.log(`[Approve] requestId ${requestId} marked approved.`);
    return { success: true, request: updated };
  } finally {
    await releaseRequestProcessing(requestId);
  }
}

/**
 * Rejects a pending request. Never touches Apaleo. Guarded against acting
 * twice on an already-resolved request.
 */
export async function rejectRequest(requestId) {
  const request = await getRequestById(requestId);
  if (!request) {
    return { success: false, error: "Anfrage nicht gefunden." };
  }
  if (request.status !== "pending") {
    return { success: false, error: "Diese Anfrage wurde bereits bearbeitet." };
  }

  const updated = await updateRequestRecord(requestId, {
    status: "rejected",
    rejectedAt: new Date().toISOString(),
  });

  return { success: true, request: updated };
}
