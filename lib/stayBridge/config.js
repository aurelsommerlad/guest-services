// Configuration of the internal STAY bridge (/api/stay/v1/*). The bridge is
// OFF unless every value is set — an unconfigured deployment (e.g. the
// current production Extras deployment) answers 404 on every bridge route,
// so adding this code changes nothing there.
//
//   STAY_BRIDGE_ENABLED       "true" to switch the bridge on
//   STAY_BRIDGE_SECRET        shared HS256 secret with STAY (>= 32 chars,
//                             server-side only on both sides)
//   STAY_BRIDGE_TENANT        the one STAY tenant allowed (e.g. "unique-places")
//   STAY_BRIDGE_PROPERTY_IDS  comma-separated Apaleo property ids allowed
//                             (staging: "TEST" only)

export const TOKEN_ISSUER = "stay";
export const TOKEN_AUDIENCE = "extras-stay-bridge";
/** Upper bound for a token's lifetime (exp - iat), seconds. */
export const MAX_TOKEN_LIFETIME_SECONDS = 120;

export function getBridgeConfig(env = process.env) {
  const enabled = env.STAY_BRIDGE_ENABLED === "true";
  const secret = env.STAY_BRIDGE_SECRET || "";
  const tenantId = (env.STAY_BRIDGE_TENANT || "").trim();
  const propertyIds = (env.STAY_BRIDGE_PROPERTY_IDS || "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  if (!enabled || secret.length < 32 || !tenantId || !propertyIds.length) return null;
  return { secret, tenantId, propertyIds: new Set(propertyIds) };
}
