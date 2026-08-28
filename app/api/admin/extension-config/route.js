import crypto from "crypto";
import { NextResponse } from "next/server";
import { requireRole } from "@/lib/auth";
import { isUsingKv } from "@/lib/db";
import {
  extensionConfigKey,
  getExtensionConfig,
  getRawExtensionConfig,
  saveExtensionConfig,
} from "@/lib/store";

// TEMPORARY: _debug is only added here to make it easy to compare this
// admin response against /api/admin/extension-config/debug from the same
// browser session while investigating a KV-environment discrepancy. It is
// admin/manager-gated exactly like the rest of this route and is never
// added to any guest-facing endpoint. Remove once that investigation is
// closed out.
function buildDebugInfo(propertyId, rawStoredConfig) {
  return {
    kvConfigured: isUsingKv(),
    kvUrlFingerprint: process.env.KV_REST_API_URL
      ? crypto.createHash("sha256").update(process.env.KV_REST_API_URL).digest("hex").slice(0, 16)
      : null,
    key: extensionConfigKey(propertyId),
    rawStoredConfig,
  };
}

export async function GET(request) {
  const { error } = await requireRole(["admin", "manager"]);
  if (error) return error;

  const propertyId = request.nextUrl.searchParams.get("propertyId");
  if (!propertyId) {
    return NextResponse.json({ error: "propertyId ist erforderlich." }, { status: 400 });
  }

  const [rawStoredConfig, config] = await Promise.all([
    getRawExtensionConfig(propertyId),
    getExtensionConfig(propertyId),
  ]);
  return NextResponse.json({ config, _debug: buildDebugInfo(propertyId, rawStoredConfig) });
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
    !Number.isFinite(Number(config.extensionDiscountOneNightGap)) ||
    !Number.isFinite(Number(config.extensionDiscountStandard)) ||
    !Number.isFinite(Number(config.minSellableStayNights)) ||
    Number(config.minSellableStayNights) < 1
  ) {
    return NextResponse.json({ error: "Ungültige Konfigurationswerte." }, { status: 400 });
  }

  const saved = await saveExtensionConfig(propertyId, config);
  return NextResponse.json({ config: saved });
}
