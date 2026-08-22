import { NextResponse } from "next/server";
import { searchReservations, getGuestCatalog, getLookupErrorMessage } from "@/lib/guest";
import { createGuestRequest } from "@/lib/requests";
import { t } from "@/lib/i18n";

export async function POST(request) {
  const body = await request.json().catch(() => null);
  const reservationId = String(body?.reservationId || "").trim();
  const lastName = String(body?.lastName || "").trim();
  const guestName = String(body?.guestName || lastName || "").trim();
  const guestEmail = body?.guestEmail ? String(body.guestEmail).trim() : "";
  const serviceId = String(body?.serviceId || "").trim();
  const quantity = Number(body?.quantity) || 1;
  const language = body?.language;

  if (!reservationId || !lastName || !serviceId || quantity <= 0) {
    return NextResponse.json({ error: t(language, "selectRequestItemError") }, { status: 400 });
  }

  try {
    const [reservation] = await searchReservations(reservationId, lastName);
    if (!reservation) {
      return NextResponse.json({ error: getLookupErrorMessage(language) }, { status: 404 });
    }

    const propertyId = reservation.property?.id;
    const { items } = await getGuestCatalog(reservation, propertyId);
    const item = items.find(
      (i) => i.serviceId === serviceId && (i.fulfillmentMode || "instant") === "request"
    );
    if (!item) {
      return NextResponse.json({ error: t(language, "requestFailedError") }, { status: 404 });
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
    return NextResponse.json({ error: t(language, "requestFailedError") }, { status: 502 });
  }
}
