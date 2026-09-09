// Dependency-free (same reasoning as lib/unitGroupRestriction.js/
// lib/capacity.js — directly unit-testable with plain `node --test`, no
// live Apaleo access needed) — the pure logic behind the "maximum 1 dog
// per reservation/apartment" rule. Generic over any catalog item flagged
// `maxOnePerReservation` (see lib/store.js's catalog schema), not
// hardcoded to any single property's dog service id (e.g. "HUESLE-HUND"),
// since serviceIds are per-property.
//
// CRITICAL: a dog service is represented in Apaleo's
// GET .../reservations/{id}/services response (see lib/apaleo.js's
// getReservationServices) as exactly ONE entry with one `dates[]` entry
// per booked NIGHT — never one entry per dog. A dog booked for 6 nights
// has 6 date entries but `count: 1` on every one of them. The functions
// below therefore read `count` off a single date entry, NEVER
// `dates.length` — a long multi-night stay must never be miscounted as
// multiple dogs.

/**
 * How many of `serviceId` are currently booked on this reservation, per
 * Apaleo's live `services` response — 0 if the service isn't booked at
 * all. Reads `count` from one date entry (uniform across every date of the
 * same booking), never the number of dates.
 */
export function countBookedServiceQuantity(services, serviceId) {
  const entry = (Array.isArray(services) ? services : []).find((s) => s?.service?.id === serviceId);
  const dates = entry?.dates;
  if (!Array.isArray(dates) || !dates.length) return 0;
  const count = Number(dates[0]?.count);
  return Number.isFinite(count) ? count : 0;
}

export const MAX_DOGS_PER_RESERVATION = 1;

/** True once `serviceId` is already booked at/above the max-1 limit. */
export function hasReachedDogLimit(services, serviceId) {
  return countBookedServiceQuantity(services, serviceId) >= MAX_DOGS_PER_RESERVATION;
}
