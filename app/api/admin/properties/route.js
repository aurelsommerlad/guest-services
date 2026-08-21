import { NextResponse } from "next/server";
import { requireRole } from "@/lib/auth";
import { listProperties, pickLocalizedText } from "@/lib/apaleo";

export async function GET() {
  const { error } = await requireRole(["admin", "manager"]);
  if (error) return error;

  try {
    const properties = await listProperties();
    return NextResponse.json({
      properties: properties.map((p) => ({
        id: p.id,
        name: pickLocalizedText(p.name) || p.id,
      })),
    });
  } catch (err) {
    console.error("Fehler beim Laden der Properties:", err);
    return NextResponse.json({ error: "Properties konnten nicht geladen werden." }, { status: 502 });
  }
}
