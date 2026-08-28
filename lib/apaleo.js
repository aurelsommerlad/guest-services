import { namesMatch, resolveExternalReferenceMatches } from "./reservationMatching.js";

const APALEO_API_BASE = "https://api.apaleo.com";
const APALEO_IDENTITY_URL = "https://identity.apaleo.com/connect/token";
const APALEO_SCOPES =
  "reservations.read reservations.manage offers.read setup.read folios.read";

export class ApaleoApiError extends Error {
  constructor(message, status, body) {
    super(message);
    this.name = "ApaleoApiError";
    this.status = status;
    this.body = body;
  }
}

// Cached across warm invocations of the same serverless function instance.
// Never sent to the client.
let cachedToken = null; // { accessToken, expiresAt }

async function getAccessToken() {
  const now = Date.now();
  if (cachedToken && cachedToken.expiresAt - 30_000 > now) {
    return cachedToken.accessToken;
  }

  const clientId = process.env.APALEO_CLIENT_ID;
  const clientSecret = process.env.APALEO_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw new Error(
      "APALEO_CLIENT_ID / APALEO_CLIENT_SECRET sind nicht als Environment Variables gesetzt."
    );
  }

  const basicAuth = Buffer.from(`${clientId}:${clientSecret}`).toString("base64");
  const res = await fetch(APALEO_IDENTITY_URL, {
    method: "POST",
    headers: {
      Authorization: `Basic ${basicAuth}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      grant_type: "client_credentials",
      scope: APALEO_SCOPES,
    }),
    cache: "no-store",
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Apaleo-Login fehlgeschlagen (${res.status}): ${text}`);
  }

  const data = await res.json();
  cachedToken = {
    accessToken: data.access_token,
    expiresAt: now + data.expires_in * 1000,
  };
  return cachedToken.accessToken;
}

function safeJsonParse(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

async function apaleoFetch(pathname, { method = "GET", body, searchParams } = {}) {
  const token = await getAccessToken();
  const url = new URL(pathname, APALEO_API_BASE);
  if (searchParams) {
    for (const [key, value] of Object.entries(searchParams)) {
      if (value !== undefined && value !== null && value !== "") {
        url.searchParams.set(key, String(value));
      }
    }
  }

  const res = await fetch(url, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
    cache: "no-store",
  });

  const text = await res.text();
  const data = text ? safeJsonParse(text) : null;

  if (!res.ok) {
    const message =
      data?.message || data?.title || `Apaleo-Anfrage fehlgeschlagen (HTTP ${res.status})`;
    throw new ApaleoApiError(message, res.status, data);
  }

  return data;
}

/**
 * Extracts the YYYY-MM-DD departure date from a reservation, tolerant of
 * the couple of shapes the Apaleo booking API has used for this field.
 */
export function getDepartureDate(reservation) {
  const raw =
    reservation?.departure?.date ||
    reservation?.departure ||
    reservation?.checkOutDate ||
    null;
  return raw ? String(raw).slice(0, 10) : null;
}

/**
 * Extracts the YYYY-MM-DD arrival date from a reservation, mirroring
 * getDepartureDate's tolerance for the shapes the Apaleo booking API uses.
 */
export function getArrivalDate(reservation) {
  const raw =
    reservation?.arrival?.date ||
    reservation?.arrival ||
    reservation?.checkInDate ||
    null;
  return raw ? String(raw).slice(0, 10) : null;
}

export function isPastDate(dateStr, today = new Date()) {
  if (!dateStr) return false;
  const todayStr = today.toISOString().slice(0, 10);
  return dateStr < todayStr;
}

export async function getReservationById(id) {
  if (!id) return null;
  try {
    return await apaleoFetch(`/booking/v1/reservations/${encodeURIComponent(id)}`);
  } catch (err) {
    if (err instanceof ApaleoApiError && err.status === 404) return null;
    throw err;
  }
}

/**
 * Same as getReservationById, but with `timeSlices` expanded — needed
 * immediately before an occupancy amendment (see
 * lib/occupancyAmendment.js), since AmendReservation requires resending
 * every existing time slice's ratePlanId, and we need each slice's current
 * totalGrossAmount to add the extra-person surcharge on top of it rather
 * than letting Apaleo reprice the stay. Verified live via the Apaleo MCP
 * tool: `GET /booking/v1/reservations/{id}?expand=timeSlices` returns one
 * entry per night, each with `ratePlan.id` and `totalGrossAmount`.
 */
