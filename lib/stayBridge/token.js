import { jwtVerify } from "jose";
import { MAX_TOKEN_LIFETIME_SECONDS, TOKEN_AUDIENCE, TOKEN_ISSUER } from "./config.js";

// STAY mints one token per server-to-server call: HS256, issuer "stay",
// audience "extras-stay-bridge", at most 120 s valid, bound to one tenant,
// one Apaleo property and one Apaleo reservation, with a unique `jti` that
// the bridge accepts exactly once (see guard.js). Never travels through a
// browser: STAY calls the bridge from its own server.

const RESERVATION_ID = /^[A-Za-z0-9-]{3,40}$/;
const PROPERTY_ID = /^[A-Za-z0-9_-]{1,40}$/;
const SCOPES = new Set(["read", "write"]);

export class BridgeAuthError extends Error {
  constructor(reason) {
    super("unauthorized");
    this.reason = reason;
  }
}

export async function verifyBridgeToken(token, secret, { now = new Date() } = {}) {
  if (typeof token !== "string" || token.length > 4096) throw new BridgeAuthError("malformed");
  let payload;
  try {
    ({ payload } = await jwtVerify(token, new TextEncoder().encode(secret), {
      algorithms: ["HS256"],
      issuer: TOKEN_ISSUER,
      audience: TOKEN_AUDIENCE,
      currentDate: now,
      maxTokenAge: `${MAX_TOKEN_LIFETIME_SECONDS}s`,
      requiredClaims: ["sub", "jti", "iat", "exp"],
    }));
  } catch {
    throw new BridgeAuthError("invalid");
  }
  const { sub, jti, iat, exp, tid, pid, scope } = payload;
  if (exp - iat > MAX_TOKEN_LIFETIME_SECONDS) throw new BridgeAuthError("lifetime");
  if (typeof sub !== "string" || !RESERVATION_ID.test(sub)) throw new BridgeAuthError("claims");
  if (typeof pid !== "string" || !PROPERTY_ID.test(pid)) throw new BridgeAuthError("claims");
  if (typeof tid !== "string" || !tid) throw new BridgeAuthError("claims");
  if (typeof jti !== "string" || jti.length < 16 || jti.length > 64) throw new BridgeAuthError("claims");
  if (!SCOPES.has(scope)) throw new BridgeAuthError("claims");
  return { reservationId: sub, propertyId: pid, tenantId: tid, jti, scope, expiresAt: exp };
}
