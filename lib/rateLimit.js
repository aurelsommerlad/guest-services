import { getJSON, setJSON } from "./db";

// This app has no dedicated rate-limiting infrastructure, so this is
// deliberately a small, self-contained fixed-window limiter built on the
// same getJSON/setJSON primitives already used elsewhere (see
// lib/store.js), rather than a new generic framework. It exists
// specifically to blunt enumeration attempts against the guest lookup
// endpoint, which now also runs a broader OTA/external-reference search.
const WINDOW_MS = 5 * 60 * 1000; // 5 minutes
const MAX_ATTEMPTS = 10;

function rateLimitKey(namespace, identifier) {
  return `ratelimit:${namespace}:${identifier}`;
}

/**
 * Returns true if a request identified by `identifier` (typically the
 * caller's IP) should be allowed under `namespace`'s fixed window, false if
 * the limit has been exceeded. A missing/empty identifier always allows the
 * request through — there is nothing meaningful to key on, and refusing
 * outright would be a bigger regression than skipping the limit here.
 */
export async function checkRateLimit(namespace, identifier, { windowMs = WINDOW_MS, maxAttempts = MAX_ATTEMPTS } = {}) {
  if (!identifier) return true;

  const key = rateLimitKey(namespace, identifier);
  const now = Date.now();
  const state = await getJSON(key, null);

  if (!state || now - state.windowStart > windowMs) {
    await setJSON(key, { windowStart: now, count: 1 });
    return true;
  }

  if (state.count >= maxAttempts) {
    return false;
  }

  await setJSON(key, { windowStart: state.windowStart, count: state.count + 1 });
  return true;
}