export async function getReservationWithTimeSlices(id) {
  if (!id) return null;
  try {
    return await apaleoFetch(`/booking/v1/reservations/${encodeURIComponent(id)}`, {
      searchParams: { expand: "timeSlices" },
    });
  } catch (err) {
    if (err instanceof ApaleoApiError && err.status === 404) return null;
    throw err;
  }
}

/**
 * Same reservation lookup as getReservationWithTimeSlices, but also expands
 * `actions` and `assignedUnits` in the same call — needed immediately
 * before offering/confirming a "stay one more night" extension (see
 * lib/guest.js's getStayExtensionOffer/confirmStayExtension):
 *   - `timeSlices` — the existing per-night accommodation prices, resent
 *     unchanged in the amendment (see lib/stayExtension.js).
 *   - `actions` — Apaleo's own authoritative "is this currently allowed"
 *     flags per possible action (e.g. `{ action: "AmendDeparture",
 *     isAllowed: true }`), verified live to correctly reflect reservation
 *     state (before/after arrival, canceled, etc.) without us having to
 *     reimplement that logic — this is the eligibility gate for the offer.
 *   - `assignedUnits` — the physical unit already assigned, if any, so the
 *     availability check can target that exact unit rather than just the
 *     unit group (see determineConsecutiveFreeNights in lib/guest.js).
 * Verified live via the Apaleo MCP tool: `GET /booking/v1/reservations/{id}
 * ?expand=timeSlices,actions,assignedUnits` returns all three in one call.
 */
export async function getReservationForExtension(id) {
  if (!id) return null;
  try {
    return await apaleoFetch(`/booking/v1/reservations/${encodeURIComponent(id)}`, {
      searchParams: { expand: "timeSlices,actions,assignedUnits" },
    });
  } catch (err) {
    if (err instanceof ApaleoApiError && err.status === 404) return null;
    throw err;
  }
}

/**
 * Amends a reservation's stay details (arrival/departure/adults/
 * childrenAges/timeSlices). Two callers: increasing the guest count for
 * "Extra person"/"Zusatzperson" catalog items (actionType
 * "increase_occupancy", see lib/occupancyAmendment.js) instead of booking a
 * service, and the "stay one more night" upsell extending `departure` by
 * one night (see lib/stayExtension.js) — never booked as a service either.
 * Verified live against a disposable test reservation (see the
 * investigation for the occupancy-amendment feature, reused for the stay
 * extension since it's the same mechanism): passing an explicit
 * `totalGrossAmount` per time slice with `requote: false` preserves every
 * other night's price exactly and adds only what's explicitly specified —
 * Apaleo does not silently reprice on top of it. City tax (a
 * PerPersonPerNight charge already tied to the reservation) recalculates
 * automatically from the new `adults` value or stay length; no separate
 * AddCityTax call is needed or allowed once city tax already exists on a
 * reservation.
 */
export async function amendReservation(id, body) {
  return apaleoFetch(`/booking/v1/reservation-actions/${encodeURIComponent(id)}/amend`, {
    method: "PUT",
    body,
  });
}

export async function findReservationsByBookingId(bookingId) {
  if (!bookingId) return [];
  try {
    const data = await apaleoFetch("/booking/v1/reservations", {
      searchParams: { bookingId },
    });
    return data?.reservations || [];
  } catch (err) {
    if (err instanceof ApaleoApiError && (err.status === 404 || err.status === 400)) return [];
    throw err;
  }
}

/**
 * Guests may type either a single reservation id or a booking id (which can
 * group several reservations, e.g. a multi-room booking). We try both and
 * only return reservations whose last name matches — a mismatch on either
 * field looks identical to the guest (see security note in guest.js).
 */
export async function findGuestReservations(number, lastName) {
  const trimmed = String(number || "").trim();
  if (!trimmed) return [];

  const found = new Map();

  const direct = await getReservationById(trimmed);
  if (direct) found.set(direct.id, direct);

  const byBooking = await findReservationsByBookingId(trimmed);
  for (const r of byBooking) found.set(r.id, r);

  return Array.from(found.values()).filter((r) => namesMatch(r, lastName));
}

/**
 * Searches reservations by an OTA/channel-manager external reference (e.g.
 * a Booking.com confirmation number). Uses Apaleo's own text search
 * (`GET /booking/v1/reservations?textSearch=...`) rather than manually
 * loading and filtering large reservation lists. Verified live against
 * real Booking.com-channel reservations: this account's Booking.com
 * connectivity writes the guest-facing confirmation number into the
 * `externalCode` field (not `externalReferences.onlineTravelAgencyId`,
 * which was empty on every sampled reservation) — textSearch is
 * documented to cover both `externalCode` and the `externalReferences`
 * model, plus the reservation id itself, so this same call also picks up
 * `onlineTravelAgencyId`-style references for accounts/channels that do
 * populate it, without hardcoding any single OTA's field name.
 */
