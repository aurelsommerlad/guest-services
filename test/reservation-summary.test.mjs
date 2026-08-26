// Pure unit tests for lib/reservationSummary.js — the compact guest-facing
// reservation summary (property name, guest name, adult/child counts)
// assembled from a raw Apaleo reservation object. Dependency-free, so these
// run directly under plain `node --test` without needing a server or live
// Apaleo access.

import { test } from "node:test";
import assert from "node:assert/strict";
import { buildReservationSummary } from "../lib/reservationSummary.js";

function reservation({ firstName, lastName, adults, childrenAges } = {}) {
  return {
    primaryGuest: { firstName, lastName },
    adults,
    childrenAges,
  };
}

test("buildReservationSummary: combines first and last name into guestName", () => {
  const summary = buildReservationSummary(reservation({ firstName: "Peter", lastName: "Körner" }), "LÆKE");
  assert.equal(summary.guestName, "Peter Körner");
});

test("buildReservationSummary: propertyName is passed through as given (already resolved by the caller)", () => {
  const summary = buildReservationSummary(reservation({ firstName: "Peter", lastName: "Körner" }), "LÆKE by UNIQUE PLACES");
  assert.equal(summary.propertyName, "LÆKE by UNIQUE PLACES");
});

test("buildReservationSummary: missing propertyName becomes an empty string, never null/undefined", () => {
  const summary = buildReservationSummary(reservation({ firstName: "Peter", lastName: "Körner" }), null);
  assert.equal(summary.propertyName, "");
});

test("buildReservationSummary: missing guest name parts degrade gracefully", () => {
  assert.equal(buildReservationSummary(reservation({ lastName: "Körner" }), "").guestName, "Körner");
  assert.equal(buildReservationSummary(reservation({ firstName: "Peter" }), "").guestName, "Peter");
  assert.equal(buildReservationSummary(reservation({}), "").guestName, "");
  assert.equal(buildReservationSummary({}, "").guestName, "");
});

test("buildReservationSummary: adults comes straight from the reservation's adults field", () => {
  assert.equal(buildReservationSummary(reservation({ adults: 2 }), "").adults, 2);
  assert.equal(buildReservationSummary(reservation({}), "").adults, 0, "missing adults defaults to 0, not NaN");
});

test("buildReservationSummary: children is derived from childrenAges.length, per the real Apaleo shape", () => {
  assert.equal(buildReservationSummary(reservation({ childrenAges: [10, 12] }), "").children, 2);
  assert.equal(buildReservationSummary(reservation({ childrenAges: [5] }), "").children, 1);
});

test("buildReservationSummary: no childrenAges at all means 0 children, not an error", () => {
  assert.equal(buildReservationSummary(reservation({ adults: 2 }), "").children, 0);
  assert.equal(buildReservationSummary({}, "").children, 0);
});
