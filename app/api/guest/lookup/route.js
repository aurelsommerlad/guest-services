import { NextResponse } from "next/server";
import { getDepartureDate, isPastDate } from "@/lib/apaleo";
import { searchReservations, getLookupErrorMessage } from "@/lib/guest";
import { t } from "@/lib/i18n";

export async function POST(request) {
  const body = await request.json().catch(() => null);
  const number = String(body?.number || "").trim();
  const lastName = String(body?.lastName || "").trim();
  const language = body?.language;

  if (!number || !lastName) {
    return NextResponse.json({ error: getLookupErrorMessage(language) }, { status: 400 });
  }

  try {
    const reservations = await searchReservations(number, lastName);
    if (!reservations.length) {
      // Same message whether the number or the last name was wrong.
      return NextResponse.json({ error: getLookupErrorMessage(language) }, { status: 404 });
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
    return NextResponse.json({ error: t(language, "searchUnavailableError") }, { status: 502 });
  }
}
