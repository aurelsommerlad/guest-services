// Integration tests for the internal STAY bridge (/api/stay/v1/*), against a
// real `next dev` server with the local JSON DB and the Apaleo simulator
// (test/support/apaleo-simulator.mjs) — no live Apaleo, no Slack: the
// simulator refuses every outbound host except Apaleo (simulated) and fonts.
//
// Covers: token checks (signature, expiry, audience, lifetime, scope,
// tenant/property allow-list, replay), reservation binding, rate limit,
// catalog shape, binding-price re-check, idempotency, duplicate and parallel
// bookings, licence plate, dog limit, extra person, request flow incl.
// parallel duplicates, extension night, overview, audit without personal
// data, and that the existing public guest endpoints keep working.
//
// Run with: npm test

import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { startNextDev, waitForReady } from "./support/next-dev-server.mjs";
import { randomUUID } from "node:crypto";
import { readFile, rm, mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { SignJWT } from "jose";
import { seedTestCatalog } from "./support/stay-bridge-seed.mjs";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const PORT = 3931;
const BASE = `http://localhost:${PORT}`;
const DATA_DIR = path.join(ROOT, ".data");
const SIM_STATE = path.join(DATA_DIR, "apaleo-sim-bridge-test.json");
const SECRET = "test-only-stay-bridge-secret-0123456789abcdef";
const RES = "JTKQSYFX-1";
// A two-night stay 60 days from now – relative, so these tests never expire.
function day(offset) {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + offset);
  return d.toISOString().slice(0, 10);
}
const ARRIVAL = day(60);
const DEPARTURE = day(62);
const NEW_DEPARTURE = day(63);
let server;

async function token(overrides = {}, { secret = SECRET, lifetime = 60, audience = "extras-stay-bridge" } = {}) {
  const now = Math.floor(Date.now() / 1000);
  const claims = { tid: "unique-places", pid: "TEST", scope: "read", ...overrides };
  const sub = claims.sub ?? RES;
  delete claims.sub;
  return new SignJWT(claims)
    .setProtectedHeader({ alg: "HS256" })
    .setIssuer("stay")
    .setAudience(audience)
    .setSubject(sub)
    .setJti(claims.jti ?? randomUUID())
    .setIssuedAt(claims.iat ?? now)
    .setExpirationTime((claims.iat ?? now) + lifetime)
    .sign(new TextEncoder().encode(secret));
}

async function call(route, body, { scope = route === "catalog" || route === "overview" ? "read" : "write", bearer } = {}) {
  const auth = bearer ?? (await token({ scope }));
  const res = await fetch(`${BASE}/api/stay/v1/${route}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${auth}` },
    body: JSON.stringify(body ?? {}),
  });
  return { status: res.status, body: await res.json().catch(() => null) };
}

async function sim() {
  return JSON.parse(await readFile(SIM_STATE, "utf8"));
}

function writes(state, fragment) {
  return state.calls.filter((c) => c.method !== "GET" && c.path.includes(fragment));
}


before(async () => {
  await rm(DATA_DIR, { recursive: true, force: true });
  await mkdir(DATA_DIR, { recursive: true });
  await seedTestCatalog();
  server = startNextDev({
    root: ROOT,
    port: PORT,
    env: {
      NODE_OPTIONS: `--import ${path.join(ROOT, "test/support/apaleo-simulator.mjs")}`,
      APALEO_SIM_STATE: SIM_STATE,
      APALEO_SIM_ARRIVAL: ARRIVAL,
      APALEO_SIM_DEPARTURE: DEPARTURE,
      APALEO_CLIENT_ID: "simulated",
      APALEO_CLIENT_SECRET: "simulated",
      STAY_BRIDGE_ENABLED: "true",
      STAY_BRIDGE_SECRET: SECRET,
      STAY_BRIDGE_TENANT: "unique-places",
      STAY_BRIDGE_PROPERTY_IDS: "TEST",
      // This file makes more writes on one reservation than a guest would.
      STAY_BRIDGE_RATE_LIMIT_WRITE: "40",
      SLACK_REQUEST_WEBHOOK_URL: "",
      KV_REST_API_URL: "",
      KV_REST_API_TOKEN: "",
    },
  });
  await waitForReady(server, BASE, { probePath: "/api/stay/v1/catalog" });
});

after(async () => {
  await server?.stop();
  await rm(DATA_DIR, { recursive: true, force: true });
});

