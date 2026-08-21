import { NextResponse } from "next/server";
import { getDepartureDate, isPastDate } from "@/lib/apaleo";
import { searchReservations, GENERIC_LOOKUP_ERROR } from "@/lib/guest";

export async function POST(request) {
  const body = await request.json().catch(() => null);
  const number = String(body?.number || "").trim();
  const lastName = String(body?.lastName || "").trim();

  if (!number || !lastName) {
    return NextResponse.json({ error: GENERIC_LOOKUP_ERROR }, { status: 400 });
  }

  try {
    const reservations = await searchReservations(number, lastName);
    if (!reservations.length) {
      // Same message whether the number or the last name was wrong.
      return NextResponse.json({ error: GENERIC_LOOKUP_ERROR }, { status: 404 });
    }

    return NextResponse.json({
      reservations: reservations.map((r) => ({
        id: r.id,
        bookingId: r.bookingId || null,
        propertyId: r.property?.id,
        arrival: r.arrival || r.checkInDate || null,
        departure: getDepartureDate(r),
        status: r.status || null,
        pastStay: isPastDate(getDepartureDate(r)),
      })),
    });
  } catch (err) {
    console.error("Fehler bei der Reservierungssuche:", err);
    return NextResponse.json(
      { error: "Die Suche ist aktuell nicht möglich. Bitte versuchen Sie es später erneut oder wenden Sie sich an die Rezeption." },
      { status: 502 }
    );
  }
}
