// Dependency-free (see lib/priceDisplay.js / lib/unitGroupRestriction.js for
// why) — pure remaining-capacity math for catalog items marked
// requiresRemainingCapacity (e.g. "Extra person" / "Zusatzperson"). See
// lib/apaleo.js's getUnitGroup for where `maxPersons` comes from and
// lib/occupancy.js for how the reservation's current occupancy is counted.

import { getTotalOccupancy } from "./occupancy.js";

export function getUnitGroupMaxOccupancy(unitGroup) {
  return Number.isFinite(unitGroup?.maxPersons) ? unitGroup.maxPersons : null;
}

/**
 * maxOccupancy - currentOccupancy, floored at 0 (never negative — a
 * quantity selector or a "show this extra" check has no use for a negative
 * capacity). Fails closed to 0 when the unit group's maxPersons can't be
 * resolved at all — same philosophy as lib/unitGroupRestriction.js: never
 * let a capacity-gated extra through when eligibility can't actually be
 * verified.
 */
export function getRemainingCapacity(unitGroup, reservation) {
  const max = getUnitGroupMaxOccupancy(unitGroup);
  if (max === null) return 0;
  const remaining = max - getTotalOccupancy(reservation);
  return remaining > 0 ? remaining : 0;
}
