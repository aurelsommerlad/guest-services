import { NextResponse } from "next/server";
import { requireRole } from "@/lib/auth";
import {
  getCatalog,
  upsertCatalogItem,
  BOOKING_RULES,
  DEFAULT_BOOKING_RULE,
  FULFILLMENT_MODES,
  DEFAULT_FULFILLMENT_MODE,
} from "@/lib/store";

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

  function optionalText(value) {
    return typeof value === "string" ? value.trim() : "";
  }

  // Empty/undefined = "no explicit order, sort after configured items" (see
  // lib/catalogSort.js) — anything non-numeric is dropped to null rather
  // than stored as garbage that could sort unpredictably.
  function optionalNumber(value) {
    if (value === "" || value === null || value === undefined) return null;
    const num = Number(value);
    return Number.isFinite(num) ? num : null;
  }

  // Empty/undefined = unrestricted (see lib/unitGroupRestriction.js) —
  // anything not a non-empty string is dropped rather than stored as
  // garbage that could accidentally restrict an extra to nothing.
  const allowedUnitGroupIds = Array.isArray(item.allowedUnitGroupIds)
    ? item.allowedUnitGroupIds.filter((id) => typeof id === "string" && id.trim()).map((id) => id.trim())
    : [];

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
    // Presentation only (see lib/priceDisplay.js) — stored as entered, or
    // empty; the guest-facing fallback default is resolved at read time,
    // not baked in here, so it stays correct if bookingRule changes later.
    priceUnitLabel: optionalText(item.priceUnitLabel),
    fulfillmentMode: FULFILLMENT_MODES.includes(item.fulfillmentMode)
      ? item.fulfillmentMode
      : DEFAULT_FULFILLMENT_MODE,
    // Optional per-language overrides (see lib/catalogLocalization.js for
    // how these fit into the guest-facing fallback chain). All optional —
    // an empty string here just means "no override for this language",
    // never a validation error.
    displayNameDe: optionalText(item.displayNameDe),
    displayNameEn: optionalText(item.displayNameEn),
    descriptionDe: optionalText(item.descriptionDe),
    descriptionEn: optionalText(item.descriptionEn),
    priceUnitLabelDe: optionalText(item.priceUnitLabelDe),
    priceUnitLabelEn: optionalText(item.priceUnitLabelEn),
    allowedUnitGroupIds,
    sortOrder: optionalNumber(item.sortOrder),
    // Default false = current behavior (see lib/capacity.js) — only true
    // hides the extra once the booked unit group has no remaining guest
    // capacity, e.g. "Extra person"/"Zusatzperson".
    requiresRemainingCapacity: Boolean(item.requiresRemainingCapacity),
  });

  return NextResponse.json({ item: saved });
}
