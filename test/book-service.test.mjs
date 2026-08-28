// Regression tests for the "multiple book-service calls silently drop
// previously booked dates" production bug (HUESLE-HUND on reservation
// ZCFREFRY-1): lib/guest.js's placeGuestOrder used to call lib/apaleo.js's
// bookService() once per required service date. Apaleo's book-service
// action REPLACES a service's whole date set on every call rather than
// merging into it, so each subsequent call silently dropped every
// previously booked date, leaving only the most recent one booked.
//
// The fix makes bookService() accept a `serviceDates` array and send every
// date in exactly one PUT /booking/v1/reservation-actions/{id}/book-service
// call. These tests exercise the real bookService() implementation end to
// end by overriding the global `fetch` (no live Apaleo access needed, same
// constraint documented in test/request-flow.test.mjs) and asserting on the
// number of calls made and the exact request body sent.
//
// Run with: npm test

import { test } from "node:test";
import assert from "node:assert/strict";
import { bookService } from "../lib/apaleo.js";

// Installs a fake global.fetch that answers Apaleo's OAuth token endpoint
// unconditionally, and records every other request (the actual
// book-service calls) into `calls` for inspection. Restores the real
// fetch when `restore()` is called.
function installFakeFetch() {
  process.env.APALEO_CLIENT_ID ||= "test-client-id";
  process.env.APALEO_CLIENT_SECRET ||= "test-client-secret";

  const calls = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, options = {}) => {
    const urlStr = String(url);
    if (urlStr.includes("identity.apaleo.com")) {
      return new Response(JSON.stringify({ access_token: "fake-token", expires_in: 3600 }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }
    calls.push({
      url: urlStr,
      method: options.method,
      body: options.body ? JSON.parse(options.body) : null,
    });
    return new Response(JSON.stringify({ id: "fake-booked-service" }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  };
  return { calls, restore: () => (globalThis.fetch = originalFetch) };
}

test("bookService: a 6-night per-night service sends all 6 dates in exactly ONE call", async () => {
  const { calls, restore } = installFakeFetch();
  const serviceDates = [
    "2026-09-01",
    "2026-09-02",
    "2026-09-03",
    "2026-09-04",
    "2026-09-05",
    "2026-09-06",
  ];
  try {
    await bookService({
      reservationId: "ZCFREFRY-1",
      serviceId: "HUESLE-HUND",
      count: 1,
      serviceDates,
      amount: { amount: 15, currency: "EUR" },
    });
  } finally {
    restore();
  }

  assert.equal(calls.length, 1, "exactly one book-service request must be made, not one per date");
  const [call] = calls;
  assert.equal(call.method, "PUT");
  assert.match(call.url, /\/booking\/v1\/reservation-actions\/ZCFREFRY-1\/book-service$/);
  assert.equal(call.body.serviceId, "HUESLE-HUND");
  assert.equal(call.body.dates.length, 6, "all 6 nights must be in the single request's dates array");
  assert.deepEqual(
    call.body.dates.map((d) => d.serviceDate),
    serviceDates
  );
  // Every date carries the live-offer amount, never a hard-coded number.
  assert.ok(call.body.dates.every((d) => d.count === 1));
  assert.ok(call.body.dates.every((d) => d.amount?.amount === 15 && d.amount?.currency === "EUR"));
});

test("bookService: no previously booked date is ever dropped — a single call is structurally incapable of it", async () => {
  // The production bug was N sequential calls each replacing the last. The
  // fix removes the loop entirely: bookService() below makes exactly one
  // request per invocation, so calling it once already proves no date can
  // be implicitly replaced by "a subsequent call" — there isn't one.
  const { calls, restore } = installFakeFetch();
  try {
    await bookService({
      reservationId: "ZCFREFRY-1",
      serviceId: "HUESLE-HUND",
      count: 2,
      serviceDates: ["2026-09-01", "2026-09-02", "2026-09-03"],
      amount: { amount: 15, currency: "EUR" },
    });
  } finally {
    restore();
  }

  assert.equal(calls.length, 1);
  assert.deepEqual(
    calls[0].body.dates.map((d) => d.serviceDate),
    ["2026-09-01", "2026-09-02", "2026-09-03"],
    "all three dates must survive together in the one request"
  );
});

test("bookService: an arrival-day-only service still books exactly one date", async () => {
  const { calls, restore } = installFakeFetch();
  try {
    await bookService({
      reservationId: "ZCFREFRY-1",
      serviceId: "EARLYCI",
      count: 1,
      serviceDates: ["2026-09-01"],
      amount: { amount: 25, currency: "EUR" },
    });
  } finally {
    restore();
  }

  assert.equal(calls.length, 1);
  assert.equal(calls[0].body.dates.length, 1);
  assert.equal(calls[0].body.dates[0].serviceDate, "2026-09-01");
});

test("bookService: a departure-day-only service still books exactly one date", async () => {
  const { calls, restore } = installFakeFetch();
  try {
    await bookService({
      reservationId: "ZCFREFRY-1",
      serviceId: "LATECO",
      count: 1,
      serviceDates: ["2026-09-06"],
      amount: { amount: 20, currency: "EUR" },
    });
  } finally {
    restore();
  }

  assert.equal(calls.length, 1);
  assert.equal(calls[0].body.dates.length, 1);
  assert.equal(calls[0].body.dates[0].serviceDate, "2026-09-06");
});

test("bookService: back-compat singular `serviceDate` (the admin-approval call site) still sends exactly one date, no amount field forced", async () => {
  const { calls, restore } = installFakeFetch();
  try {
    await bookService({
      reservationId: "ZCFREFRY-1",
      serviceId: "EARLYCI",
      count: 1,
      serviceDate: "2026-09-01",
    });
  } finally {
    restore();
  }

  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0].body.dates, [{ serviceDate: "2026-09-01", count: 1 }]);
});

test("bookService: count is applied to every date entry, not multiplied across dates", async () => {
  const { calls, restore } = installFakeFetch();
  try {
    await bookService({
      reservationId: "ZCFREFRY-1",
      serviceId: "PKW",
      count: 2,
      serviceDates: ["2026-09-01", "2026-09-02"],
      amount: { amount: 15, currency: "EUR" },
    });
  } finally {
    restore();
  }

  assert.deepEqual(
    calls[0].body.dates,
    [
      { serviceDate: "2026-09-01", count: 2, amount: { amount: 15, currency: "EUR" } },
      { serviceDate: "2026-09-02", count: 2, amount: { amount: 15, currency: "EUR" } },
    ]
  );
});
