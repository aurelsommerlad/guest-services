// Dependency-free (see lib/priceDisplay.js / lib/capacity.js for why) — pure
// logic behind mandatory vehicle-registration/license-plate capture for
// catalog items configured with requiresVehicleRegistration (e.g.
// "Parkplatz"/parking). Shared between the guest-facing quantity stepper
// (components/guest/GuestApp.jsx) and the server-side booking validation
// (lib/guest.js's placeGuestOrder), so both apply exactly the same rules and
// can never drift apart.
//
// The Apaleo side of this was verified live via the Apaleo MCP tool against
// a disposable sandbox reservation before this was implemented: primaryGuest
// .vehicleRegistration is a real, patchable field (PATCH
// /booking/v1/reservations/{id}, JSON Patch op "add", path
// "/primaryGuest/vehicleRegistration", value {number, countryCode}) that
// never touches any other primaryGuest field, and safely overwrites an
// existing value on resend. Apaleo's reservation model has no native field
// for more than one vehicle registration per reservation (checked via every
// available GetReservation expand option against ~50 real reservations,
// including multi-adult ones) — hence formatVehiclePlatesComment below.

export const DEFAULT_VEHICLE_COUNTRY_CODE = "DE";

/**
 * Resizes a guest's entered license-plate list to match a newly selected
 * quantity: entries at indexes already within the new count are preserved
 * unchanged (decreasing quantity only drops the trailing entries — "remove
 * excess plate entries safely"), new slots start empty, except index 0 on
 * first creation (current is empty), which is pre-filled from
 * `existingPlate` (the reservation's current
 * primaryGuest.vehicleRegistration.number, if any) so the guest corrects/
 * confirms it rather than retyping it from scratch.
 */
export function resizeVehiclePlates(current, nextCount, existingPlate) {
  const safeCount = Number.isFinite(nextCount) && nextCount > 0 ? Math.floor(nextCount) : 0;
  const prev = Array.isArray(current) ? current : [];
  return Array.from({ length: safeCount }, (_, i) => {
    if (i < prev.length) return prev[i];
    return i === 0 && !prev.length && existingPlate ? existingPlate : "";
  });
}

/**
 * True once every one of the first `count` plate entries is a non-empty,
 * non-whitespace string. `count <= 0` is trivially true (nothing required).
 * The guest-facing "can I submit yet" gate and the server-side authoritative
 * validation (normalizeVehiclePlates below) both build on this single rule.
 */
export function hasCompleteVehiclePlates(plates, count) {
  if (!(count > 0)) return true;
  const list = Array.isArray(plates) ? plates : [];
  for (let i = 0; i < count; i++) {
    if (!String(list[i] || "").trim()) return false;
  }
  return true;
}

/**
 * Normalizes a submitted plate list down to exactly `count` trimmed,
 * non-empty values, or null if incomplete. Used server-side immediately
 * before booking (see lib/guest.js's placeGuestOrder) — never trusts a
 * client-side pass/fail on its own. Extra entries beyond `count` are
 * ignored, never silently included.
 */
export function normalizeVehiclePlates(plates, count) {
  if (!hasCompleteVehiclePlates(plates, count)) return null;
  return Array.from({ length: count }, (_, i) => String(plates[i]).trim());
}

/**
 * The Apaleo primaryGuest.vehicleRegistration payload for the first plate —
 * see the module-level comment above for the live-verified shape/behavior.
 * Returns null when there's no first plate to save (an empty list).
 */
export function buildPrimaryVehicleRegistration(plates, countryCode = DEFAULT_VEHICLE_COUNTRY_CODE) {
  const first = plates?.[0];
  if (!first) return null;
  return { number: first, countryCode };
}

/**
 * A clearly structured reservation-comment fallback for any vehicles beyond
 * the first, since Apaleo has no native field for more than one vehicle
 * registration per reservation (see module-level comment). Returns null for
 * 0 or 1 plates so callers never append a pointless comment.
 */
export function formatVehiclePlatesComment(plates) {
  if (!Array.isArray(plates) || plates.length < 2) return null;
  return `Parking vehicles:\n${plates.map((p, i) => `${i + 1}. ${p}`).join("\n")}`;
}
