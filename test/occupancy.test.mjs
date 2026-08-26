// Pure unit tests for lib/occupancy.js — adult/child counting from a raw
// Apaleo reservation object, shared by lib/reservationSummary.js and
// lib/capacity.js. Dependency-free, so these run directly under plain
// `node --test` without needing a server or live Apaleo access.

import { test } from "node:test";
import assert from "node:assert/strict";
import { getAdultsCount, getChildrenCount, getTotalOccupancy } from "../lib/occupancy.js";

test("getAdultsCount: reads the reservation's adults field", () => {
  assert.equal(getAdultsCount({ adults: 2 }), 2);
  assert.equal(getAdultsCount({ adults: 4 }), 4);
});

test("getAdultsCount: missing adults defaults to 0, not NaN", () => {
  assert.equal(getAdultsCount({}), 0);
  assert.equal(getAdultsCount(null), 0);
  assert.equal(getAdultsCount(undefined), 0);
});

test("getChildrenCount: derives from childrenAges.length, per the real Apaleo shape", () => {
  assert.equal(getChildrenCount({ childrenAges: [10, 12] }), 2);
  assert.equal(getChildrenCount({ childrenAges: [5] }), 1);
  assert.equal(getChildrenCount({ childrenAges: [] }), 0);
});

test("getChildrenCount: no childrenAges at all means 0 children", () => {
  assert.equal(getChildrenCount({ adults: 2 }), 0);
  assert.equal(getChildrenCount({}), 0);
});

test("getTotalOccupancy: an adult-only reservation counts only the adults", () => {
  assert.equal(getTotalOccupancy({ adults: 2 }), 2);
  assert.equal(getTotalOccupancy({ adults: 4, childrenAges: [] }), 4);
});

test("getTotalOccupancy: a reservation with children counts every child the same as an adult", () => {
  // Matches the task's own worked example: 2 adults + 2 children fills a
  // capacity-4 unit group exactly — no weighting, every guest counts as 1.
  assert.equal(getTotalOccupancy({ adults: 2, childrenAges: [5, 7] }), 4);
  assert.equal(getTotalOccupancy({ adults: 2, childrenAges: [7] }), 3);
});
