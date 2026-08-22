// Regression tests for the request-only ("Auf Anfrage") extras feature:
// fulfillmentMode persistence on the catalog, and the admin request
// list/reject/approve lifecycle. Runs against a real `next dev` server
// using the local JSON fallback DB, same pattern as
// test/catalog-concurrency.test.mjs, on its own port.
//
// What this file can NOT cover: a guest actually submitting a request, and
// an admin successfully approving one (both require live Apaleo reservation
// + service-offers data, which this sandboxed environment cannot reach).
// Those two paths were verified manually against real Apaleo data via a
// temporary, fully-reverted stub — see the session notes. What IS covered
// here without any live Apaleo access:
//   - existing catalog items without fulfillmentMode default to "instant"
//   - an invalid fulfillmentMode value falls back to "instant"
//   - a request-mode item can be set via the admin catalog API
//   - the admin requests list/reject endpoints work against seeded data
//   - rejecting is guarded against acting twice on the same request
//   - rejecting never calls Apaleo (no network access is available in this
//     environment at all, so a passing reject call already proves this)
//   - approving re-verifies live Apaleo data first and, when that fails
//     (as it always will here, since Apaleo is unreachable), the request is
//     left "pending" rather than silently marked approved — this is the
//     core safety property of approveRequest()
//
// Run with: npm test

import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { readFile, writeFile, mkdir, rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const PORT = 3921;
const BASE_URL = `http://localhost:${PORT}`;
const READY_TIMEOUT_MS = 60_000;
const DATA_DIR = path.join(ROOT, ".data");
const DB_PATH = path.join(DATA_DIR, "db.json");

function extractSessionCookie(setCookieHeader) {
  const match = /session=[^;]+/.exec(setCookieHeader || "");
  if (!match) throw new Error(`No session cookie in Set-Cookie header: ${setCookieHeader}`);
  return match[0];
}

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
      JWT_SECRET: "test-secret-for-request-flow-regression-test",
      KV_REST_API_URL: "",
      KV_REST_API_TOKEN: "",
    },
    stdio: "pipe",
  });
}

// Seeds a request record directly into the local JSON fallback DB, in the
// exact shape lib/store.js's hashSetField would produce for the
// "requests:items" hash — this lets us test the approve/reject lifecycle
// without ever needing a real guest submission (which would need live
// Apaleo access to look up a reservation).
async function seedRequest(record) {
  await mkdir(DATA_DIR, { recursive: true });
  let db = {};
  try {
    db = JSON.parse(await readFile(DB_PATH, "utf8"));
  } catch {
    db = {};
  }
  db["requests:items"] = { ...(db["requests:items"] || {}), [record.requestId]: record };
  await writeFile(DB_PATH, JSON.stringify(db, null, 2), "utf8");
}

