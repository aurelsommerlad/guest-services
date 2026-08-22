// Dependency-free (see lib/priceDisplay.js / lib/catalogLocalization.js for
// why) — pure last-name matching and ambiguity-resolution logic, extracted
// out of lib/apaleo.js so it can be unit-tested directly with plain
// `node --test`, without needing live Apaleo access.

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

export function namesMatch(reservation, lastName) {
  const target = normalizeName(lastName);
  if (!target) return false;
  return reservationLastNameCandidates(reservation).some(
    (candidate) => normalizeName(candidate) === target
  );
}

/**
 * Resolves a set of reservations found via an OTA/external-reference search
 * down to "exactly one confirmed match" or an explicit ambiguity signal.
 * Deliberately stricter than the existing Apaleo booking-number lookup
 * (which tolerates multiple reservations under one bookingId and lets the
 * guest pick from a list): an external reference is a weaker identifier,
 * so if more than one DIFFERENT reservation matches both the reference and
 * the last name, we refuse rather than guess or show a picker.
 */
export function resolveExternalReferenceMatches(reservations, lastName) {
  const matches = (reservations || []).filter((r) => namesMatch(r, lastName));
  if (matches.length > 1) {
    return { reservations: [], ambiguous: true };
  }
  return { reservations: matches, ambiguous: false };
}