test("rejects missing, forged, expired, foreign-audience and over-long tokens", async () => {
  assert.equal((await call("catalog", {}, { bearer: "" })).status, 401);
  assert.equal((await call("catalog", {}, { bearer: await token({}, { secret: "another-secret-another-secret-another-secret" }) })).status, 401);
  const old = Math.floor(Date.now() / 1000) - 600;
  assert.equal((await call("catalog", {}, { bearer: await token({ iat: old }) })).status, 401);
  assert.equal((await call("catalog", {}, { bearer: await token({}, { audience: "someone-else" }) })).status, 401);
  assert.equal((await call("catalog", {}, { bearer: await token({}, { lifetime: 3600 }) })).status, 401);
});

test("a token is accepted exactly once (replay protection)", async () => {
  const bearer = await token({ scope: "read" });
  assert.equal((await call("catalog", {}, { bearer })).status, 200);
  assert.equal((await call("catalog", {}, { bearer })).status, 401);
});

test("tenant, property, scope and reservation binding are enforced", async () => {
  assert.equal((await call("catalog", {}, { bearer: await token({ pid: "HUESLE" }) })).status, 403);
  assert.equal((await call("catalog", {}, { bearer: await token({ tid: "other-tenant" }) })).status, 403);
  assert.equal((await call("catalog", {}, { bearer: await token({ sub: "UNKNOWN-1" }) })).status, 403);
  // A read token cannot book.
  assert.equal((await call("order", {}, { bearer: await token({ scope: "read" }) })).status, 403);
});

test("catalog: every curated service with its live price, extension night, nothing booked yet", async () => {
  const { status, body } = await call("catalog");
  assert.equal(status, 200);
  const byId = Object.fromEntries(body.items.map((item) => [item.serviceId, item]));
  assert.deepEqual(Object.keys(byId).sort(), ["TEST-BABY", "TEST-ECI", "TEST-EXTRPERSON", "TEST-HUND", "TEST-LCO", "TEST-PKW"]);
  assert.deepEqual(byId["TEST-ECI"].price, { amountCents: 2000, currency: "EUR" });
  assert.deepEqual(byId["TEST-HUND"].price, { amountCents: 3000, currency: "EUR" });
  assert.equal(byId["TEST-HUND"].maxQuantity, 1);
  assert.equal(byId["TEST-BABY"].fulfillment, "request");
  assert.equal(byId["TEST-EXTRPERSON"].actionType, "increase_occupancy");
  assert.equal(byId["TEST-EXTRPERSON"].maxQuantity, 3); // 6 max persons − 2 adults − 1 child
  assert.equal(byId["TEST-PKW"].requiresVehicleRegistration, true);
  assert.ok(body.items.every((item) => item.bookedCount === 0));
  assert.equal(body.extension.currentDeparture, DEPARTURE);
  assert.equal(body.extension.newDeparture, NEW_DEPARTURE);
  assert.deepEqual(body.extension.totalPrice, { amountCents: 8910, currency: "EUR" });
  // No guest data in the catalog.
  assert.ok(!JSON.stringify(body).includes("Mustermann"));
});

test("order: invalid input is refused before anything else", async () => {
  const valid = { idempotencyKey: randomUUID(), serviceId: "TEST-ECI", count: 1, expectedPrice: { amountCents: 2000, currency: "EUR" } };
  for (const broken of [
    { ...valid, idempotencyKey: "not-a-uuid" },
    { ...valid, serviceId: "../../etc" },
    { ...valid, count: 0 },
    { ...valid, count: 1.5 },
    { ...valid, expectedPrice: undefined },
  ]) {
    assert.equal((await call("order", broken)).status, 400);
  }
});

test("order: a changed price is never booked", async () => {
  const before = writes(await sim(), "book-service").length;
  const res = await call("order", { idempotencyKey: randomUUID(), serviceId: "TEST-ECI", count: 1, expectedPrice: { amountCents: 1500, currency: "EUR" } });
  assert.equal(res.status, 409);
  assert.equal(res.body.error, "price_changed");
  assert.deepEqual(res.body.price, { amountCents: 2000, currency: "EUR" });
  assert.equal(writes(await sim(), "book-service").length, before);
});

