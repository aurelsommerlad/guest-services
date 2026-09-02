import { NextResponse } from "next/server";
import { requireRole } from "@/lib/auth";
import { listExtensionRecords, getExtensionRecordsStorageKey } from "@/lib/store";

// TEMPORARY, read-only diagnostic endpoint — added to investigate whether a
// stay-extension audit record already exists for a given reservation
// (originally reservation HVQSVNWL-1, to decide whether the Admin
// "Verlängerungsnächte" view should read that record as-is or reconstruct
// it from Apaleo). Never writes to KV/Redis, never calls any Apaleo
// mutation endpoint — only lib/store.js's existing listExtensionRecords()
// read. Remove this route once that investigation is complete; it must
// never ship as a permanent part of the app.
//
// Admin/manager auth required (same guard as every other /api/admin
// route). Returns only what's already stored in the audit record itself —
// no KV URL, no KV token, no other secret ever appears in the response.
export async function GET(request) {
  const { error } = await requireRole(["admin", "manager"]);
  if (error) return error;

  const reservationId = request.nextUrl.searchParams.get("reservationId");
  if (!reservationId) {
    return NextResponse.json({ error: "reservationId ist erforderlich." }, { status: 400 });
  }

  try {
    const records = await listExtensionRecords();
    const matches = records.filter((r) => r.reservationId === reservationId);
    // Newest first, in case more than one record exists for the same
    // reservation (e.g. a retried/duplicate confirm attempt).
    matches.sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0));

    return NextResponse.json({
      reservationId,
      recordFound: matches.length > 0,
      // Records are stored in one Redis hash (see lib/store.js), keyed by
      // a random record id — never by reservationId — so there is no
      // single direct key to look up; this describes the actual storage
      // shape rather than implying a per-reservation key exists.
      storageKey: getExtensionRecordsStorageKey(),
      matchCount: matches.length,
      record: matches[0] || null,
      allMatches: matches,
    });
  } catch (err) {
    console.error("stay-extension-debug: Abfrage fehlgeschlagen:", err);
    return NextResponse.json({ error: "Abfrage fehlgeschlagen." }, { status: 502 });
  }
}