export async function searchReservationsByExternalReference(reference) {
  const trimmed = String(reference || "").trim();
  if (!trimmed) return [];
  try {
    const data = await apaleoFetch("/booking/v1/reservations", {
      searchParams: { textSearch: trimmed },
    });
    return data?.reservations || [];
  } catch (err) {
    if (err instanceof ApaleoApiError && (err.status === 404 || err.status === 400)) return [];
    throw err;
  }
}

/**
 * Full guest-facing lookup: the existing Apaleo booking/reservation number
 * path first (findGuestReservations, completely unchanged above), falling
 * back to an OTA/external-reference search only when that finds nothing.
 * The OTA fallback is intentionally stricter about ambiguity than the
 * existing path (which tolerates multiple reservations under one bookingId
 * and lets the guest pick from a list): if more than one DIFFERENT
 * reservation matches the same external reference and last name, this
 * refuses rather than guessing or showing a picker — `ambiguous: true`
 * tells the caller to show a dedicated "not unique" message instead of the
 * generic lookup error, since a picker could otherwise merge two guests'
 * genuinely different stays under one ambiguous reference.
 */
export async function findGuestReservationsByAnyReference(number, lastName) {
  const direct = await findGuestReservations(number, lastName);
  if (direct.length) {
    return { reservations: direct, ambiguous: false };
  }

  const externalCandidates = await searchReservationsByExternalReference(number);
  return resolveExternalReferenceMatches(externalCandidates, lastName);
}

export async function listProperties() {
  const data = await apaleoFetch("/inventory/v1/properties");
  return data?.properties || [];
}

export async function listExtraServices(propertyId) {
  const data = await apaleoFetch("/rateplan/v1/services", {
    searchParams: { propertyId, onlySoldAsExtras: true },
  });
  return data?.services || [];
}

/**
 * Unit groups (Apaleo's "apartment types") for a property — used by the
 * admin catalog UI to let an extra be restricted to specific apartment
 * types (e.g. "Dog" only in dog-friendly unit groups). See
 * lib/unitGroupRestriction.js for how a reservation's booked unit group is
 * then compared against a catalog item's allowedUnitGroupIds.
 */
export async function listUnitGroups(propertyId) {
  const data = await apaleoFetch("/inventory/v1/unit-groups", {
    searchParams: { propertyId },
  });
  return data?.unitGroups || [];
}

/**
 * A single unit group by id — used for capacity checks (see
 * lib/capacity.js), which need the reservation's own booked unit group,
 * not every unit group at the property. Verified live via the Apaleo MCP
 * tool against GET /inventory/v1/unit-groups/{id}: the response carries
 * `maxPersons` (a single integer, e.g. 5 for a 5-guest apartment) — the
 * maximum total occupancy for that apartment type, not the assigned
 * physical unit.
 */
export async function getUnitGroup(unitGroupId) {
  if (!unitGroupId) return null;
  try {
    return await apaleoFetch(`/inventory/v1/unit-groups/${encodeURIComponent(unitGroupId)}`);
  } catch (err) {
    if (err instanceof ApaleoApiError && err.status === 404) return null;
    throw err;
  }
}

/**
 * Per-night availability for a unit group over [from, to) — one entry per
 * night (never a single aggregate count for the whole window), each
 * carrying `availableCount` and `physicalCount` for that specific night.
 * This is what lib/guest.js's determineConsecutiveFreeNights uses to find
 * how many CONSECUTIVE nights are free right after a reservation's
 * departure for the "stay one more night" upsell — an aggregate count
 * would hide exactly the "free for night 1, sold for night 2" case this
 * feature must detect. Verified live via the Apaleo MCP tool against
 * `GET /availability/v1/unit-groups?propertyId=...&unitGroupIds=...&from=...&to=...`.
 */
export async function getUnitGroupNightlyAvailability(propertyId, unitGroupId, fromDate, toDate) {
  if (!propertyId || !unitGroupId || !fromDate || !toDate) return [];
  const data = await apaleoFetch("/availability/v1/unit-groups", {
    searchParams: { propertyId, unitGroupIds: unitGroupId, from: fromDate, to: toDate },
  });
  return data?.timeSlices || [];
}

