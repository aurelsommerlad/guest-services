import { NextResponse } from "next/server";
import { searchReservations, getGuestCatalog, getStayExtensionOffer, getLookupErrorMessage } from "@/lib/guest";
import { t } from "@/lib/i18n";

export async function POST(request) {
  const body = await request.json().catch(() => null);
  const reservationId = String(body?.reservationId || "").trim();
  const lastName = String(body?.lastName || "").trim();
  const language = body?.language;

  if (!reservationId || !lastName) {
    return NextResponse.json({ error: getLookupErrorMessage(language) }, { status: 400 });
  }

  try {
    // Re-verify number + last name on every call rather than trusting a
    // client-supplied reservation id on its own — otherwise a guest could
    // enumerate other reservations just by guessing ids.
    const [reservation] = await searchReservations(reservationId, lastName);
    if (!reservation) {
      return NextResponse.json({ error: getLookupErrorMessage(language) }, { status: 404 });
    }

    // Catalog items themselves already carry both languages (see
    // lib/guest.js's getGuestCatalog) so the guest can switch language
    // client-side without another round trip — `language` here only
    // affects this response's own error message, not the catalog content.
    const catalog = await getGuestCatalog(reservation, reservation.property?.id);
    // The "stay one more night" upsell is never an Apaleo service, so it's
    // never part of `catalog.items` — a separate, optional field the guest
    // UI renders as its own distinct card. null when no valid offer exists
    // (see lib/guest.js's getStayExtensionOffer for every condition that
    // must hold, which already covers pastStay); this can never fail the
    // whole catalog load. Skipped entirely for a past stay to avoid a
    // pointless extra Apaleo call.
    const extensionOffer = catalog.pastStay ? null : await getStayExtensionOffer(reservation);
    return NextResponse.json({ ...catalog, extensionOffer });
  } catch (err) {
    console.error("Fehler beim Laden des Extras-Katalogs:", err);
    return NextResponse.json({ error: t(language, "catalogLoadError") }, { status: 502 });
  }
}
