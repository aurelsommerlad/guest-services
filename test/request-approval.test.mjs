// Approving request-only ("Auf Anfrage") extras books EVERY date the item's
// booking rule requires — regression tests for the bug where approval booked
// only the first night of a per-night extra (e.g. a baby cot for a 3-night
// stay was booked for 1 night). Runs in-process against the Apaleo
// simulator (test/support/apaleo-simulator.mjs, stateful, no network) and
// the local JSON DB. Dates are relative to today so the tests never expire.
//
// Run with: npm test

import { test, beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const SIM_DIR = mkdtempSync(path.join(os.tmpdir(), "approval-sim-"));
const SIM_STATE = path.join(SIM_DIR, "state.json");
process.env.APALEO_SIM_STATE = SIM_STATE;
process.env.APALEO_CLIENT_ID = "simulated";
process.env.APALEO_CLIENT_SECRET = "simulated";
delete process.env.SLACK_REQUEST_WEBHOOK_URL;
await import("./support/apaleo-simulator.mjs");
const { approveRequest } = await import("../lib/requests.js");
const { upsertCatalogItem, createRequestRecord, getRequestById } = await import("../lib/store.js");
const { compareExistingBooking, datesWithoutAvailability } = await import("../lib/requestApproval.js");

const RES = "JTKQSYFX-1";
const DATA_DIR = path.join(process.cwd(), ".data");

function day(offset) {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + offset);
  return d.toISOString().slice(0, 10);
}

function sim() {
  return JSON.parse(readFileSync(SIM_STATE, "utf8"));
}
function writeSim(state) {
  writeFileSync(SIM_STATE, JSON.stringify(state, null, 2));
}
function bookServiceCalls(state = sim()) {
  return state.calls.filter((c) => c.method === "PUT" && c.path.includes("book-service"));
}
function bookedEntry(serviceId, state = sim()) {
  return state.services[RES].find((s) => s.service.id === serviceId);
}

/** Fresh simulated reservation of `nights` nights, arriving in 30 days. */
async function freshStay(nights) {
  rmSync(SIM_STATE, { force: true });
  process.env.APALEO_SIM_ARRIVAL = day(30);
  process.env.APALEO_SIM_DEPARTURE = day(30 + nights);
  await fetch("https://api.apaleo.com/booking/v1/reservations/" + RES); // seeds the state
}

async function catalogItem(serviceId, overrides = {}) {
  await upsertCatalogItem("TEST", {
    serviceId,
    code: serviceId.replace("TEST-", ""),
    active: true,
    bookingRule: "per_night",
    fulfillmentMode: "request",
    actionType: "service",
    allowedUnitGroupIds: [],
    maxOnePerReservation: false,
    requiresVehicleRegistration: false,
    requiresRemainingCapacity: false,
    ...overrides,
  });
}

let counter = 0;
async function request(serviceId, quantity, firstDate) {
  const requestId = `req-${++counter}`;
  await createRequestRecord({
    requestId,
    reservationId: RES,
    propertyId: "TEST",
    serviceId,
    serviceName: serviceId,
    guestName: "Test",
    requestedQuantity: quantity,
    requestedServiceDate: firstDate,
    status: "pending",
    createdAt: new Date().toISOString(),
  });
  return requestId;
}

beforeEach(async () => {
  await rm(DATA_DIR, { recursive: true, force: true });
});

after(async () => {
  await rm(DATA_DIR, { recursive: true, force: true });
  rmSync(SIM_DIR, { recursive: true, force: true });
});

test("per night: every night of the stay is booked in ONE call, quantity on each night", async () => {
  await freshStay(3);
  await catalogItem("TEST-BABY");
  const id = await request("TEST-BABY", 1, day(30));
  const result = await approveRequest(id);
  assert.equal(result.success, true, result.error);
  assert.equal(bookServiceCalls().length, 1);
  const entry = bookedEntry("TEST-BABY");
  assert.deepEqual(entry.dates.map((d) => [d.serviceDate, d.count]), [
    [day(30), 1],
    [day(31), 1],
    [day(32), 1],
  ]);
  // Apaleo's own offer price applies on every night (15 € per night).
  assert.deepEqual(entry.dates.map((d) => d.amount.grossAmount), [15, 15, 15]);
  assert.deepEqual((await getRequestById(id)).bookedServiceDates, [day(30), day(31), day(32)]);
});

test("per night with a quantity (e.g. two cots, per unit and night): quantity on every night", async () => {
  await freshStay(2);
  await catalogItem("TEST-BABY");
  const result = await approveRequest(await request("TEST-BABY", 2, day(30)));
  assert.equal(result.success, true, result.error);
  assert.deepEqual(bookedEntry("TEST-BABY").dates.map((d) => [d.serviceDate, d.count]), [
    [day(30), 2],
    [day(31), 2],
  ]);
});

