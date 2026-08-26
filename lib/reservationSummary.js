// Dependency-free (see lib/priceDisplay.js / lib/unitGroupRestriction.js for
// why) — pure assembly of the compact guest-facing reservation summary
// (property name, guest name, adult/child counts) from a raw Apaleo
// reservation object, for /api/guest/lookup to attach to each returned
// reservation. Adult/child counting itself lives in lib/occupancy.js (also
// used by lib/capacity.js's remaining-capacity math) so the rule is defined
// exactly once.
//
// `propertyName` is passed in already resolved (see lib/apaleo.js's
// pickLocalizedText, which the caller already has to import) rather than
// resolved here, so this module never needs to import from lib/apaleo.js —
// that import chain isn't directly loadable by plain `node --test` outside
// Next's bundler (see lib/reservationMatching.js's header comment for why).

import { getAdultsCount, getChildrenCount } from "./occupancy.js";

function formatGuestName(guest) {
  const first = String(guest?.firstName || "").trim();
  const last = String(guest?.lastName || "").trim();
  return [first, last].filter(Boolean).join(" ");
}

export function buildReservationSummary(reservation, propertyName) {
  return {
    propertyName: propertyName || "",
    guestName: formatGuestName(reservation?.primaryGuest),
    adults: getAdultsCount(reservation),
    children: getChildrenCount(reservation),
  };
}
