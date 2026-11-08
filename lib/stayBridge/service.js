import {
  getArrivalDate,
  getDepartureDate,
  getReservationServices,
  getServiceLocalized,
  pickLocalizedText,
} from "../apaleo.js";
import { getGuestCatalog, getStayExtensionOffer, placeGuestOrder, confirmStayExtension } from "../guest.js";
import { createGuestRequest } from "../requests.js";
import { listRequests, listExtensionRecords } from "../store.js";
import { countBookedServiceQuantity } from "../dogBooking.js";
import { deleteKey, setIfNotExistsWithTtl } from "../db.js";
import { isValidIdempotencyKey, runIdempotent } from "./idempotency.js";

// The bridge's business operations. Every rule, price, date and limit comes
// from the existing Extras code, called unchanged: getGuestCatalog,
// placeGuestOrder (instant services, incl. extra person via
// increase_occupancy), createGuestRequest ("Auf Anfrage"),
// getStayExtensionOffer/confirmStayExtension (extension night). The bridge
// only adds what a second client needs: input validation, a stable response
// shape, a binding-price check, duplicate protection and idempotency.

const SERVICE_ID = /^[A-Za-z0-9_-]{1,120}$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const MAX_COUNT = 20;
/** Short lock against two parallel bookings of the same service (double tap, two devices). */
const BOOKING_LOCK_SECONDS = 60;

const FAILURE_CODES = new Map([
  ["capacity_exceeded", { status: 409, error: "capacity_exceeded" }],
  ["dog_limit_exceeded", { status: 409, error: "limit_reached" }],
  ["vehicle_registration_required", { status: 400, error: "vehicle_registration_required" }],
  ["vehicle_registration_update_failed", { status: 502, error: "booking_failed" }],
  ["nicht verfügbar", { status: 409, error: "not_available" }],
  ["Apartmenttyp nicht erlaubt", { status: 409, error: "not_available" }],
]);

function money(value) {
  if (!value || typeof value.amount !== "number") return null;
  return { amountCents: Math.round(value.amount * 100), currency: value.currency || "EUR" };
}

function serialize(item, bookedCount) {
  return {
    serviceId: item.serviceId,
    code: item.code || null,
    name: item.displayName,
    description: item.description,
    category: item.category || null,
    imageUrl: item.imageUrl || null,
    actionType: item.actionType,
    bookingRule: item.bookingRule,
    fulfillment: item.fulfillmentMode || "instant",
    priceUnitLabel: item.priceUnitLabel,
    unitPrice: money(item.unitPrice),
    nights: item.nights,
    price: money(item.price),
    serviceDates: item.serviceDates || [],
    restricted: Boolean(item.unitGroupRestricted),
    maxQuantity: Number.isFinite(item.maxQuantity) ? item.maxQuantity : null,
    maxOnePerReservation: Boolean(item.maxOnePerReservation),
    bookedCount,
    requiresVehicleRegistration: Boolean(item.requiresVehicleRegistration),
    existingVehicleRegistration: item.existingVehicleRegistration || null,
  };
}

function serializeExtension(offer) {
  if (!offer) return null;
  return {
    currentDeparture: offer.currentDeparture,
    newDeparture: offer.newDeparture,
    phase: offer.phase || null,
    discountPercent: offer.discountPercent ?? null,
    extensionPrice: money(offer.extensionPrice),
    extras: (offer.extras || []).map((extra) => ({
      serviceId: extra.serviceId,
      name: extra.name,
      amountCents: typeof extra.amount === "number" ? Math.round(extra.amount * 100) : null,
    })),
    cityTaxCents: offer.cityTax && typeof offer.cityTax.amount === "number"
      ? Math.round(offer.cityTax.amount * 100)
      : typeof offer.cityTax === "number"
      ? Math.round(offer.cityTax * 100)
      : null,
    totalPrice: money(offer.totalPrice),
  };
}

/** Catalog for one reservation (guest-facing items + extension night). */
export async function bridgeCatalog({ reservation }) {
  const catalog = await getGuestCatalog(reservation, reservation.property?.id);
  if (catalog.pastStay) return { status: 200, body: { pastStay: true, items: [], extension: null } };
  const services = await getReservationServices(reservation.id);
  const extension = await getStayExtensionOffer(reservation);
  return {
    status: 200,
    body: {
      pastStay: false,
      arrival: getArrivalDate(reservation),
      departure: getDepartureDate(reservation),
      items: catalog.items.map((item) => serialize(item, countBookedServiceQuantity(services, item.serviceId))),
      extension: serializeExtension(extension),
    },
  };
}