/**
 * Whether `unitId` specifically — not just its unit group — is free for
 * [fromDateTime, toDateTime). Used only when a physical unit is already
 * assigned to the reservation, so the "stay one more night" offer is never
 * shown when it would risk moving the guest to a different apartment for
 * the extra night (see lib/guest.js's determineConsecutiveFreeNights).
 * Verified live via the Apaleo MCP tool against
 * `GET /availability/v1/units?propertyId=...&unitGroupId=...&from=...&to=...`.
 */
export async function isUnitAvailable(propertyId, unitGroupId, unitId, fromDateTime, toDateTime) {
  if (!propertyId || !unitGroupId || !unitId || !fromDateTime || !toDateTime) return false;
  const data = await apaleoFetch("/availability/v1/units", {
    searchParams: { propertyId, unitGroupId, from: fromDateTime, to: toDateTime },
  });
  const units = data?.units || [];
  return units.some((u) => u.id === unitId);
}

/**
 * Apaleo service/property names can be plain strings or localized objects
 * like { "de-DE": "Frühstück", "en-US": "Breakfast" }.
 */
export function pickLocalizedText(value) {
  if (!value) return "";
  if (typeof value === "string") return value;
  return value["de-DE"] || value.de || value["en-US"] || value.en || Object.values(value)[0] || "";
}

/**
 * Normalizes an Apaleo name/description field down to { de, en }. Verified
 * live shape (GET /rateplan/v1/services/{id}?languages=de,en): a map with
 * two-letter keys, e.g. { "de": "Parkplatz", "en": "Car park" } — distinct
 * from pickLocalizedText's "de-DE"/"en-US" shape, which is what the admin
 * services LIST endpoint (without a languages param) returns, and only as
 * a single already-resolved string, never a map. Tolerant of both key
 * styles and of a plain string (single-language service) regardless.
 */
function localizedMapFromApaleo(value) {
  if (!value) return { de: "", en: "" };
  if (typeof value === "string") return { de: value, en: value };
  const de = value.de || value["de-DE"] || "";
  const en = value.en || value["en-US"] || "";
  return {
    de: de || en || Object.values(value)[0] || "",
    en: en || de || Object.values(value)[0] || "",
  };
}

/**
 * Fetches a single service's name/description in both German and English.
 * This is the fix for extras showing an English name/description to German
 * guests (e.g. LAEKE-PKW's "Car park"): the curated catalog only ever
 * stored whichever single, unlocalized string the admin services LIST
 * endpoint happened to return once at curation time — this endpoint
 * (confirmed live) is the only one that actually returns localized content,
 * via `languages=de,en`. Never throws — a lookup failure just means the
 * guest sees the curated catalog's existing fallback text instead.
 */
export async function getServiceLocalized(serviceId) {
  if (!serviceId) return null;
  try {
    const data = await apaleoFetch(`/rateplan/v1/services/${encodeURIComponent(serviceId)}`, {
      searchParams: { languages: "de,en" },
    });
    return {
      name: localizedMapFromApaleo(data?.name),
      description: localizedMapFromApaleo(data?.description),
    };
  } catch (err) {
    console.error(`getServiceLocalized: konnte Service ${serviceId} nicht laden:`, err);
    return null;
  }
}

/**
 * Fix #3: service-offers returns HTTP 422 ("Services cannot be booked for a
 * reservation in the past.") once the departure date is in the past. We
 * check the date up front to skip the doomed call entirely, and still
 * catch the 422 as a safety net for timezone edge cases on the departure
 * day itself. Either way we return an empty, flagged catalog instead of
 * throwing, so the guest sees a friendly message instead of a 502.
 */
export async function getServiceOffers(reservationId, departureDate) {
  if (isPastDate(departureDate)) {
    return { items: [], pastStay: true };
  }
  try {
    const data = await apaleoFetch(
      `/booking/v1/reservations/${encodeURIComponent(reservationId)}/service-offers`
    );
    if (data && !Array.isArray(data.services)) {
      // Apaleo's actual response field is `services` (confirmed against a
      // live reservation) — this catches a future shape drift loudly
      // instead of silently degrading to an empty catalog again.
      console.error(
        `getServiceOffers: unerwartete Antwortform für Reservierung ${reservationId} - kein "services"-Array. Erhaltene Felder: ${Object.keys(
          data
        ).join(", ")}`
      );
    }
    return { items: data?.services || [], pastStay: false };
  } catch (err) {
    if (err instanceof ApaleoApiError && err.status === 422) {
      return { items: [], pastStay: true };
    }
    throw err;
  }
}

