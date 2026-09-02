import { NextResponse } from "next/server";
import { requireRole } from "@/lib/auth";
import { listExtensionRecords } from "@/lib/store";
import { getReservationById, pickLocalizedText } from "@/lib/apaleo";
import { buildStayExtensionAdminRow, sortStayExtensionRows, filterStayExtensionRows } from "@/lib/stayExtensionAdmin";

function formatGuestName(guest) {
  return [guest?.firstName, guest?.lastName]
    .map((s) => String(s || "").trim())
    .filter(Boolean)
    .join(" ");
}

function resolveUnitName(reservation) {
  return (
    pickLocalizedText(reservation?.unit?.name) ||
    pickLocalizedText(reservation?.unitGroup?.name) ||
    reservation?.unitGroup?.code ||
    ""
  );
}

// Read-only — never mutates KV or Apaleo. Lists every stay-extension audit
// record (see lib/store.js's listExtensionRecords / lib/guest.js's
// confirmStayExtension), enriched per-record with a live Apaleo lookup for
// guest name / property name / apartment (never used to reconstruct the
// audit values themselves — oldDeparture/newDeparture/discountPercent/
// extensionPrice/createdAt/status all come from the stored record, per the
// "audit record is the source of truth" requirement). A single reservation
// lookup failing (e.g. an old/purged reservation) never drops that record
// from the list — only its enrichment fields fall back to "-".
export async function GET(request) {
  const { error } = await requireRole(["admin", "manager", "viewer"]);
  if (error) return error;

  const propertyId = request.nextUrl.searchParams.get("propertyId") || "";
  const status = request.nextUrl.searchParams.get("status") || "";

  try {
    const records = await listExtensionRecords();

    const rows = await Promise.all(
      records.map(async (record) => {
        let reservation = null;
        try {
          reservation = await getReservationById(record.reservationId);
        } catch (err) {
          console.error(
            `stay-extensions admin: Apaleo-Anreicherung für ${record.reservationId} fehlgeschlagen:`,
            err
          );
        }
        return buildStayExtensionAdminRow(record, {
          guestName: formatGuestName(reservation?.primaryGuest),
          propertyName: pickLocalizedText(reservation?.property?.name),
          propertyId: reservation?.property?.id,
          unitName: resolveUnitName(reservation),
        });
      })
    );

    const filtered = filterStayExtensionRows(rows, { propertyId, status });
    return NextResponse.json({ records: sortStayExtensionRows(filtered) });
  } catch (err) {
    console.error("stay-extensions admin: Laden fehlgeschlagen:", err);
    return NextResponse.json({ error: "Verlängerungsnächte konnten nicht geladen werden." }, { status: 502 });
  }
}
