// Dependency-free (see lib/priceDisplay.js / lib/reservationMatching.js for
// why) pure logic for restricting a catalog extra to specific Apaleo unit
// groups / apartment types (e.g. "Dog" only bookable in dog-friendly
// apartment types) — extracted out of lib/guest.js/lib/requests.js so the
// actual allow/deny decision can be unit-tested directly with plain
// `node --test`, without needing live Apaleo access.

/**
 * Resolves the Apaleo unit group ID actually booked for a reservation.
 * Verified live via the Apaleo MCP tool against GET
 * /booking/v1/reservations/{id} (the exact endpoint getReservationById
 * calls, no `expand` needed): the response embeds `unitGroup.id` directly.
 * `unit.unitGroupId` is kept as a fallback for a reservation shape that
 * carries the assigned unit but not the embedded unitGroup object.
 */
export function getReservationUnitGroupId(reservation) {
  return reservation?.unitGroup?.id || reservation?.unit?.unitGroupId || null;
}

/**
 * True if a catalog item restricted to `allowedUnitGroupIds` may be
 * offered/booked for a reservation whose booked unit group is
 * `unitGroupId`.
 *   - empty/undefined allowedUnitGroupIds -> unrestricted, always allowed.
 *     This is what keeps every pre-existing catalog entry (which has no
 *     allowedUnitGroupIds field at all) working unchanged.
 *   - otherwise only allowed if unitGroupId is in the list.
 * A missing/unresolvable unitGroupId against a non-empty restriction list
 * falls through to `false` here (an unknown value is never `.includes()`d)
 * — fail closed rather than silently letting a restricted extra through
 * when eligibility can't actually be verified.
 */
export function isUnitGroupAllowed(allowedUnitGroupIds, unitGroupId) {
  if (!Array.isArray(allowedUnitGroupIds) || allowedUnitGroupIds.length === 0) return true;
  return allowedUnitGroupIds.includes(unitGroupId);
}
