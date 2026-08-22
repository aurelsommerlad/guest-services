// Regression test for the guest lookup endpoint's rate limiting (see
// lib/rateLimit.js) — reasonable protection against enumeration/repeated
// lookup attempts now that /api/guest/lookup also runs a broader
// OTA/external-reference search. Runs against a real `next dev` server
// using the local JSON fallback DB, same pattern as
// test/catalog-concurrency.test.mjs, on its own port.
//
// This does not need (or use) real Apaleo credentials: the rate-limit
// check runs before any Apaleo call, so requests within the allowed
// quota may still fail downstream (no Apaleo access in this environment)
// — this test only asserts on the presence/absence of HTTP 429, not on
// what happens to requests that get past the limiter.
//
// Run with: npm test

import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const PORT = 3922;
const BASE_URL = `http://localhost:${PORT}`;
const READY_TIMEOUT_MS = 60_000;

async function waitForServer(deadline) {
  while (Date.now() < deadline) {
    try {
      const res = await fetch(BASE_URL);
      if (res.ok || res.status === 404) return;
    } catch {
      // not up yet
    }
    await new Promise((r) => setTimeout(r, 300));
  }
  throw new Error(`Server did not become ready within ${READY_TIMEOUT_MS}ms`);
}

function startServer() {
  const nextBin = path.join(ROOT, "node_modules", ".bin", "next");
  return spawn(nextBin, ["dev", "-p", String(PORT)], {
    cwd: ROOT,
    env: {
      ...process.env,
      JWT_SECRET: "test-secret-for-rate-limit-regression-test",
      KV_REST_API_URL: "",
      KV_REST_API_TOKEN: "",
      // Deliberately invalid/absent so no request in this test can reach
      // real Apaleo, regardless of what .env.local has configured locally.
      APALEO_CLIENT_ID: "",
      APALEO_CLIENT_SECRET: "",
    },
    stdio: "pipe",
  });
}

function lookup(ip, i) {
  return fetch(`${BASE_URL}/api/guest/lookup`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-forwarded-for": ip },
    body: JSON.stringify({ number: `RATE-LIMIT-TEST-${i}`, lastName: "Mustermann" }),
  });
}

test("guest lookup: repeated attempts from the same client are rate-limited", async () => {
  await rm(path.join(ROOT, ".data"), { recursive: true, force: true });

  const server = startServer();
  try {
    await waitForServer(Date.now() + READY_TIMEOUT_MS);

    const ip = "203.0.113.42"; // TEST-NET-3, RFC 5737 — never a real client
    const statuses = [];
    for (let i = 0; i < 12; i++) {
      const res = await lookup(ip, i);
      statuses.push(res.status);
    }

    const rateLimited = statuses.filter((s) => s === 429).length;
    assert.ok(rateLimited > 0, `expected at least one 429 among ${JSON.stringify(statuses)}`);
    assert.ok(
      statuses.slice(0, 5).every((s) => s !== 429),
      `expected the first few attempts to be allowed through, got ${JSON.stringify(statuses.slice(0, 5))}`
    );

    // A different client (different IP) must not be affected by the first
    // client's exhausted quota.
    const otherClientRes = await lookup("198.51.100.7", "other");
    assert.notEqual(otherClientRes.status, 429, "a different client must have its own quota");
  } finally {
    server.kill("SIGTERM");
    await rm(path.join(ROOT, ".data"), { recursive: true, force: true });
  }
});
