import { NextResponse } from "next/server";
import { requireRole } from "@/lib/auth";
import { getCatalog, upsertCatalogItem, BOOKING_RULES, DEFAULT_BOOKING_RULE } from "@/lib/store";

export async function GET(request) {
  const { error } = await requireRole(["admin", "manager"]);
  if (error) return error;

  const propertyId = request.nextUrl.searchParams.get("propertyId");
  if (!propertyId) {
    return NextResponse.json({ error: "propertyId ist erforderlich." }, { status: 400 });
  }

  const items = await getCatalog(propertyId);
  return NextResponse.json({ items });
}

export async function POST(request) {
  const { error } = await requireRole(["admin", "manager"]);
  if (error) return error;

  const body = await request.json().catch(() => null);
  const propertyId = String(body?.propertyId || "").trim();
  const item = body?.item;

  if (!propertyId || !item?.serviceId) {
    return NextResponse.json({ error: "propertyId und item.serviceId sind erforderlich." }, { status: 400 });
  }

  const saved = await upsertCatalogItem(propertyId, {
    serviceId: item.serviceId,
    code: item.code || "",
    name: item.name || "",
    displayName: item.displayName || item.name || "",
    description: item.description || "",
    category: item.category || "",
    imageUrl: item.imageUrl || "",
    active: Boolean(item.active),
    bookingRule: BOOKING_RULES.includes(item.bookingRule) ? item.bookingRule : DEFAULT_BOOKING_RULE,
  });

  return NextResponse.json({ item: saved });
}
