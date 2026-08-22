import { NextResponse } from "next/server";
import { searchReservations, getGuestCatalog, GENERIC_LOOKUP_ERROR } from "@/lib/guest";

export async function POST(request) {
  const body = await request.json().catch(() => null);
  const reservationId = String(body?.reservationId || "").trim();
  const lastName = String(body?.lastName || "").trim();

  if (!reservationId || !lastName) {
    return NextResponse.json({ error: GENERIC_LOOKUP_ERROR }, { status: 400 });
  }

  try {
    // Re-verify number + last name on every call rather than trusting a
    // client-supplied reservation id on its own — otherwise a guest could
    // enumerate other reservations just by guessing ids.
    const [reservation] = await searchReservations(reservationId, lastName);
    if (!reservation) {
      return NextResponse.json({ error: GENERIC_LOOKUP_ERROR }, { status: 404 });
    }

    const catalog = await getGuestCatalog(reservation, reservation.property?.id);
    return NextResponse.json(catalog);
  } catch (err) {
    console.error("Fehler beim Laden des Extras-Katalogs:", err);
    return NextResponse.json(
      { error: "Der Extras-Katalog konnte nicht geladen werden. Bitte versuche es später erneut." },
      { status: 502 }
    );
  }
}