test("order: books once; the same key replays, a new key is refused as already booked", async () => {
  const key = randomUUID();
  const line = { idempotencyKey: key, serviceId: "TEST-ECI", count: 1, expectedPrice: { amountCents: 2000, currency: "EUR" } };
  const first = await call("order", line);
  assert.equal(first.status, 201);
  assert.equal(first.body.status, "booked");
  assert.deepEqual(first.body.serviceDates, [ARRIVAL]);
  const again = await call("order", line);
  assert.equal(again.status, 201);
  assert.deepEqual(again.body, first.body);
  const other = await call("order", { ...line, idempotencyKey: randomUUID() });
  assert.equal(other.status, 409);
  assert.equal(other.body.error, "already_booked");
  const state = await sim();
  assert.equal(writes(state, "book-service").length, 1);
  assert.ok(state.services[RES].some((s) => s.service.id === "TEST-ECI"));
});

test("order: two parallel bookings of the same service book exactly once", async () => {
  const line = () => ({ idempotencyKey: randomUUID(), serviceId: "TEST-LCO", count: 1, expectedPrice: { amountCents: 2000, currency: "EUR" } });
  const results = await Promise.all([call("order", line()), call("order", line()), call("order", line())]);
  const statuses = results.map((r) => r.status).sort();
  assert.deepEqual(statuses.filter((s) => s === 201).length, 1, JSON.stringify(results));
  assert.ok(results.filter((r) => r.status !== 201).every((r) => r.status === 409));
  const lco = (await sim()).calls.filter((c) => c.method === "PUT" && c.path.includes("book-service"));
  assert.equal(lco.length, 2); // ECI from the previous test + exactly one LCO
});

test("order: parking needs a licence plate, which is stored before booking", async () => {
  const base = { serviceId: "TEST-PKW", count: 1, expectedPrice: { amountCents: 0, currency: "EUR" } };
  const missing = await call("order", { ...base, idempotencyKey: randomUUID() });
  assert.equal(missing.status, 400);
  assert.equal(missing.body.error, "vehicle_registration_required");
  const ok = await call("order", { ...base, idempotencyKey: randomUUID(), vehiclePlates: ["LI-UP 2027"] });
  assert.equal(ok.status, 201);
  const state = await sim();
  assert.deepEqual(state.reservations[RES].primaryGuest.vehicleRegistration, { number: "LI-UP 2027", countryCode: "DE" });
});

test("order: the dog limit and capacity limits of Extras apply unchanged", async () => {
  const dog = await call("order", { idempotencyKey: randomUUID(), serviceId: "TEST-HUND", count: 2, expectedPrice: { amountCents: 6000, currency: "EUR" } });
  assert.equal(dog.status, 409);
  assert.equal(dog.body.error, "limit_reached");
  const tooMany = await call("order", { idempotencyKey: randomUUID(), serviceId: "TEST-EXTRPERSON", count: 4, expectedPrice: { amountCents: 24000, currency: "EUR" } });
  assert.equal(tooMany.status, 409);
  assert.equal(tooMany.body.error, "capacity_exceeded");
});

test("order: an additional guest amends the reservation via the existing Extras logic", async () => {
  const res = await call("order", { idempotencyKey: randomUUID(), serviceId: "TEST-EXTRPERSON", count: 1, expectedPrice: { amountCents: 6000, currency: "EUR" } });
  assert.equal(res.status, 201);
  const state = await sim();
  assert.equal(state.reservations[RES].adults, 3);
  assert.deepEqual(state.reservations[RES].timeSlices.map((s) => s.totalGrossAmount.amount), [129, 129]);
});

test("request: parallel duplicates create exactly one pending request, no Slack call", async () => {
  const body = () => ({ idempotencyKey: randomUUID(), serviceId: "TEST-BABY", quantity: 1 });
  const results = await Promise.all([call("request", body()), call("request", body())]);
  assert.equal(results.filter((r) => r.status === 201).length, 1, JSON.stringify(results));
  const later = await call("request", body());
  assert.equal(later.status, 409);
  assert.equal(later.body.error, "already_requested");
  // Instant services cannot be "requested", request services cannot be booked.
  assert.equal((await call("request", { ...body(), serviceId: "TEST-HUND" })).status, 409);
  assert.equal((await call("order", { idempotencyKey: randomUUID(), serviceId: "TEST-BABY", count: 1, expectedPrice: { amountCents: 3000, currency: "EUR" } })).status, 409);
  const db = JSON.parse(await readFile(path.join(DATA_DIR, "db.json"), "utf8"));
  const requests = Object.values(db["requests:items"] || {});
  assert.equal(requests.length, 1);
  assert.equal(requests[0].slackNotifiedAt, null);
});

