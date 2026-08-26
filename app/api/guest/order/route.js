import { NextResponse } from "next/server";
import { searchReservations, placeGuestOrder, getLookupErrorMessage } from "@/lib/guest";
import { t } from "@/lib/i18n";

export async function POST(request) {
  const body = await request.json().catch(() => null);
  const reservationId = String(body?.reservationId || "").trim();
  const lastName = String(body?.lastName || "").trim();
  const guestName = String(body?.guestName || lastName || "").trim();
  const lines = Array.isArray(body?.lines) ? body.lines : [];
  const language = body?.language;

  if (!reservationId || !lastName || !lines.length) {
    return NextResponse.json({ error: t(language, "selectAtLeastOneError") }, { status: 400 });
  }

  try {
    const [reservation] = await searchReservations(reservationId, lastName);
    if (!reservation) {
      return NextResponse.json({ error: getLookupErrorMessage(language) }, { status: 404 });
    }

    const result = await placeGuestOrder({
      reservation,
      propertyId: reservation.property?.id,
      lines,
      guestName,
    });

    if (!result.booked.length) {
      // A dedicated, specific message for the one failure reason that's
      // allowed to say more (see lib/guest.js's placeGuestOrder) — the
      // guest already selected a quantity the catalog said was valid; if
      // remaining capacity changed since then, they deserve a clearer
      // explanation than the generic booking-failed wording.
      const capacityExceeded = result.failed.some((f) => f.reason === "capacity_exceeded");
      return NextResponse.json(
        {
          error: t(language, capacityExceeded ? "capacityExceededError" : "bookingFailedError"),
          failed: result.failed,
        },
        { status: capacityExceeded ? 409 : 502 }
      );
    }

    return NextResponse.json(result);
  } catch (err) {
    console.error("Fehler bei der Extras-Buchung:", err);
    return NextResponse.json({ error: t(language, "bookingFailedError") }, { status: 502 });
  }
}
