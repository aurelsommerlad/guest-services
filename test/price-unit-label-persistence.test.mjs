// Regression test for priceUnitLabel persistence through the real admin
// catalog API: a custom label must be stored and returned exactly as
// entered, an omitted label must be stored as empty (the guest-facing
// bookingRule-based default is resolved at read time by
// lib/priceDisplay.js's resolvePriceUnitLabel — see price-display.test.mjs
// — not baked into storage), and an update to one field must not disturb
// an already-saved priceUnitLabel. Uses the local JSON fallback DB, same
// as test/catalog-concurrency.test.mjs, on a different port to run
// independently of it.
//
// Run with: npm test

import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const PORT = 3920;
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
  return spawn(nextBin, ["dev", "-p", String(PORT)], {
    cwd: ROOT,
    env: {
      ...process.env,
      JWT_SECRET: "test-secret-for-price-unit-label-regression-test",
      KV_REST_API_URL: "",
      KV_REST_API_TOKEN: "",
    },
    stdio: "pipe",
  });
}

test("priceUnitLabel is persisted through the real admin catalog API", async () => {
  await rm(path.join(ROOT, ".data"), { recursive: true, force: true });

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
          item: {
            serviceId,
            code: serviceId,
            name: serviceId,
            displayName: serviceId,
            active: true,
            bookingRule: "per_night",
            ...extra,
          },
        }),
      });
    }

    async function getCatalog() {
      const res = await fetch(`${BASE_URL}/api/admin/catalog?propertyId=TESTPROP`, { headers: { Cookie: cookie } });
      assert.equal(res.status, 200);
      return (await res.json()).items;
    }

    // 1. Custom label round-trips exactly, matching the LAEKE-PKW example
    //    from the spec.
    const withLabelRes = await saveItem("LAEKE-PKW", { priceUnitLabel: "pro Stellplatz / Nacht" });
    assert.equal(withLabelRes.status, 200);
    const withLabelBody = await withLabelRes.json();
    assert.equal(withLabelBody.item.priceUnitLabel, "pro Stellplatz / Nacht");

    // 2. Omitted priceUnitLabel is stored empty — the bookingRule-based
    //    default is a display-time fallback (tested in
    //    price-display.test.mjs), never written into storage.
    const withoutLabelRes = await saveItem("LAEKE-OTHER", { bookingRule: "per_stay" });
    assert.equal(withoutLabelRes.status, 200);
    const withoutLabelBody = await withoutLabelRes.json();
    assert.equal(withoutLabelBody.item.priceUnitLabel, "");

    let items = await getCatalog();
    let pkw = items.find((i) => i.serviceId === "LAEKE-PKW");
    let other = items.find((i) => i.serviceId === "LAEKE-OTHER");
    assert.equal(pkw.priceUnitLabel, "pro Stellplatz / Nacht");
    assert.equal(pkw.bookingRule, "per_night");
    assert.equal(other.priceUnitLabel, "");

    // 3. Updating an unrelated field (active) on an existing item preserves
    //    its priceUnitLabel and bookingRule — admin save/update must not
    //    disturb fields it didn't intend to change.
    const updateRes = await saveItem("LAEKE-PKW", {
      priceUnitLabel: "pro Stellplatz / Nacht",
      displayName: "Parkplatz (aktualisiert)",
      active: false,
    });
    assert.equal(updateRes.status, 200);

    items = await getCatalog();
    pkw = items.find((i) => i.serviceId === "LAEKE-PKW");
    assert.equal(pkw.priceUnitLabel, "pro Stellplatz / Nacht", "priceUnitLabel must survive an update to other fields");
    assert.equal(pkw.displayName, "Parkplatz (aktualisiert)");
    assert.equal(pkw.active, false);

    // 4. Whitespace-only input is stored verbatim (trimmed) by the route —
    //    trimming to empty happens here; the *fallback default* itself is
    //    resolved later, at guest-display time.
    const whitespaceRes = await saveItem("LAEKE-WS", { priceUnitLabel: "   " });
    const whitespaceBody = await whitespaceRes.json();
    assert.equal(whitespaceBody.item.priceUnitLabel, "");
  } finally {
    server.kill("SIGTERM");
    await rm(path.join(ROOT, ".data"), { recursive: true, force: true });
  }
});
