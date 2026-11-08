// Unit tests for the STAY bridge building blocks that run without a server:
// configuration (off unless fully configured), token verification and the
// expiring-key helpers behind replay protection and idempotency.
//
// Run with: npm test

import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { rm } from "node:fs/promises";
import path from "node:path";
import { SignJWT } from "jose";
import { getBridgeConfig } from "../lib/stayBridge/config.js";
import { verifyBridgeToken } from "../lib/stayBridge/token.js";
import { runIdempotent, isValidIdempotencyKey } from "../lib/stayBridge/idempotency.js";
import { setIfNotExistsWithTtl, getExpiringJSON } from "../lib/db.js";

const SECRET = "unit-test-secret-unit-test-secret-0123456789";
const DATA_DIR = path.join(process.cwd(), ".data");

async function sign(claims = {}, { lifetime = 60, secret = SECRET } = {}) {
  const now = Math.floor(Date.now() / 1000);
  return new SignJWT({ tid: "unique-places", pid: "TEST", scope: "read", ...claims })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuer("stay")
    .setAudience("extras-stay-bridge")
    .setSubject(claims.sub ?? "ABCDEFGH-1")
    .setJti(randomUUID())
    .setIssuedAt(now)
    .setExpirationTime(now + lifetime)
    .sign(new TextEncoder().encode(secret));
}

test("bridge config: off unless enabled with secret, tenant and properties", () => {
  const full = { STAY_BRIDGE_ENABLED: "true", STAY_BRIDGE_SECRET: SECRET, STAY_BRIDGE_TENANT: "unique-places", STAY_BRIDGE_PROPERTY_IDS: "TEST, " };
  assert.deepEqual([...getBridgeConfig(full).propertyIds], ["TEST"]);
  assert.equal(getBridgeConfig({}), null);
  assert.equal(getBridgeConfig({ ...full, STAY_BRIDGE_ENABLED: "1" }), null);
  assert.equal(getBridgeConfig({ ...full, STAY_BRIDGE_SECRET: "short" }), null);
  assert.equal(getBridgeConfig({ ...full, STAY_BRIDGE_TENANT: "" }), null);
  assert.equal(getBridgeConfig({ ...full, STAY_BRIDGE_PROPERTY_IDS: "" }), null);
});

test("token: valid claims are returned", async () => {
  const claims = await verifyBridgeToken(await sign({ scope: "write" }), SECRET);
  assert.equal(claims.reservationId, "ABCDEFGH-1");
  assert.equal(claims.propertyId, "TEST");
  assert.equal(claims.scope, "write");
});

test("token: wrong secret, long lifetime, bad scope and malformed ids are refused", async () => {
  await assert.rejects(verifyBridgeToken(await sign({}, { secret: "x".repeat(40) }), SECRET));
  await assert.rejects(verifyBridgeToken(await sign({}, { lifetime: 600 }), SECRET));
  await assert.rejects(verifyBridgeToken(await sign({ scope: "admin" }), SECRET));
  await assert.rejects(verifyBridgeToken(await sign({ sub: "a/../b" }), SECRET));
  await assert.rejects(verifyBridgeToken("not.a.token", SECRET));
  // "none" algorithm / unsigned tokens are never accepted.
  const unsigned = `${Buffer.from('{"alg":"none"}').toString("base64url")}.${Buffer.from('{"sub":"X"}').toString("base64url")}.`;
  await assert.rejects(verifyBridgeToken(unsigned, SECRET));
});

test("expiring keys: claimed once, free again after expiry", async () => {
  await rm(DATA_DIR, { recursive: true, force: true });
  try {
    assert.equal(await setIfNotExistsWithTtl("k", 1, 1), true);
    assert.equal(await setIfNotExistsWithTtl("k", 1, 1), false);
    await new Promise((r) => setTimeout(r, 1100));
    assert.equal(await getExpiringJSON("k"), null);
    assert.equal(await setIfNotExistsWithTtl("k", 2, 1), true);
  } finally {
    await rm(DATA_DIR, { recursive: true, force: true });
  }
});

test("idempotency: runs once, replays the result, releases on error", async () => {
  await rm(DATA_DIR, { recursive: true, force: true });
  try {
    assert.equal(isValidIdempotencyKey("nope"), false);
    const key = randomUUID();
    let runs = 0;
    const action = async () => ({ status: 201, body: { n: ++runs } });
    const first = await runIdempotent("t", key, action);
    const second = await runIdempotent("t", key, action);
    assert.equal(runs, 1);
    assert.deepEqual(second.body, first.body);
    assert.equal(second.replayed, true);
    const failing = randomUUID();
    await assert.rejects(runIdempotent("t", failing, async () => { throw new Error("boom"); }));
    const retry = await runIdempotent("t", failing, action);
    assert.equal(retry.status, 201);
  } finally {
    await rm(DATA_DIR, { recursive: true, force: true });
  }
});