/**
 * Picks the earliest `isDefaultDate: true` entry for a service offer
 * (falling back to the earliest date at all). Used to book a single,
 * explicit date instead of letting Apaleo default to "every night".
 */
export function findDefaultServiceDate(offer) {
  const dates = offer?.dates || [];
  if (!dates.length) return null;
  const defaults = dates.filter((d) => d.isDefaultDate);
  const pool = defaults.length ? defaults : dates;
  const sorted = [...pool].sort((a, b) =>
    String(a.serviceDate).localeCompare(String(b.serviceDate))
  );
  return sorted[0]?.serviceDate || null;
}

/**
 * Fix #1: without an explicit `dates` array, Apaleo defaults to booking the
 * service on every default date (usually every night of the stay), and
 * `count` applies per date — a guest-selected quantity of 2 on a 3-night
 * stay would silently become 6. We always pass an explicit `dates` array
 * with the full guest-selected count on every entry.
 *
 * Fix #4: Apaleo's book-service action REPLACES a service's whole date set
 * on every call — it does not merge into whatever dates were already
 * booked. A caller that booked a per-night service one date at a time (one
 * call per night) therefore silently lost every previously booked night
 * each time it added the next one, leaving only the most recent night
 * booked (observed in production for HUESLE-HUND across a multi-night
 * stay). Every date a single logical booking needs — one selected date, an
 * arrival/departure day, or every night of the stay — must go into ONE
 * call's `dates` array via `serviceDates`. `serviceDate` (singular) is kept
 * for the one remaining caller that only ever books a single date
 * (lib/requests.js's admin-approval flow, unaffected by this fix).
 */
export async function bookService({ reservationId, serviceId, count, serviceDate, serviceDates, amount }) {
  const resolvedDates = serviceDates && serviceDates.length ? serviceDates : serviceDate ? [serviceDate] : [];
  const dates = resolvedDates.map((date) => ({
    serviceDate: date,
    count,
    ...(amount ? { amount: { amount: amount.amount, currency: amount.currency } } : {}),
  }));

  // Logged right before the one-and-only request this logical booking
  // makes, so production logs can confirm a single call carries every date
  // instead of one call per date. No guest name/email or payment data:
  // reservationId/serviceId are Apaleo identifiers, not personal data.
  console.log(
    `[Apaleo] book-service reservationId=${reservationId} serviceId=${serviceId} dates=${
      dates.length
    } serviceDates=${resolvedDates.join(",")}`
  );

  return apaleoFetch(
    `/booking/v1/reservation-actions/${encodeURIComponent(reservationId)}/book-service`,
    {
      method: "PUT",
      body: {
        serviceId,
        count,
        dates,
      },
    }
  );
}

/**
 * Fix #2: appends to (rather than overwrites) the reservation's internal
 * `comment` field via JSON Patch, so the front office sees a running log of
 * everything booked through the guest portal.
 */
export async function appendReservationComment(reservationId, text) {
  const reservation = await getReservationById(reservationId);
  const existing = reservation?.comment || "";
  const nextComment = existing ? `${existing}\n${text}` : text;
  return apaleoFetch(`/booking/v1/reservations/${encodeURIComponent(reservationId)}`, {
    method: "PATCH",
    body: [{ op: "add", path: "/comment", value: nextComment }],
  });
}

/**
 * Saves the primary guest's vehicle registration (license plate) on a
 * reservation — used for catalog items configured with
 * requiresVehicleRegistration (e.g. parking). Verified live via the Apaleo
 * MCP tool against a disposable sandbox reservation before this was
 * implemented: `PATCH /booking/v1/reservations/{id}` with JSON Patch op
 * "add" on path "/primaryGuest/vehicleRegistration" is honored exactly as
 * sent, safely overwrites an existing value on resend (RFC 6902 "add"
 * semantics — no need to first check whether a value is already present),
 * and never touches any other primaryGuest field (firstName/lastName/etc.
 * confirmed unchanged after the patch). See lib/vehicleRegistration.js for
 * the payload shape this is called with.
 */
export async function updatePrimaryGuestVehicleRegistration(reservationId, { number, countryCode }) {
  return apaleoFetch(`/booking/v1/reservations/${encodeURIComponent(reservationId)}`, {
    method: "PATCH",
    body: [{ op: "add", path: "/primaryGuest/vehicleRegistration", value: { number, countryCode } }],
  });
}