test("extension night: price re-check, confirm once, replay, then no longer offered", async () => {
  const wrong = await call("stay-extension", { idempotencyKey: randomUUID(), currentDeparture: DEPARTURE, expectedPrice: { amountCents: 5000, currency: "EUR" } });
  assert.equal(wrong.status, 409);
  assert.equal(wrong.body.error, "price_changed");
  const catalog = await call("catalog");
  const expectedPrice = catalog.body.extension.totalPrice;
  // The booked parking space (per night) is extended too – with its amount, not a blank.
  const parking = catalog.body.extension.extras.find((extra) => extra.serviceId === "TEST-PKW");
  assert.equal(parking?.amountCents, 0);
  const key = randomUUID();
  const ok = await call("stay-extension", { idempotencyKey: key, currentDeparture: DEPARTURE, expectedPrice });
  assert.equal(ok.status, 201, JSON.stringify(ok.body));
  assert.equal(ok.body.newDeparture, NEW_DEPARTURE);
  const replay = await call("stay-extension", { idempotencyKey: key, currentDeparture: DEPARTURE, expectedPrice });
  assert.deepEqual(replay.body, ok.body);
  const again = await call("stay-extension", { idempotencyKey: randomUUID(), currentDeparture: DEPARTURE, expectedPrice });
  assert.equal(again.status, 409);
  const state = await sim();
  assert.equal(state.reservations[RES].departure.slice(0, 10), NEW_DEPARTURE);
  // The Late Check-out booked earlier moves to the new departure: one date,
  // same count and amount (Apaleo TEST-LCO: mode Departure, postNextDay).
  const lco = state.services[RES].find((s) => s.service.id === "TEST-LCO");
  assert.deepEqual(lco.dates.map((d) => [d.serviceDate, d.count, d.amount.grossAmount]), [[NEW_DEPARTURE, 1, 20]]);
  const db = JSON.parse(await readFile(path.join(DATA_DIR, "db.json"), "utf8"));
  const [record] = Object.values(db["stay-extensions:records"] || {});
  assert.deepEqual(
    record.lateCheckoutMoves.map((m) => [m.serviceId, m.oldDeparture, m.newDeparture, m.moved, m.verified]),
    [["TEST-LCO", DEPARTURE, NEW_DEPARTURE, true, true]],
  );
});

test("overview: booked services from Apaleo, the request with its Extras status, the extension", async () => {
  const { status, body } = await call("overview");
  assert.equal(status, 200);
  const booked = Object.fromEntries(body.booked.map((b) => [b.serviceId, b]));
  assert.ok(booked["TEST-ECI"] && booked["TEST-LCO"] && booked["TEST-PKW"]);
  assert.equal(booked["TEST-FINALCLEAN"], undefined); // mandatory rate-plan services are not "extras"
  assert.equal(booked["TEST-ECI"].name.de, "Früher Check-in");
  assert.deepEqual(body.requests.map((r) => [r.serviceId, r.status]), [["TEST-BABY", "pending"]]);
  assert.deepEqual(body.extensions.map((e) => e.newDeparture), [NEW_DEPARTURE]);
  assert.deepEqual(body.amendments.map((a) => [a.serviceId, a.count, a.total?.amountCents]), [["TEST-EXTRPERSON", 1, 6000]]);
});

test("rate limit per reservation on write calls", async () => {
  let last;
  for (let i = 0; i < 41; i++) {
    last = await call("order", { bad: true }, { bearer: await token({ scope: "write", sub: "RATE-LIMIT-1" }) });
  }
  assert.equal(last.status, 429);
});

test("audit trail: every call recorded, without guest names or plates", async () => {
  const db = JSON.parse(await readFile(path.join(DATA_DIR, "db.json"), "utf8"));
  const audit = Object.values(db["stay-bridge:audit"] || {});
  assert.ok(audit.length > 20);
  assert.ok(audit.some((a) => a.action === "order" && a.outcome === "ok" && a.serviceId === "TEST-ECI"));
  assert.ok(audit.some((a) => a.outcome === "rejected" && a.detail === "replay"));
  assert.ok(audit.some((a) => a.outcome === "replayed"));
  const text = JSON.stringify(audit);
  assert.ok(!text.includes("Mustermann") && !text.includes("LI-UP"));
});

test("existing public guest endpoints are unchanged", async () => {
  const res = await fetch(`${BASE}/api/guest/catalog`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ reservationId: RES, lastName: "Mustermann", language: "de" }),
  });
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.ok(Array.isArray(body.items) && body.items.length > 0);
  const wrongName = await fetch(`${BASE}/api/guest/catalog`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ reservationId: RES, lastName: "Falsch", language: "de" }),
  });
  assert.equal(wrongName.status, 404);
});
