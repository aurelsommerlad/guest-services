import { NextResponse } from "next/server";
import { searchReservations, getGuestCatalog, GENERIC_LOOKUP_ERROR } from "@/lib/guest";
import { createGuestRequest } from "@/lib/requests";

const REQUEST_FAILED_MESSAGE =
  "Deine Anfrage konnte nicht gesendet werden. Bitte versuche es erneut oder wende Dich an die Rezeption.";

export async function POST(request) {
  const body = await request.json().catch(() => null);
  const reservationId = String(body?.reservationId || "").trim();
  const lastName = String(body?.lastName || "").trim();
  const guestName = String(body?.guestName || lastName || "").trim();
  const guestEmail = body?.guestEmail ? String(body.guestEmail).trim() : "";
  const serviceId = String(body?.serviceId || "").trim();
  const quantity = Number(body?.quantity) || 1;

  if (!reservationId || !lastName || !serviceId || quantity <= 0) {
    return NextResponse.json(
      { error: "Bitte wähle eine Zusatzleistung aus, für die Du eine Anfrage senden möchtest." },
      { status: 400 }
    );
  }

  try {
    const [reservation] = await searchReservations(reservationId, lastName);
    if (!reservation) {
      return NextResponse.json({ error: GENERIC_LOOKUP_ERROR }, { status: 404 });
    }

    const propertyId = reservation.property?.id;
    const { items } = await getGuestCatalog(reservation, propertyId);
    const item = items.find(
      (i) => i.serviceId === serviceId && (i.fulfillmentMode || "instant") === "request"
    );
    if (!item) {
      return NextResponse.json({ error: REQUEST_FAILED_MESSAGE }, { status: 404 });
    }

    const record = await createGuestRequest({
      reservation,
      propertyId,
      propertyName: reservation.property?.name,
      item,
      quantity,
      guestName,
      guestEmail,
    });

    return NextResponse.json({
      requestId: record.requestId,
      status: record.status,
    });
  } catch (err) {
    console.error("Fehler beim Senden der Extra-Anfrage:", err);
    return NextResponse.json({ error: REQUEST_FAILED_MESSAGE }, { status: 502 });
  }
}