function guestNameOf(reservation) {
  const guest = reservation?.primaryGuest || {};
  return [guest.firstName, guest.lastName].filter(Boolean).join(" ").trim() || "STAY";
}

function sameMoney(a, b) {
  return a && b && a.amountCents === b.amountCents && a.currency === b.currency;
}

function badRequest(detail) {
  return { status: 400, body: { error: "bad_request" }, audit: { detail } };
}

/**
 * Instant booking of one service (or the extra-person amendment). The
 * binding price the guest confirmed must still equal the freshly computed
 * one; an already booked service cannot be booked a second time through
 * STAY; parallel attempts for the same service are refused.
 */
export async function bridgeOrder({ reservation, body }) {
  const { idempotencyKey, serviceId, count, vehiclePlates, expectedPrice } = body;
  if (!isValidIdempotencyKey(idempotencyKey)) return badRequest("idempotency_key");
  if (typeof serviceId !== "string" || !SERVICE_ID.test(serviceId)) return badRequest("service_id");
  if (!Number.isInteger(count) || count < 1 || count > MAX_COUNT) return badRequest("count");
  if (vehiclePlates !== undefined && (!Array.isArray(vehiclePlates) || vehiclePlates.length > MAX_COUNT || vehiclePlates.some((p) => typeof p !== "string" || p.length > 20))) {
    return badRequest("vehicle_plates");
  }
  const expected = expectedPrice && Number.isInteger(expectedPrice.amountCents) && typeof expectedPrice.currency === "string"
    ? { amountCents: expectedPrice.amountCents, currency: expectedPrice.currency }
    : null;
  if (!expected) return badRequest("expected_price");
  const audit = { serviceId, idempotencyKey };

  const result = await runIdempotent(`order:${reservation.id}`, idempotencyKey, async () => {
    const lock = `stay-bridge:lock:${reservation.id}:${serviceId}`;
    if (!(await setIfNotExistsWithTtl(lock, "1", BOOKING_LOCK_SECONDS))) {
      return { status: 409, body: { error: "in_progress" } };
    }
    try {
      // Fresh catalog + live services: availability, price and "already
      // booked" are re-checked immediately before anything is booked.
      const { items } = await getGuestCatalog(reservation, reservation.property?.id);
      const item = items.find((candidate) => candidate.serviceId === serviceId);
      if (!item || (item.fulfillmentMode || "instant") !== "instant") {
        return { status: 409, body: { error: "not_available" } };
      }
      if (item.unitGroupRestricted) return { status: 409, body: { error: "not_available" } };
      if (item.actionType !== "increase_occupancy") {
        const services = await getReservationServices(reservation.id);
        if (countBookedServiceQuantity(services, serviceId) > 0) {
          return { status: 409, body: { error: "already_booked" } };
        }
      }
      const unit = money(item.unitPrice);
      const fresh = unit ? { amountCents: unit.amountCents * count * (item.nights || 1), currency: unit.currency } : null;
      if (!sameMoney(fresh, expected)) {
        return { status: 409, body: { error: "price_changed", price: fresh } };
      }
      const outcome = await placeGuestOrder({
        reservation,
        propertyId: reservation.property?.id,
        lines: [{ serviceId, count, ...(vehiclePlates ? { vehiclePlates } : {}) }],
        guestName: guestNameOf(reservation),
      });
      if (outcome.booked.length === 0) {
        const reason = outcome.failed[0]?.reason;
        const mapped = FAILURE_CODES.get(reason) || { status: 502, error: "booking_failed" };
        return { status: mapped.status, body: { error: mapped.error } };
      }
      const booked = outcome.booked[0];
      return {
        status: 201,
        body: {
          status: "booked",
          serviceId,
          count: booked.count,
          serviceDates: booked.serviceDates || [],
          price: fresh,
        },
      };
    } finally {
      await deleteKey(lock).catch(() => undefined);
    }
  });
  return { ...result, audit };
}

