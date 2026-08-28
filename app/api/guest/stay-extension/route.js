import { NextResponse } from "next/server";
import { searchReservations, confirmStayExtension, getLookupErrorMessage } from "@/lib/guest";
import { t } from "@/lib/i18n";

export async function POST(request) {
  const body = await request.json().catch(() => null);
  const reservationId = String(body?.reservationId || "").trim();
  const lastName = String(body?.lastName || "").trim();
  const currentDeparture = String(body?.currentDeparture || "").trim();
  const language = body?.language;

  if (!reservationId || !lastName || !currentDeparture) {
    return NextResponse.json({ error: t(language, "genericError") }, { status: 400 });
  }

  try {
    // Same re-verification as every other guest-mutating route (see
    // app/api/guest/order/route.js) — never trust a client-supplied
    // reservation id on its own.
    const [reservation] = await searchReservations(reservationId, lastName);
    if (!reservation) {
      return NextResponse.json({ error: getLookupErrorMessage(language) }, { status: 404 });
    }

    // confirmStayExtension re-derives everything itself against a freshly
    // fetched reservation — `currentDeparture` is only used to detect that
    // the stay already changed since the guest's browser loaded the offer
    // (see lib/guest.js).
    const result = await confirmStayExtension({
      reservationId: reservation.id,
      expectedCurrentDeparture: currentDeparture,
    });
    return NextResponse.json(result);
  } catch (err) {
    if (err.reason === "stay_extension_unavailable") {
      return NextResponse.json({ error: t(language, "stayExtensionUnavailableError") }, { status: 409 });
    }
    console.error("Fehler bei der Aufenthaltsverlängerung:", err);
    return NextResponse.json({ error: t(language, "stayExtensionFailedError") }, { status: 502 });
  }
}
