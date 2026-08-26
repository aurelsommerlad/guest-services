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
      // Dedicated, specific messages for failure reasons that are allowed
      // to say more than the generic booking-failed wording (see
      // lib/guest.js's placeGuestOrder) — a missing/incomplete license
      // plate is a guest input problem (400), distinct from a capacity
      // conflict (409) or an upstream Apaleo failure (502, the default).
      const capacityExceeded = result.failed.some((f) => f.reason === "capacity_exceeded");
      const licensePlateRequired = result.failed.some((f) => f.reason === "vehicle_registration_required");
      const status = capacityExceeded ? 409 : licensePlateRequired ? 400 : 502;
      const messageKey = capacityExceeded
        ? "capacityExceededError"
        : licensePlateRequired
        ? "licensePlateRequiredError"
        : "bookingFailedError";
      return NextResponse.json({ error: t(language, messageKey), failed: result.failed }, { status });
    }

    return NextResponse.json(result);
  } catch (err) {
    console.error("Fehler bei der Extras-Buchung:", err);
    return NextResponse.json({ error: t(language, "bookingFailedError") }, { status: 502 });
  }
}
