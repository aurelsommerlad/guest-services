// Pure unit tests for lib/occupancyAmendment.js — the safety-critical price
// and AmendReservation-payload math behind "Extra person"/"Zusatzperson"
// catalog items (actionType "increase_occupancy"). Dependency-free, so
// these run directly under plain `node --test` without needing a server or
// live Apaleo access. The core payload behavior (explicit totalGrossAmount
// per time slice, requote: false, adults increased, everything else
// resent unchanged) was verified live against a disposable test
// reservation before this module was written — see the investigation for
// this feature.

import { test } from "node:test";
import assert from "node:assert/strict";
import { buildExtraPersonPricing, buildOccupancyAmendmentPayload } from "../lib/occupancyAmendment.js";

test("buildExtraPersonPricing: task's worked example (30 EUR/night x 4 nights x 1 person)", () => {
  const pricing = buildExtraPersonPricing({ pricePerNight: 30, nights: 4 });
  assert.deepEqual(pricing.unitPrice, { amount: 30, currency: "EUR" });
  assert.equal(pricing.nights, 4);
  assert.deepEqual(pricing.price, { amount: 120, currency: "EUR" });
});

test("buildExtraPersonPricing: rounds to 2 decimals", () => {
  const pricing = buildExtraPersonPricing({ pricePerNight: 33.333, nights: 3 });
  assert.equal(pricing.price.amount, 100);
});

test("buildExtraPersonPricing: custom currency is passed through", () => {
  const pricing = buildExtraPersonPricing({ pricePerNight: 30, nights: 2, currency: "CHF" });
  assert.equal(pricing.unitPrice.currency, "CHF");
  assert.equal(pricing.price.currency, "CHF");
});

test("buildExtraPersonPricing: refuses invalid price or nights rather than guessing", () => {
  assert.equal(buildExtraPersonPricing({ pricePerNight: -1, nights: 4 }), null);
  assert.equal(buildExtraPersonPricing({ pricePerNight: "not-a-number", nights: 4 }), null);
  assert.equal(buildExtraPersonPricing({ pricePerNight: 30, nights: 0 }), null);
  assert.equal(buildExtraPersonPricing({ pricePerNight: 30, nights: -1 }), null);
  assert.equal(buildExtraPersonPricing({ pricePerNight: 30, nights: NaN }), null);
});

test("buildExtraPersonPricing: zero price per night is allowed (a free additional guest is a valid config)", () => {
  const pricing = buildExtraPersonPricing({ pricePerNight: 0, nights: 3 });
  assert.deepEqual(pricing.price, { amount: 0, currency: "EUR" });
});

function reservation(overrides = {}) {
  return {
    arrival: "2026-09-01",
    departure: "2026-09-05",
    adults: 2,
    childrenAges: [7],
    ...overrides,
  };
}

function slice(ratePlanId, amount, currency = "EUR") {
  return { ratePlan: { id: ratePlanId }, totalGrossAmount: { amount, currency } };
}

test("buildOccupancyAmendmentPayload: disposable-test worked example (three nights, +30 EUR each, +1 adult)", () => {
  // Mirrors the live-verified controlled test: 159 -> 189, 169 -> 199, 149 -> 179.
  const payload = buildOccupancyAmendmentPayload({
    reservation: reservation({ adults: 2, childrenAges: null }),
    timeSlices: [slice("RP1", 159), slice("RP1", 169), slice("RP1", 149)],
    extraPersonPricePerNight: 30,
    additionalPersonCount: 1,
  });
  assert.equal(payload.adults, 3);
  assert.equal(payload.childrenAges, null);
  assert.equal(payload.requote, false);
  assert.equal(payload.arrival, "2026-09-01");
  assert.equal(payload.departure, "2026-09-05");
  assert.deepEqual(
    payload.timeSlices.map((s) => s.totalGrossAmount.amount),
    [189, 199, 179]
  );
  // ratePlanId is resent unchanged for every slice — never repriced.
  assert.ok(payload.timeSlices.every((s) => s.ratePlanId === "RP1"));
});

test("buildOccupancyAmendmentPayload: quantity 2 doubles the per-night surcharge (240 EUR / 4 nights example)", () => {
  const payload = buildOccupancyAmendmentPayload({
    reservation: reservation({ adults: 2 }),
    timeSlices: [slice("RP1", 100), slice("RP1", 100), slice("RP1", 100), slice("RP1", 100)],
    extraPersonPricePerNight: 30,
    additionalPersonCount: 2,
  });
  assert.equal(payload.adults, 4);
  assert.deepEqual(
    payload.timeSlices.map((s) => s.totalGrossAmount.amount),
    [160, 160, 160, 160]
  );
});

