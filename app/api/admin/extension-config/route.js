import { NextResponse } from "next/server";
import { requireRole } from "@/lib/auth";
import { getExtensionConfig, saveExtensionConfig } from "@/lib/store";

export async function GET(request) {
  const { error } = await requireRole(["admin", "manager"]);
  if (error) return error;

  const propertyId = request.nextUrl.searchParams.get("propertyId");
  if (!propertyId) {
    return NextResponse.json({ error: "propertyId ist erforderlich." }, { status: 400 });
  }

  const config = await getExtensionConfig(propertyId);
  return NextResponse.json({ config });
}

export async function POST(request) {
  const { error } = await requireRole(["admin", "manager"]);
  if (error) return error;

  const body = await request.json().catch(() => null);
  const propertyId = String(body?.propertyId || "").trim();
  const config = body?.config;

  if (!propertyId || !config) {
    return NextResponse.json({ error: "propertyId und config sind erforderlich." }, { status: 400 });
  }

  if (
    !Number.isFinite(Number(config.extensionDiscountPreArrivalOneNightGap)) ||
    !Number.isFinite(Number(config.extensionDiscountPreArrivalStandard)) ||
    !Number.isFinite(Number(config.extensionDiscountInHouseOneNightGap)) ||
    !Number.isFinite(Number(config.extensionDiscountInHouseStandard)) ||
    !Number.isFinite(Number(config.minSellableStayNights)) ||
    Number(config.minSellableStayNights) < 1
  ) {
    return NextResponse.json({ error: "Ungültige Konfigurationswerte." }, { status: 400 });
  }

  const saved = await saveExtensionConfig(propertyId, config);
  return NextResponse.json({ config: saved });
}
