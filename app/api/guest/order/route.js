import { NextResponse } from "next/server";
import { searchReservations, placeGuestOrder, GENERIC_LOOKUP_ERROR } from "@/lib/guest";

const BOOKING_FAILED_MESSAGE =
  "Die Buchung konnte nicht durchgeführt werden. Bitte versuche es erneut oder wende Dich an die Rezeption.";

export async function POST(request) {
  const body = await request.json().catch(() => null);
  const reservationId = String(body?.reservationId || "").trim();
  const lastName = String(body?.lastName || "").trim();
  const guestName = String(body?.guestName || lastName || "").trim();
  const lines = Array.isArray(body?.lines) ? body.lines : [];

  if (!reservationId || !lastName || !lines.length) {
    return NextResponse.json(
      { error: "Bitte wähle mindestens eine Zusatzleistung aus." },
      { status: 400 }
    );
  }

  try {
    const [reservation] = await searchReservations(reservationId, lastName);
    if (!reservation) {
      return NextResponse.json({ error: GENERIC_LOOKUP_ERROR }, { status: 404 });
    }

    const result = await placeGuestOrder({
      reservation,
      propertyId: reservation.property?.id,
      lines,
      guestName,
    });

    if (!result.booked.length) {
      return NextResponse.json({ error: BOOKING_FAILED_MESSAGE, failed: result.failed }, { status: 502 });
    }

    return NextResponse.json(result);
  } catch (err) {
    console.error("Fehler bei der Extras-Buchung:", err);
    return NextResponse.json({ error: BOOKING_FAILED_MESSAGE }, { status: 502 });
  }
}