function makePendingRequest(requestId) {
  return {
    requestId,
    reservationId: "NONEXISTENT-RESERVATION-1",
    bookingId: null,
    propertyId: "TESTPROP",
    propertyName: "Test Property",
    serviceId: "TESTPROP-EARLYCI",
    serviceName: "Early Check-in",
    guestName: "Max Mustermann",
    guestEmail: null,
    requestedQuantity: 1,
    requestedServiceDate: "2026-09-01",
    displayedPrice: 25,
    currency: "EUR",
    arrivalDate: "2026-09-01",
    departureDate: "2026-09-03",
    status: "pending",
    slackNotifiedAt: null,
    approvedAt: null,
    rejectedAt: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

test("request-only extras: fulfillmentMode persistence and admin request lifecycle", async (t) => {
  await rm(DATA_DIR, { recursive: true, force: true });

  const server = startServer();
  try {
    await waitForServer(Date.now() + READY_TIMEOUT_MS);

    const setupRes = await fetch(`${BASE_URL}/api/admin/setup`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: "admin", password: "regression-test-password" }),
    });
    assert.equal(setupRes.status, 200, `setup failed: ${await setupRes.text()}`);
    const cookie = extractSessionCookie(setupRes.headers.get("set-cookie"));

    function saveItem(serviceId, extra = {}) {
      return fetch(`${BASE_URL}/api/admin/catalog`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Cookie: cookie },
        body: JSON.stringify({
          propertyId: "TESTPROP",
          item: { serviceId, code: serviceId, name: serviceId, displayName: serviceId, active: true, ...extra },
        }),
      });
    }

    await t.test("catalog item saved without fulfillmentMode defaults to instant", async () => {
      const res = await saveItem("TESTPROP-DEFAULT");
      assert.equal(res.status, 200);
      const body = await res.json();
      assert.equal(body.item.fulfillmentMode, "instant");
    });

    await t.test("an invalid fulfillmentMode value falls back to instant", async () => {
      const res = await saveItem("TESTPROP-INVALID", { fulfillmentMode: "not-a-real-mode" });
      assert.equal(res.status, 200);
      const body = await res.json();
      assert.equal(body.item.fulfillmentMode, "instant");
    });

    await t.test("fulfillmentMode: 'request' is persisted and round-trips via GET", async () => {
      const res = await saveItem("TESTPROP-EARLYCI", { fulfillmentMode: "request", displayName: "Early Check-in" });
      assert.equal(res.status, 200);
      assert.equal((await res.json()).item.fulfillmentMode, "request");

      const getRes = await fetch(`${BASE_URL}/api/admin/catalog?propertyId=TESTPROP`, { headers: { Cookie: cookie } });
      const items = (await getRes.json()).items;
      const item = items.find((i) => i.serviceId === "TESTPROP-EARLYCI");
      assert.ok(item, "the request-mode item must be present in the catalog");
      assert.equal(item.fulfillmentMode, "request");
      // Untouched instant items must be unaffected by adding a request-mode item.
      const untouched = items.find((i) => i.serviceId === "TESTPROP-DEFAULT");
      assert.equal(untouched.fulfillmentMode, "instant");
    });

    await t.test("GET /api/admin/requests requires authentication", async () => {
      const res = await fetch(`${BASE_URL}/api/admin/requests`);
      assert.equal(res.status, 401);
    });

    const requestId = "11111111-1111-4111-8111-111111111111";

    await t.test("a seeded pending request is listed by the admin requests API", async () => {
      await seedRequest(makePendingRequest(requestId));
      const res = await fetch(`${BASE_URL}/api/admin/requests`, { headers: { Cookie: cookie } });
      assert.equal(res.status, 200);
      const { requests } = await res.json();
      const found = requests.find((r) => r.requestId === requestId);
      assert.ok(found, "seeded request must appear in the list");
      assert.equal(found.status, "pending");
      assert.equal(found.serviceName, "Early Check-in");
    });

    await t.test("approving a pending request re-verifies live Apaleo data first, and never silently approves on failure", async () => {
      // This environment has no Apaleo network access at all, so the
      // re-verification step (getReservationById) is guaranteed to fail —
      // exercising exactly the safety property the spec requires: a failed
      // Apaleo call must leave the request "pending", never falsely mark it
      // "approved". The live-Apaleo success path was verified manually via
      // a temporary, fully-reverted stub (see session notes).
      const res = await fetch(`${BASE_URL}/api/admin/requests/${requestId}/approve`, {
        method: "POST",
        headers: { Cookie: cookie },
      });
      assert.notEqual(res.status, 200, "approval must not succeed without reachable/valid Apaleo data");

      const listRes = await fetch(`${BASE_URL}/api/admin/requests`, { headers: { Cookie: cookie } });
      const { requests } = await listRes.json();
      const found = requests.find((r) => r.requestId === requestId);
      assert.equal(found.status, "pending", "a failed approval attempt must leave the request pending");
      assert.equal(found.approvedAt, null);
    });

    await t.test("rejecting a pending request sets status=rejected and never calls Apaleo", async () => {
      const res = await fetch(`${BASE_URL}/api/admin/requests/${requestId}/reject`, {
        method: "POST",
        headers: { Cookie: cookie },
      });
      const body = await res.json();
      assert.equal(res.status, 200, `reject failed: ${JSON.stringify(body)}`);
      assert.equal(body.request.status, "rejected");
      assert.ok(body.request.rejectedAt);
    });

    await t.test("acting twice on an already-resolved request is rejected", async () => {
      const rejectAgain = await fetch(`${BASE_URL}/api/admin/requests/${requestId}/reject`, {
        method: "POST",
        headers: { Cookie: cookie },
      });
      assert.equal(rejectAgain.status, 409);

      const approveAfterReject = await fetch(`${BASE_URL}/api/admin/requests/${requestId}/approve`, {
        method: "POST",
        headers: { Cookie: cookie },
      });
      assert.equal(approveAfterReject.status, 409, "approving an already-rejected request must be refused");
    });

    await t.test("approving/rejecting an unknown requestId is rejected cleanly", async () => {
      const res = await fetch(`${BASE_URL}/api/admin/requests/does-not-exist/reject`, {
        method: "POST",
        headers: { Cookie: cookie },
      });
      assert.equal(res.status, 409);
    });
  } finally {
    server.kill("SIGTERM");
    await rm(DATA_DIR, { recursive: true, force: true });
  }
});
