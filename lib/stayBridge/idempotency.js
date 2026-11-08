import { deleteKey, getExpiringJSON, setIfNotExistsWithTtl, setJSONWithTtl } from "../db.js";

// Idempotency for booking actions: STAY sends one key per guest confirmation
// (a UUID). The first call claims the key and runs the action; a repeated
// call with the same key (retry, double submit) gets the stored result back
// without touching Apaleo again; a call while the first is still running
// gets 409 "in_progress". Keys are scoped to the reservation and the action.

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const RESULT_TTL_SECONDS = 24 * 60 * 60;

export function isValidIdempotencyKey(key) {
  return typeof key === "string" && UUID.test(key);
}

function storeKey(scope, key) {
  return `stay-bridge:idem:${scope}:${key.toLowerCase()}`;
}

/**
 * Runs `fn` at most once per (scope, key). `fn` returns { status, body };
 * that pair is stored and replayed. If `fn` throws, the claim is released
 * so the guest can retry (nothing was confirmed to them).
 */
export async function runIdempotent(scope, key, fn) {
  const id = storeKey(scope, key);
  const claimed = await setIfNotExistsWithTtl(id, { state: "processing" }, RESULT_TTL_SECONDS);
  if (!claimed) {
    const existing = await getExpiringJSON(id);
    if (existing?.state === "done") return { ...existing.result, replayed: true };
    return { status: 409, body: { error: "in_progress" }, replayed: true };
  }
  try {
    const result = await fn();
    await setJSONWithTtl(id, { state: "done", result }, RESULT_TTL_SECONDS);
    return { ...result, replayed: false };
  } catch (err) {
    await deleteKey(id).catch(() => undefined);
    throw err;
  }
}
