import { NextResponse } from "next/server";
import { getReservationById } from "../apaleo.js";
import { checkRateLimit } from "../rateLimit.js";
import { setIfNotExistsWithTtl } from "../db.js";
import { getBridgeConfig } from "./config.js";
import { BridgeAuthError, verifyBridgeToken } from "./token.js";
import { appendBridgeAudit } from "./audit.js";

// Every /api/stay/v1/* route goes through handleBridgeRequest:
//   1. bridge configured?            else 404 (invisible when off)
//   2. signed, fresh, well-formed token (Authorization: Bearer)  else 401
//   3. token scope fits the route    else 403
//   4. tenant + property allow-listed else 403
//   5. token id never seen before    else 401 (replay protection)
//   6. per-reservation rate limit    else 429
//   7. reservation exists in Apaleo AND belongs to the token's property
//                                     else 403 (same answer as 4: nothing
//                                     to learn about other reservations)
// Only then the route's handler runs, with the freshly fetched reservation.

const WINDOW_MS = 5 * 60 * 1000;
function rateLimit(scope) {
  // Defaults: 120 reads / 20 writes per reservation and 5 minutes. Override
  // only for tests (STAY_BRIDGE_RATE_LIMIT_READ / _WRITE).
  const fallback = scope === "write" ? 20 : 120;
  const override = Number(process.env[`STAY_BRIDGE_RATE_LIMIT_${scope.toUpperCase()}`]);
  return { windowMs: WINDOW_MS, maxAttempts: Number.isInteger(override) && override > 0 ? override : fallback };
}
/** Longer than any token's lifetime, so a used id can never come back. */
const REPLAY_WINDOW_SECONDS = 300;
const MAX_BODY_BYTES = 16 * 1024;

function json(status, body) {
  return NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });
}

async function readBody(request) {
  const text = await request.text().catch(() => "");
  if (text.length > MAX_BODY_BYTES) return { tooLarge: true };
  if (!text) return { body: {} };
  try {
    const body = JSON.parse(text);
    return { body: body && typeof body === "object" && !Array.isArray(body) ? body : {} };
  } catch {
    return { body: null };
  }
}

export async function handleBridgeRequest(request, { action, scope, handler }) {
  const config = getBridgeConfig();
  if (!config) return json(404, { error: "not_found" });

  const header = request.headers.get("authorization") || "";
  const token = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
  let claims;
  try {
    claims = await verifyBridgeToken(token, config.secret);
  } catch (err) {
    await appendBridgeAudit({ action, outcome: "rejected", detail: err instanceof BridgeAuthError ? err.reason : "invalid" });
    return json(401, { error: "unauthorized" });
  }
  const base = { action, reservationId: claims.reservationId, propertyId: claims.propertyId, jti: claims.jti };

  if (claims.scope !== scope) {
    await appendBridgeAudit({ ...base, outcome: "rejected", detail: "scope" });
    return json(403, { error: "forbidden" });
  }
  if (claims.tenantId !== config.tenantId || !config.propertyIds.has(claims.propertyId)) {
    await appendBridgeAudit({ ...base, outcome: "rejected", detail: "tenant_or_property" });
    return json(403, { error: "forbidden" });
  }
  const fresh = await setIfNotExistsWithTtl(`stay-bridge:jti:${claims.jti}`, claims.reservationId, REPLAY_WINDOW_SECONDS);
  if (!fresh) {
    await appendBridgeAudit({ ...base, outcome: "rejected", detail: "replay" });
    return json(401, { error: "unauthorized" });
  }
  const allowed = await checkRateLimit(`stay-bridge-${scope}`, claims.reservationId, rateLimit(scope));
  if (!allowed) {
    await appendBridgeAudit({ ...base, outcome: "rejected", detail: "rate_limited" });
    return json(429, { error: "rate_limited" });
  }

  const { body, tooLarge } = await readBody(request);
  if (tooLarge || body === null) {
    await appendBridgeAudit({ ...base, outcome: "rejected", detail: "bad_body" });
    return json(400, { error: "bad_request" });
  }

  try {
    const reservation = await getReservationById(claims.reservationId);
    if (!reservation || reservation.property?.id !== claims.propertyId) {
      await appendBridgeAudit({ ...base, outcome: "rejected", detail: "reservation_mismatch" });
      return json(403, { error: "forbidden" });
    }
    const result = await handler({ reservation, claims, body });
    await appendBridgeAudit({
      ...base,
      outcome: result.status < 400 ? (result.replayed ? "replayed" : "ok") : "failed",
      serviceId: result.audit?.serviceId,
      idempotencyKey: result.audit?.idempotencyKey,
      detail: result.audit?.detail || (result.status >= 400 ? result.body?.error : null),
    });
    return json(result.status, result.body);
  } catch (err) {
    console.error(`[stay-bridge] ${action} failed:`, err?.message);
    await appendBridgeAudit({ ...base, outcome: "error", detail: err?.name || "error" });
    return json(502, { error: "upstream_unavailable" });
  }
}
