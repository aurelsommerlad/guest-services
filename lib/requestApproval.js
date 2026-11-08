// Dependency-free rules for approving a request-only ("Auf Anfrage") extra
// (see lib/requests.js's approveRequest) — directly unit-testable with plain
// `node --test`.
//
// Approval books every date the item's booking rule requires (all nights for
// per_night, the arrival/departure day, or the per-stay default date) in ONE
// book-service call with the requested quantity on each date — the same date
// resolution and the same single-call semantics as the instant path
// (lib/guest.js's placeGuestOrder / lib/apaleo.js's bookService).

/**
 * What Apaleo already has for `serviceId` on the reservation, compared with
 * the dates/quantity an approval would book:
 *   - "none":     not booked → book normally
 *   - "complete": already booked on every required date with at least the
 *                 requested count → nothing to book (a repeated approval, or a
 *                 retry after Apaleo accepted the booking but the request
 *                 record could not be updated)
 *   - "conflict": booked, but on other dates or with a lower count → never
 *                 book, because Apaleo's book-service REPLACES a service's
 *                 whole date set and would silently drop existing dates
 */
export function compareExistingBooking(services, serviceId, requiredDates, count) {
  const entry = (Array.isArray(services) ? services : []).find((s) => s?.service?.id === serviceId);
  const dates = Array.isArray(entry?.dates) ? entry.dates : [];
  if (!dates.length) return "none";
  const byDate = new Map(dates.map((d) => [d.serviceDate, Number(d.count) || 0]));
  const covered = requiredDates.every((date) => (byDate.get(date) ?? 0) >= count);
  return covered ? "complete" : "conflict";
}

/** Dates on which the live offer has fewer units available than requested (unknown = enough). */
export function datesWithoutAvailability(offer, dates, quantity) {
  return dates.filter((date) => {
    const entry = (offer?.dates || []).find((d) => d.serviceDate === date);
    const available = entry?.availableCount ?? offer?.availableCount ?? null;
    return available !== null && available !== undefined && available < quantity;
  });
}
