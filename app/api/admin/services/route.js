import { NextResponse } from "next/server";
import { requireRole } from "@/lib/auth";
import { listExtraServices, pickLocalizedText } from "@/lib/apaleo";

export async function GET(request) {
  const { error } = await requireRole(["admin", "manager"]);
  if (error) return error;

  const propertyId = request.nextUrl.searchParams.get("propertyId");
  if (!propertyId) {
    return NextResponse.json({ error: "propertyId ist erforderlich." }, { status: 400 });
  }

  try {
    const services = await listExtraServices(propertyId);
    return NextResponse.json({
      services: services.map((s) => ({
        id: s.id,
        code: s.code,
        name: pickLocalizedText(s.name) || s.code,
        description: pickLocalizedText(s.description),
      })),
    });
  } catch (err) {
    console.error("Fehler beim Laden der Apaleo-Services:", err);
    return NextResponse.json({ error: "Services konnten nicht geladen werden." }, { status: 502 });
  }
}
