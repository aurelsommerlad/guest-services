import { NextResponse } from "next/server";
import { requireRole } from "@/lib/auth";
import { listUnitGroups, pickLocalizedText } from "@/lib/apaleo";

export async function GET(request) {
  const { error } = await requireRole(["admin", "manager"]);
  if (error) return error;

  const propertyId = request.nextUrl.searchParams.get("propertyId");
  if (!propertyId) {
    return NextResponse.json({ error: "propertyId ist erforderlich." }, { status: 400 });
  }

  try {
    const unitGroups = await listUnitGroups(propertyId);
    return NextResponse.json({
      unitGroups: unitGroups.map((g) => ({
        id: g.id,
        code: g.code,
        name: pickLocalizedText(g.name) || g.code,
      })),
    });
  } catch (err) {
    console.error("Fehler beim Laden der Apaleo-Apartmenttypen:", err);
    return NextResponse.json({ error: "Apartmenttypen konnten nicht geladen werden." }, { status: 502 });
  }
}
