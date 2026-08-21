import { NextResponse } from "next/server";
import { requireRole } from "@/lib/auth";
import { saveImage } from "@/lib/images";

export async function POST(request) {
  const { error } = await requireRole(["admin", "manager"]);
  if (error) return error;

  const formData = await request.formData().catch(() => null);
  const file = formData?.get("file");

  if (!file || typeof file === "string") {
    return NextResponse.json({ error: "Keine Bilddatei übermittelt." }, { status: 400 });
  }
  if (!file.type?.startsWith("image/")) {
    return NextResponse.json({ error: "Nur Bilddateien sind erlaubt." }, { status: 400 });
  }

  try {
    const buffer = Buffer.from(await file.arrayBuffer());
    const id = await saveImage(buffer, file.type);
    return NextResponse.json({ id, imageUrl: `/api/images/${id}` });
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 400 });
  }
}
