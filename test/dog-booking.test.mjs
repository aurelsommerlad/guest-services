// Tests for lib/dogBooking.js — the pure logic behind the "maximum 1 dog
// per reservation/apartment" rule. Dependency-free, run directly with
// plain `node --test`, no live Apaleo access needed.
//
// Run with: npm test

import { test } from "node:test";
import assert from "node:assert/strict";
import { countBookedServiceQuantity, hasReachedDogLimit, MAX_DOGS_PER_RESERVATION } from "../lib/dogBooking.js";

test("countBookedServiceQuantity: the service isn't booked at all -> 0", () => {
  assert.equal(countBookedServiceQuantity([], "HUESLE-HUND"), 0);
  assert.equal(countBookedServiceQuantity([{ service: { id: "HUESLE-PARKPLATZ" }, dates: [{ count: 1 }] }], "HUESLE-HUND"), 0);
  assert.equal(countBookedServiceQuantity(null, "HUESLE-HUND"), 0);
  assert.equal(countBookedServiceQuantity(undefined, "HUESLE-HUND"), 0);
});

test("countBookedServiceQuantity: booked with a single date -> that date's count", () => {
  const services = [{ service: { id: "HUESLE-HUND" }, dates: [{ serviceDate: "2026-10-10", count: 1 }] }];
  assert.equal(countBookedServiceQuantity(services, "HUESLE-HUND"), 1);
});

test("countBookedServiceQuantity: CRITICAL — a dog booked for 6 nights (6 date entries, count 1 each) still counts as 1, never 6", () => {
  const dates = Array.from({ length: 6 }, (_, i) => ({
    serviceDate: `2026-10-${10 + i}`,
    count: 1,
    amount: { grossAmount: 15, currency: "EUR" },
  }));
  const services = [{ service: { id: "HUESLE-HUND" }, dates }];
  assert.equal(countBookedServiceQuantity(services, "HUESLE-HUND"), 1);
  assert.equal(hasReachedDogLimit(services, "HUESLE-HUND"), true);
});

test("countBookedServiceQuantity: reads count off a date entry, not dates.length, even for a hypothetical count > 1", () => {
  const dates = Array.from({ length: 3 }, () => ({ serviceDate: "2026-10-10", count: 2 }));
  const services = [{ service: { id: "HUESLE-HUND" }, dates }];
  assert.equal(countBookedServiceQuantity(services, "HUESLE-HUND"), 2);
});

test("countBookedServiceQuantity: a service entry with an empty dates array -> 0", () => {
  const services = [{ service: { id: "HUESLE-HUND" }, dates: [] }];
  assert.equal(countBookedServiceQuantity(services, "HUESLE-HUND"), 0);
});

test("countBookedServiceQuantity: malformed/missing dates never throws, resolves to 0", () => {
  assert.doesNotThrow(() => countBookedServiceQuantity([{ service: { id: "HUESLE-HUND" } }], "HUESLE-HUND"));
  assert.equal(countBookedServiceQuantity([{ service: { id: "HUESLE-HUND" } }], "HUESLE-HUND"), 0);
  assert.equal(countBookedServiceQuantity([{ service: { id: "HUESLE-HUND" }, dates: [{}] }], "HUESLE-HUND"), 0);
});

test("hasReachedDogLimit: false when not booked, true once booked (>= MAX_DOGS_PER_RESERVATION)", () => {
  assert.equal(MAX_DOGS_PER_RESERVATION, 1);
  assert.equal(hasReachedDogLimit([], "HUESLE-HUND"), false);
  assert.equal(
    hasReachedDogLimit([{ service: { id: "HUESLE-HUND" }, dates: [{ count: 1 }] }], "HUESLE-HUND"),
    true
  );
});

test("countBookedServiceQuantity / hasReachedDogLimit: works for any property's own service id, not hardcoded to one", () => {
  const services = [{ service: { id: "ALTUS-HUND" }, dates: [{ count: 1 }] }];
  assert.equal(countBookedServiceQuantity(services, "ALTUS-HUND"), 1);
  assert.equal(hasReachedDogLimit(services, "ALTUS-HUND"), true);
  assert.equal(hasReachedDogLimit(services, "HUESLE-HUND"), false);
});

test("other extras (a different, non-dog service on the same reservation) are completely unaffected", () => {
  const services = [
    { service: { id: "HUESLE-HUND" }, dates: [{ count: 1 }] },
    { service: { id: "HUESLE-PARKPLATZ" }, dates: [{ count: 3 }] },
  ];
  assert.equal(countBookedServiceQuantity(services, "HUESLE-PARKPLATZ"), 3);
  assert.equal(hasReachedDogLimit(services, "HUESLE-PARKPLATZ"), true); // Parkplatz itself has no max-1 rule; this just proves the counter reads the right entry
  assert.equal(countBookedServiceQuantity(services, "HUESLE-HUND"), 1);
});
