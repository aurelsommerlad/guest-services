// Regression test for the catalog lost-update race condition: concurrent
// admin saves for DIFFERENT services under the same property must all
// survive (see lib/store.js's catalogHashKey() comment for the bug this
// guards against). Runs against a real `next dev` server using the local
// JSON fallback DB — no Apaleo credentials or KV needed, since the admin
// catalog endpoints never call Apaleo.
//
// Run with: npm test

import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const PORT = 3919;
const BASE_URL = `http://localhost:${PORT}`;
const READY_TIMEOUT_MS = 60_000;

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
  const child = spawn(nextBin, ["dev", "-p", String(PORT)], {
    cwd: ROOT,
    env: {
      ...process.env,
      JWT_SECRET: "test-secret-for-catalog-concurrency-regression-test",
      KV_REST_API_URL: "",
      KV_REST_API_TOKEN: "",
    },
    stdio: "pipe",
  });
  return child;
}

test("concurrent admin catalog saves for different services never overwrite each other", async () => {
  await rm(path.join(ROOT, ".data"), { recursive: true, force: true });

  const server = startServer();
  let serverError = "";
  server.stdout.on("data", () => {});
  server.stderr.on("data", (chunk) => {
    serverError += chunk.toString();
  });

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
          item: {
            serviceId,
            code: serviceId,
            name: serviceId,
            displayName: serviceId,
            description: "",
            category: "",
            imageUrl: "",
            active: true,
            bookingRule: "per_stay",
            ...extra,
          },
        }),
      });
    }

    async function getCatalog() {
      const res = await fetch(`${BASE_URL}/api/admin/catalog?propertyId=TESTPROP`, {
        headers: { Cookie: cookie },
      });
      assert.equal(res.status, 200);
      return (await res.json()).items;
    }

    // Run several rounds — the race is probabilistic pre-fix (it showed up
    // in ~4/5 manual runs), so one clean round wouldn't be a strong enough
    // regression guard.
    const ROUNDS = 5;
    for (let round = 1; round <= ROUNDS; round++) {
      const idA = `SVC-A-${round}`;
      const idB = `SVC-B-${round}`;

      const [resA, resB] = await Promise.all([saveItem(idA), saveItem(idB)]);
      assert.equal(resA.status, 200, `round ${round}: save A failed: ${await resA.text()}`);
      assert.equal(resB.status, 200, `round ${round}: save B failed: ${await resB.text()}`);

      const items = await getCatalog();
      const byId = new Map(items.map((i) => [i.serviceId, i]));
      assert.ok(byId.has(idA), `round ${round}: ${idA} missing after concurrent save (lost-update race)`);
      assert.ok(byId.has(idB), `round ${round}: ${idB} missing after concurrent save (lost-update race)`);
    }

    // All items from every round must still be present at the end.
    const finalItems = await getCatalog();
    assert.equal(finalItems.length, ROUNDS * 2, "some previously-saved items disappeared");

    // Updating one existing item concurrently with adding a brand-new one
    // must preserve both the update and every untouched field on the
    // updated item (serviceId/active/bookingRule/displayName/etc.).
    const [updateRes, addRes] = await Promise.all([
      saveItem("SVC-A-1", { active: false, bookingRule: "per_night", displayName: "Updated Name" }),
      saveItem("SVC-NEW"),
    ]);
    assert.equal(updateRes.status, 200);
    assert.equal(addRes.status, 200);

    const afterUpdate = await getCatalog();
    const updated = afterUpdate.find((i) => i.serviceId === "SVC-A-1");
    const added = afterUpdate.find((i) => i.serviceId === "SVC-NEW");
    assert.ok(updated, "updated item disappeared");
    assert.equal(updated.active, false);
    assert.equal(updated.bookingRule, "per_night");
    assert.equal(updated.displayName, "Updated Name");
    assert.ok(added, "concurrently-added new item disappeared");
    assert.equal(afterUpdate.length, ROUNDS * 2 + 1, "item count wrong after concurrent update + add");
  } finally {
    server.kill("SIGTERM");
    await rm(path.join(ROOT, ".data"), { recursive: true, force: true });
    if (serverError && process.env.DEBUG_TEST_SERVER) {
      console.error("dev server stderr:\n" + serverError);
    }
  }
});
