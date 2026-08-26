// Pure unit tests for lib/vehicleRegistration.js — the mandatory
// license-plate capture behind catalog items configured with
// requiresVehicleRegistration (e.g. parking). Dependency-free, so these run
// directly under plain `node --test` without needing a server or live
// Apaleo access.

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_VEHICLE_COUNTRY_CODE,
  resizeVehiclePlates,
  hasCompleteVehiclePlates,
  normalizeVehiclePlates,
  buildPrimaryVehicleRegistration,
  formatVehiclePlatesComment,
} from "../lib/vehicleRegistration.js";

test("resizeVehiclePlates: quantity 0 has no plate fields", () => {
  assert.deepEqual(resizeVehiclePlates([], 0), []);
  assert.deepEqual(resizeVehiclePlates(["LI-UP 123"], 0), []);
});

test("resizeVehiclePlates: quantity 1 creates a single empty field with no existing plate", () => {
  assert.deepEqual(resizeVehiclePlates([], 1), [""]);
});

test("resizeVehiclePlates: quantity 1 pre-fills index 0 from the reservation's existing plate", () => {
  assert.deepEqual(resizeVehiclePlates([], 1, "LI-UP 123"), ["LI-UP 123"]);
});

test("resizeVehiclePlates: existing plate is only used to seed a brand-new list, never overwrites an in-progress edit", () => {
  assert.deepEqual(resizeVehiclePlates(["B-AB 456"], 1, "LI-UP 123"), ["B-AB 456"]);
});

test("resizeVehiclePlates: growing quantity 1 -> 2 preserves the first entry and adds an empty second", () => {
  assert.deepEqual(resizeVehiclePlates(["LI-UP 123"], 2), ["LI-UP 123", ""]);
});

test("resizeVehiclePlates: shrinking quantity 3 -> 2 drops the trailing entry safely, keeps the first two", () => {
  assert.deepEqual(resizeVehiclePlates(["A-AA 1", "B-BB 2", "C-CC 3"], 2), ["A-AA 1", "B-BB 2"]);
});

test("resizeVehiclePlates: non-array current is treated as empty rather than throwing", () => {
  assert.deepEqual(resizeVehiclePlates(null, 1, "LI-UP 123"), ["LI-UP 123"]);
  assert.deepEqual(resizeVehiclePlates(undefined, 2), ["", ""]);
});

test("hasCompleteVehiclePlates: parking quantity 0 -> no plate required", () => {
  assert.equal(hasCompleteVehiclePlates([], 0), true);
  assert.equal(hasCompleteVehiclePlates(undefined, 0), true);
});

test("hasCompleteVehiclePlates: parking quantity 1 -> one plate required", () => {
  assert.equal(hasCompleteVehiclePlates([""], 1), false);
  assert.equal(hasCompleteVehiclePlates(["LI-UP 123"], 1), true);
});

test("hasCompleteVehiclePlates: parking quantity 2 -> two plates required", () => {
  assert.equal(hasCompleteVehiclePlates(["LI-UP 123", ""], 2), false);
  assert.equal(hasCompleteVehiclePlates(["LI-UP 123", "B-AB 456"], 2), true);
});

test("hasCompleteVehiclePlates: whitespace-only counts as empty", () => {
  assert.equal(hasCompleteVehiclePlates(["   "], 1), false);
});

test("hasCompleteVehiclePlates: entries beyond the required count never matter", () => {
  assert.equal(hasCompleteVehiclePlates(["LI-UP 123", "", "ignored"], 1), true);
});

test("normalizeVehiclePlates: empty plate blocks booking (returns null)", () => {
  assert.equal(normalizeVehiclePlates(["LI-UP 123", ""], 2), null);
  assert.equal(normalizeVehiclePlates([], 1), null);
});

test("normalizeVehiclePlates: a complete list is trimmed and truncated to exactly `count`", () => {
  assert.deepEqual(normalizeVehiclePlates(["  LI-UP 123  ", " B-AB 456 ", "extra"], 2), ["LI-UP 123", "B-AB 456"]);
});

test("normalizeVehiclePlates: quantity 0 normalizes to an empty (valid) list", () => {
  assert.deepEqual(normalizeVehiclePlates([], 0), []);
});

test("buildPrimaryVehicleRegistration: primary vehicle registration is built for Apaleo with the default country code", () => {
  assert.deepEqual(buildPrimaryVehicleRegistration(["LI-UP 123"]), {
    number: "LI-UP 123",
    countryCode: DEFAULT_VEHICLE_COUNTRY_CODE,
  });
  assert.equal(DEFAULT_VEHICLE_COUNTRY_CODE, "DE");
});

test("buildPrimaryVehicleRegistration: only the first plate is ever used for the primary field", () => {
  assert.deepEqual(buildPrimaryVehicleRegistration(["LI-UP 123", "B-AB 456"]), {
    number: "LI-UP 123",
    countryCode: "DE",
  });
});

test("buildPrimaryVehicleRegistration: a custom country code is honored", () => {
  assert.deepEqual(buildPrimaryVehicleRegistration(["AB-123", "AT"], "AT"), { number: "AB-123", countryCode: "AT" });
});

test("buildPrimaryVehicleRegistration: no plates -> null, never fabricates a value", () => {
  assert.equal(buildPrimaryVehicleRegistration([]), null);
  assert.equal(buildPrimaryVehicleRegistration(undefined), null);
});

test("formatVehiclePlatesComment: additional vehicles are formatted exactly per the required structure", () => {
  assert.equal(
    formatVehiclePlatesComment(["LI-UP 123", "B-AB 456"]),
    "Parking vehicles:\n1. LI-UP 123\n2. B-AB 456"
  );
});

test("formatVehiclePlatesComment: three or more vehicles are handled safely", () => {
  assert.equal(
    formatVehiclePlatesComment(["A-AA 1", "B-BB 2", "C-CC 3"]),
    "Parking vehicles:\n1. A-AA 1\n2. B-BB 2\n3. C-CC 3"
  );
});

test("formatVehiclePlatesComment: a single plate never produces a comment (already covered by the primary field)", () => {
  assert.equal(formatVehiclePlatesComment(["LI-UP 123"]), null);
  assert.equal(formatVehiclePlatesComment([]), null);
  assert.equal(formatVehiclePlatesComment(undefined), null);
});
