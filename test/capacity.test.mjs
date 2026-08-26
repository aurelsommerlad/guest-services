// Pure unit tests for lib/capacity.js — remaining-capacity math behind
// requiresRemainingCapacity catalog items (e.g. "Extra person"/
// "Zusatzperson"). Dependency-free, so these run directly under plain
// `node --test` without needing a server or live Apaleo access.

import { test } from "node:test";
import assert from "node:assert/strict";
import { getUnitGroupMaxOccupancy, getRemainingCapacity } from "../lib/capacity.js";

test("getUnitGroupMaxOccupancy: reads maxPersons from a real Apaleo unit-group shape", () => {
  assert.equal(getUnitGroupMaxOccupancy({ id: "LAEKE-AP_L", maxPersons: 5 }), 5);
});

test("getUnitGroupMaxOccupancy: missing/invalid maxPersons resolves to null", () => {
  assert.equal(getUnitGroupMaxOccupancy({}), null);
  assert.equal(getUnitGroupMaxOccupancy(null), null);
  assert.equal(getUnitGroupMaxOccupancy({ maxPersons: "not-a-number" }), null);
});

test("getRemainingCapacity: capacity available for an adult-only reservation", () => {
  // Apartment capacity 4, reservation 2 adults -> remaining 2 -> extra shown.
  const remaining = getRemainingCapacity({ maxPersons: 4 }, { adults: 2 });
  assert.equal(remaining, 2);
  assert.ok(remaining > 0, "extra should be shown");
});

test("getRemainingCapacity: capacity available for a reservation with children (task's worked example)", () => {
  // Apartment capacity 4, reservation 2 adults + 1 child -> remaining 1.
  const remaining = getRemainingCapacity({ maxPersons: 4 }, { adults: 2, childrenAges: [7] });
  assert.equal(remaining, 1);
});

test("getRemainingCapacity: no capacity left (task's worked example) -> extra hidden", () => {
  // Apartment capacity 4, reservation 2 adults + 2 children -> remaining 0.
  const remaining = getRemainingCapacity({ maxPersons: 4 }, { adults: 2, childrenAges: [5, 9] });
  assert.equal(remaining, 0);
});

test("getRemainingCapacity: remainingCapacity of 1 -> max selectable quantity is 1", () => {
  assert.equal(getRemainingCapacity({ maxPersons: 3 }, { adults: 2 }), 1);
});

test("getRemainingCapacity: remainingCapacity of 2 -> max selectable quantity is 2", () => {
  assert.equal(getRemainingCapacity({ maxPersons: 4 }, { adults: 2 }), 2);
});

test("getRemainingCapacity: an already-over-capacity reservation floors at 0, never negative", () => {
  const remaining = getRemainingCapacity({ maxPersons: 4 }, { adults: 3, childrenAges: [2, 4] });
  assert.equal(remaining, 0);
});

test("getRemainingCapacity: fails closed to 0 when the unit group can't be resolved at all", () => {
  assert.equal(getRemainingCapacity(null, { adults: 1 }), 0);
  assert.equal(getRemainingCapacity({}, { adults: 1 }), 0);
});

test("getRemainingCapacity: unrelated fields (allowedUnitGroupIds, availableCount) on the inputs never affect the result", () => {
  // Demonstrates the capacity check is orthogonal to unit-group restriction
  // and Apaleo service-offer availability — those are separate gates
  // (lib/unitGroupRestriction.js, the offer's own availableCount) that
  // combine with, but never interfere with, this calculation.
  const unitGroup = { maxPersons: 4, allowedUnitGroupIds: ["some-other-id"] };
  const reservation = { adults: 2, childrenAges: [7], availableCount: 0 };
  assert.equal(getRemainingCapacity(unitGroup, reservation), 1);
});
