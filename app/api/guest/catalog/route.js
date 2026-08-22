import { NextResponse } from "next/server";
import { searchReservations, getGuestCatalog, getLookupErrorMessage } from "@/lib/guest";
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
    return NextResponse.json(catalog);
  } catch (err) {
    console.error("Fehler beim Laden des Extras-Katalogs:", err);
    return NextResponse.json({ error: t(language, "catalogLoadError") }, { status: 502 });
  }
}
