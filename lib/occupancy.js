// Dependency-free (see lib/priceDisplay.js / lib/unitGroupRestriction.js for
// why) — pure occupancy counting from a raw Apaleo reservation object.
// Single source of truth shared by lib/reservationSummary.js (the guest
// summary's people count) and lib/capacity.js (remaining-capacity math), so
// the adults/children rule is defined exactly once. Verified live via the
// Apaleo MCP tool: reservations carry `adults` as a plain integer and
// `childrenAges` as an array of ages (no separate integer children-count
// field) — children count is derived as childrenAges.length.

export function getAdultsCount(reservation) {
  return Number(reservation?.adults) || 0;
}

export function getChildrenCount(reservation) {
  return Array.isArray(reservation?.childrenAges) ? reservation.childrenAges.length : 0;
}

/**
 * Total guests counted toward a unit group's occupancy. Apaleo's own
 * availability/offer search (ListOffers, GetAvailableUnitGroups, etc.)
 * takes `adults` and `children_ages` as separate parameters but exposes no
 * weighted "a child counts as less than a full person" concept anywhere,
 * and a unit group's capacity (maxPersons — see lib/apaleo.js's
 * getUnitGroup) is a single total cap — so every child counts the same as
 * an adult here, matching Apaleo's own occupancy semantics.
 */
export function getTotalOccupancy(reservation) {
  return getAdultsCount(reservation) + getChildrenCount(reservation);
}
