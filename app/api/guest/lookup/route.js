import { NextResponse } from "next/server";
import { getDepartureDate, isPastDate, pickLocalizedText } from "@/lib/apaleo";
import { searchReservationsByAnyReference, getLookupErrorMessage, getAmbiguousLookupErrorMessage } from "@/lib/guest";
import { checkRateLimit } from "@/lib/rateLimit";
import { buildReservationSummary } from "@/lib/reservationSummary";
import { t } from "@/lib/i18n";

function clientIp(request) {
  // Vercel sets x-forwarded-for; local dev/tests won't have it, in which
  // case rate limiting is skipped (see checkRateLimit) rather than lumping
  // every IP-less request into one shared bucket.
  return request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "";
}

export async function POST(request) {
  const body = await request.json().catch(() => null);
  const number = String(body?.number || "").trim();
  const lastName = String(body?.lastName || "").trim();
  const language = body?.language;

  if (!number || !lastName) {
    return NextResponse.json({ error: getLookupErrorMessage(language) }, { status: 400 });
  }

  // Reasonable protection against enumeration / repeated lookup attempts —
  // this app has no dedicated rate-limiting infrastructure, so this is a
  // small, self-contained limiter (see lib/rateLimit.js) rather than a new
  // generic framework. Checked before any Apaleo call.
  const allowed = await checkRateLimit("guest-lookup", clientIp(request));
  if (!allowed) {
    return NextResponse.json({ error: t(language, "tooManyAttemptsError") }, { status: 429 });
  }

  try {
    // Tries the existing Apaleo booking/reservation number lookup first,
    // then falls back to an OTA/external-reference search (e.g. a
    // Booking.com confirmation number) only if that finds nothing — see
    // lib/apaleo.js's findGuestReservationsByAnyReference. Either way, the
    // last name is required and verified before anything is returned; an
    // OTA reference alone never authenticates a guest.
    const { reservations, ambiguous } = await searchReservationsByAnyReference(number, lastName);
    if (ambiguous) {
      // A DIFFERENT, still-generic message — safe here because the guest
      // already proved they know a valid number+name combination.
      return NextResponse.json({ error: getAmbiguousLookupErrorMessage(language) }, { status: 409 });
    }
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
        // Compact reservation summary (see components/guest/GuestApp.jsx) —
        // only safe, already-fetched fields, no extra Apaleo request.
        ...buildReservationSummary(r, pickLocalizedText(r.property?.name)),
      })),
    });
  } catch (err) {
    console.error("Fehler bei der Reservierungssuche:", err);
    return NextResponse.json({ error: t(language, "searchUnavailableError") }, { status: 502 });
  }
}