test("one night stay, arrival day, departure day and per stay: exactly one date each", async () => {
  await freshStay(1);
  await catalogItem("TEST-BABY");
  assert.equal((await approveRequest(await request("TEST-BABY", 1, day(30)))).success, true);
  assert.deepEqual(bookedEntry("TEST-BABY").dates.map((d) => d.serviceDate), [day(30)]);

  await freshStay(4);
  await catalogItem("TEST-ECI", { bookingRule: "arrival_day" });
  await catalogItem("TEST-LCO", { bookingRule: "departure_day" });
  await catalogItem("TEST-PKW", { bookingRule: "per_stay" });
  assert.equal((await approveRequest(await request("TEST-ECI", 1, day(30)))).success, true);
  assert.equal((await approveRequest(await request("TEST-LCO", 1, day(34)))).success, true);
  assert.equal((await approveRequest(await request("TEST-PKW", 1, day(30)))).success, true);
  assert.deepEqual(bookedEntry("TEST-ECI").dates.map((d) => d.serviceDate), [day(30)]);
  assert.deepEqual(bookedEntry("TEST-LCO").dates.map((d) => d.serviceDate), [day(34)]);
  assert.deepEqual(bookedEntry("TEST-PKW").dates.map((d) => d.serviceDate), [day(30)]);
});

test("repeated and concurrent approval never books twice", async () => {
  await freshStay(2);
  await catalogItem("TEST-BABY");
  const id = await request("TEST-BABY", 1, day(30));
  const [a, b] = await Promise.all([approveRequest(id), approveRequest(id)]);
  assert.equal([a, b].filter((r) => r.success).length, 1);
  const again = await approveRequest(id);
  assert.equal(again.success, false);
  assert.equal(bookServiceCalls().length, 1);
});

test("retry after Apaleo already accepted the booking: approved without a second booking", async () => {
  await freshStay(2);
  await catalogItem("TEST-BABY");
  const state = sim();
  state.services[RES].push({
    service: { id: "TEST-BABY" },
    dates: [day(30), day(31)].map((serviceDate) => ({ serviceDate, count: 1, amount: { grossAmount: 15, currency: "EUR" } })),
  });
  writeSim(state);
  const id = await request("TEST-BABY", 1, day(30));
  const result = await approveRequest(id);
  assert.equal(result.success, true, result.error);
  assert.equal(result.request.status, "approved");
  assert.equal(bookServiceCalls().length, 0);
});

test("an existing booking with other dates or a lower count is never overwritten", async () => {
  await freshStay(3);
  await catalogItem("TEST-BABY");
  const state = sim();
  state.services[RES].push({
    service: { id: "TEST-BABY" },
    dates: [{ serviceDate: day(30), count: 1, amount: { grossAmount: 15, currency: "EUR" } }],
  });
  writeSim(state);
  const id = await request("TEST-BABY", 1, day(30));
  const result = await approveRequest(id);
  assert.equal(result.success, false);
  assert.match(result.error, /bereits mit anderen Daten/);
  assert.equal(bookServiceCalls().length, 0);
  assert.equal((await getRequestById(id)).status, "pending");
  assert.deepEqual(bookedEntry("TEST-BABY").dates.map((d) => d.serviceDate), [day(30)]);
});

test("availability is checked on every night, not only the first", async () => {
  await freshStay(3);
  await catalogItem("TEST-BABY");
  const state = sim();
  state.availability = { "TEST-BABY": { [day(30)]: 2, [day(31)]: 2, [day(32)]: 1 } };
  writeSim(state);
  const result = await approveRequest(await request("TEST-BABY", 2, day(30)));
  assert.equal(result.success, false);
  assert.match(result.error, /Verfügbarkeit/);
  assert.equal(bookServiceCalls().length, 0);
});

test("the max-one rule still applies to approvals", async () => {
  await freshStay(2);
  await catalogItem("TEST-HUND", { maxOnePerReservation: true });
  assert.equal((await approveRequest(await request("TEST-HUND", 2, day(30)))).success, false);
  assert.equal((await approveRequest(await request("TEST-HUND", 1, day(30)))).success, true);
  assert.equal((await approveRequest(await request("TEST-HUND", 1, day(30)))).success, true); // same dog, already complete
  assert.equal(bookServiceCalls().length, 1);
});

test("pure rules: existing booking comparison and per-date availability", () => {
  const services = [{ service: { id: "S" }, dates: [{ serviceDate: "2030-01-01", count: 2 }, { serviceDate: "2030-01-02", count: 2 }] }];
  assert.equal(compareExistingBooking(services, "X", ["2030-01-01"], 1), "none");
  assert.equal(compareExistingBooking(services, "S", ["2030-01-01", "2030-01-02"], 2), "complete");
  assert.equal(compareExistingBooking(services, "S", ["2030-01-01", "2030-01-02"], 3), "conflict");
  assert.equal(compareExistingBooking(services, "S", ["2030-01-01", "2030-01-03"], 1), "conflict");
  const offer = { dates: [{ serviceDate: "a", availableCount: 3 }, { serviceDate: "b", availableCount: 1 }, { serviceDate: "c" }] };
  assert.deepEqual(datesWithoutAvailability(offer, ["a", "b", "c"], 2), ["b"]);
});