/** Request for a request-only ("Auf Anfrage") service; staff decide in Extras. */
export async function bridgeRequest({ reservation, body }) {
  const { idempotencyKey, serviceId, quantity } = body;
  if (!isValidIdempotencyKey(idempotencyKey)) return badRequest("idempotency_key");
  if (typeof serviceId !== "string" || !SERVICE_ID.test(serviceId)) return badRequest("service_id");
  if (!Number.isInteger(quantity) || quantity < 1 || quantity > MAX_COUNT) return badRequest("quantity");
  const audit = { serviceId, idempotencyKey };

  const result = await runIdempotent(`request:${reservation.id}`, idempotencyKey, async () => {
    const lock = `stay-bridge:lock:${reservation.id}:request:${serviceId}`;
    if (!(await setIfNotExistsWithTtl(lock, "1", BOOKING_LOCK_SECONDS))) {
      return { status: 409, body: { error: "in_progress" } };
    }
    try {
      const open = (await listRequests()).find(
        (r) => r.reservationId === reservation.id && r.serviceId === serviceId && (r.status === "pending" || r.status === "approved"),
      );
      if (open) return { status: 409, body: { error: "already_requested", status: open.status } };
      const { items } = await getGuestCatalog(reservation, reservation.property?.id);
      const item = items.find((candidate) => candidate.serviceId === serviceId && (candidate.fulfillmentMode || "instant") === "request");
      if (!item || item.unitGroupRestricted) return { status: 409, body: { error: "not_available" } };
      const record = await createGuestRequest({
        reservation,
        propertyId: reservation.property?.id,
        propertyName: pickLocalizedText(reservation.property?.name),
        item,
        quantity,
        guestName: guestNameOf(reservation),
        guestEmail: "",
      });
      return { status: 201, body: { status: "pending", requestId: record.requestId, serviceId } };
    } finally {
      await deleteKey(lock).catch(() => undefined);
    }
  });
  return { ...result, audit };
}

/** The extension night, re-derived and confirmed by the existing Extras logic. */
export async function bridgeStayExtension({ reservation, body }) {
  const { idempotencyKey, currentDeparture, expectedPrice } = body;
  if (!isValidIdempotencyKey(idempotencyKey)) return badRequest("idempotency_key");
  if (typeof currentDeparture !== "string" || !DATE.test(currentDeparture)) return badRequest("current_departure");
  const audit = { serviceId: "stay-extension", idempotencyKey };

  const result = await runIdempotent(`extension:${reservation.id}`, idempotencyKey, async () => {
    // Binding price check against a fresh offer before the existing confirm
    // (which recomputes everything again itself under its own claim).
    const offer = serializeExtension(await getStayExtensionOffer(reservation));
    if (!offer || offer.currentDeparture !== currentDeparture) {
      return { status: 409, body: { error: "not_available" } };
    }
    if (!expectedPrice || !sameMoney(offer.totalPrice, expectedPrice)) {
      return { status: 409, body: { error: "price_changed", price: offer.totalPrice } };
    }
    try {
      const confirmed = await confirmStayExtension({ reservationId: reservation.id, expectedCurrentDeparture: currentDeparture });
      return {
        status: 201,
        body: { status: "booked", newDeparture: confirmed.newDeparture, price: money(confirmed.extensionPrice) },
      };
    } catch (err) {
      if (err?.reason === "stay_extension_unavailable") return { status: 409, body: { error: "not_available" } };
      throw err;
    }
  });
  return { ...result, audit };
}

/**
 * "Gebucht & angefragt": what Apaleo has on the reservation (from any
 * source), the requests of this reservation with their Extras status, and
 * extension nights. Apaleo does not keep removed services, so cancelled
 * services are not reported — only what the sources reliably provide.
 */
export async function bridgeOverview({ reservation }) {
  const services = await getReservationServices(reservation.id);
  const extras = services.filter((entry) => entry?.service?.id && !entry.isMandatory);
  const localized = await Promise.all(extras.map((entry) => getServiceLocalized(entry.service.id).catch(() => null)));
  const booked = extras.map((entry, index) => {
    const dates = Array.isArray(entry.dates) ? entry.dates : [];
    const total = dates.reduce((sum, d) => sum + (Number(d?.amount?.grossAmount) || 0), 0);
    const fallback = pickLocalizedText(entry.service?.name) || entry.service.id;
    return {
      serviceId: entry.service.id,
      name: { de: localized[index]?.name?.de || fallback, en: localized[index]?.name?.en || fallback },
      count: countBookedServiceQuantity(services, entry.service.id),
      dates: dates.map((d) => d.serviceDate).filter(Boolean),
      total: dates.length ? { amountCents: Math.round(total * 100), currency: dates[0]?.amount?.currency || "EUR" } : null,
    };
  });
  const requests = (await listRequests())
    .filter((r) => r.reservationId === reservation.id)
    .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))
    .map((r) => ({
      requestId: r.requestId,
      serviceId: r.serviceId,
      serviceName: r.serviceName,
      quantity: r.requestedQuantity,
      status: r.status, // pending | approved | rejected — the only states Extras has
      createdAt: r.createdAt,
      decidedAt: r.approvedAt || r.rejectedAt || null,
    }));
  const extensions = (await listExtensionRecords())
    .filter((r) => r.reservationId === reservation.id)
    .map((r) => ({ newDeparture: r.newDeparture, status: r.status, createdAt: r.createdAt }));
  return { status: 200, body: { booked, requests, extensions } };
}
