import crypto from "crypto";
import { NextResponse } from "next/server";
import { requireRole } from "@/lib/auth";
import { isUsingKv } from "@/lib/db";
import {
  extensionConfigKey,
  getExtensionConfig,
  getRawExtensionConfig,
} from "@/lib/store";

// TEMPORARY diagnostic endpoint. Admin-only, read-only, never mutates KV.
// Exists solely to compare the KV backend/config actually seen by a
// production request against what the admin UI shows, without ever
// exposing KV_REST_API_TOKEN or the full KV_REST_API_URL. Remove once the
// stay-extension config discrepancy investigation is closed out.

function kvUrlFingerprint(url) {
  if (!url) return null;
  return crypto.createHash("sha256").update(url).digest("hex").slice(0, 16);
}

export async function GET(request) {
  const { error } = await requireRole(["admin", "manager"]);
  if (error) return error;

  const propertyId = request.nextUrl.searchParams.get("propertyId");
  if (!propertyId) {
    return NextResponse.json({ error: "propertyId ist erforderlich." }, { status: 400 });
  }

  const kvConfigured = isUsingKv();
  const [rawStoredConfig, parsedExtensionConfig] = await Promise.all([
    getRawExtensionConfig(propertyId),
    getExtensionConfig(propertyId),
  ]);

  return NextResponse.json({
    propertyId,
    kvConfigured,
    kvUrlFingerprint: kvUrlFingerprint(process.env.KV_REST_API_URL),
    key: extensionConfigKey(propertyId),
    rawStoredConfig,
    parsedExtensionConfig,
  });
}
