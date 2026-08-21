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

const COMBINING_DIACRITICS = new RegExp("[\\u0300-\\u036f]", "g");

function normalizeName(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .normalize("NFKD")
    .replace(COMBINING_DIACRITICS, "");
}

function reservationLastNameCandidates(reservation) {
  return [
    reservation?.primaryGuest?.lastName,
    reservation?.booker?.lastName,
    reservation?.guest?.lastName,
    reservation?.person?.lastName,
  ].filter(Boolean);
}

function namesMatch(reservation, lastName) {
  const target = normalizeName(lastName);
  if (!target) return false;
  return reservationLastNameCandidates(reservation).some(
    (candidate) => normalizeName(candidate) === target
  );
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

export async function listProperties() {
  const data = await apaleoFetch("/setup/v1/properties");
  return data?.properties || [];
}

export async function listExtraServices(propertyId) {
  const data = await apaleoFetch("/rateplan/v1/services", {
    searchParams: { propertyId, onlySoldAsExtras: true },
  });
  return data?.services || [];
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
    return { items: data?.offers || [], pastStay: false };
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
 * stay would silently become 6. We always pass a single explicit date with
 * the full guest-selected count.
 */
export async function bookService({ reservationId, serviceId, count, serviceDate }) {
  return apaleoFetch(
    `/booking/v1/reservation-actions/${encodeURIComponent(reservationId)}/book-service`,
    {
      method: "PUT",
      body: {
        serviceId,
        count,
        dates: [{ serviceDate, count }],
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