test("buildOccupancyAmendmentPayload: preserves differing per-night rates exactly, adding the same flat surcharge to each", () => {
  const payload = buildOccupancyAmendmentPayload({
    reservation: reservation(),
    timeSlices: [slice("RP1", 85), slice("RP1", 95)],
    extraPersonPricePerNight: 30,
    additionalPersonCount: 1,
  });
  assert.deepEqual(
    payload.timeSlices.map((s) => s.totalGrossAmount.amount),
    [115, 125]
  );
});

test("buildOccupancyAmendmentPayload: resends the reservation's existing childrenAges unchanged", () => {
  const payload = buildOccupancyAmendmentPayload({
    reservation: reservation({ childrenAges: [4, 9] }),
    timeSlices: [slice("RP1", 100)],
    extraPersonPricePerNight: 30,
    additionalPersonCount: 1,
  });
  assert.deepEqual(payload.childrenAges, [4, 9]);
});

test("buildOccupancyAmendmentPayload: rounds surcharge totals to 2 decimals", () => {
  const payload = buildOccupancyAmendmentPayload({
    reservation: reservation(),
    timeSlices: [slice("RP1", 100.005)],
    extraPersonPricePerNight: 33.333,
    additionalPersonCount: 1,
  });
  assert.equal(payload.timeSlices[0].totalGrossAmount.amount, 133.34);
});

test("buildOccupancyAmendmentPayload: refuses (returns null) on a time slice missing ratePlan.id", () => {
  const payload = buildOccupancyAmendmentPayload({
    reservation: reservation(),
    timeSlices: [{ totalGrossAmount: { amount: 100, currency: "EUR" } }],
    extraPersonPricePerNight: 30,
    additionalPersonCount: 1,
  });
  assert.equal(payload, null);
});

test("buildOccupancyAmendmentPayload: refuses on a time slice missing totalGrossAmount", () => {
  const payload = buildOccupancyAmendmentPayload({
    reservation: reservation(),
    timeSlices: [{ ratePlan: { id: "RP1" } }],
    extraPersonPricePerNight: 30,
    additionalPersonCount: 1,
  });
  assert.equal(payload, null);
});

test("buildOccupancyAmendmentPayload: refuses on empty/missing timeSlices", () => {
  assert.equal(
    buildOccupancyAmendmentPayload({
      reservation: reservation(),
      timeSlices: [],
      extraPersonPricePerNight: 30,
      additionalPersonCount: 1,
    }),
    null
  );
  assert.equal(
    buildOccupancyAmendmentPayload({
      reservation: reservation(),
      timeSlices: null,
      extraPersonPricePerNight: 30,
      additionalPersonCount: 1,
    }),
    null
  );
});

test("buildOccupancyAmendmentPayload: refuses on a reservation missing arrival/departure", () => {
  assert.equal(
    buildOccupancyAmendmentPayload({
      reservation: { adults: 2 },
      timeSlices: [slice("RP1", 100)],
      extraPersonPricePerNight: 30,
      additionalPersonCount: 1,
    }),
    null
  );
});

test("buildOccupancyAmendmentPayload: refuses zero, negative, or non-integer additionalPersonCount", () => {
  for (const additionalPersonCount of [0, -1, 1.5, NaN]) {
    const payload = buildOccupancyAmendmentPayload({
      reservation: reservation(),
      timeSlices: [slice("RP1", 100)],
      extraPersonPricePerNight: 30,
      additionalPersonCount,
    });
    assert.equal(payload, null, `count ${additionalPersonCount} must be refused`);
  }
});

test("buildOccupancyAmendmentPayload: refuses a negative or non-numeric extraPersonPricePerNight", () => {
  assert.equal(
    buildOccupancyAmendmentPayload({
      reservation: reservation(),
      timeSlices: [slice("RP1", 100)],
      extraPersonPricePerNight: -1,
      additionalPersonCount: 1,
    }),
    null
  );
  assert.equal(
    buildOccupancyAmendmentPayload({
      reservation: reservation(),
      timeSlices: [slice("RP1", 100)],
      extraPersonPricePerNight: "not-a-number",
      additionalPersonCount: 1,
    }),
    null
  );
});
