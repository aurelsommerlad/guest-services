// Pure unit tests for lib/unitGroupRestriction.js — the allow/deny decision
// behind restricting a catalog extra (e.g. "Dog") to specific Apaleo unit
// groups / apartment types. Dependency-free, so these run directly under
// plain `node --test` without needing a server or live Apaleo access.
//
// isUnitGroupAllowed() is the single gate consumed identically by the
// instant-booking path (lib/guest.js's placeGuestOrder), the request-only
// path (app/api/guest/request), and the admin approval re-check
// (lib/requests.js's approveRequest) — it has no notion of fulfillmentMode
// at all, which is exactly what makes "the same restriction applies to
// request-only extras" true by construction rather than by a second,
// separately-maintained check.

import { test } from "node:test";
import assert from "node:assert/strict";
import { getReservationUnitGroupId, isUnitGroupAllowed } from "../lib/unitGroupRestriction.js";

test("isUnitGroupAllowed: no restriction configured (undefined) allows every unit group", () => {
  assert.equal(isUnitGroupAllowed(undefined, "LAEKE-AP_L"), true);
  assert.equal(isUnitGroupAllowed(undefined, null), true);
});

test("isUnitGroupAllowed: no restriction configured (empty array) allows every unit group", () => {
  assert.equal(isUnitGroupAllowed([], "LAEKE-AP_L"), true);
});

test("isUnitGroupAllowed: the reservation's unit group is in the allowed list", () => {
  assert.equal(isUnitGroupAllowed(["LAEKE-L-GARDEN", "LAEKE-XL-GARDEN"], "LAEKE-L-GARDEN"), true);
});

test("isUnitGroupAllowed: the reservation's unit group is NOT in the allowed list", () => {
  assert.equal(isUnitGroupAllowed(["LAEKE-L-GARDEN", "LAEKE-XL-GARDEN"], "LAEKE-AP_L"), false);
});

test("isUnitGroupAllowed: missing unit-group data on the reservation fails closed when restricted", () => {
  assert.equal(isUnitGroupAllowed(["LAEKE-L-GARDEN"], null), false);
  assert.equal(isUnitGroupAllowed(["LAEKE-L-GARDEN"], undefined), false);
});

test("isUnitGroupAllowed: missing unit-group data never matters when the item is unrestricted", () => {
  assert.equal(isUnitGroupAllowed([], null), true);
  assert.equal(isUnitGroupAllowed(undefined, undefined), true);
});

test("getReservationUnitGroupId: reads the embedded unitGroup.id (verified live Apaleo shape)", () => {
  const reservation = { unitGroup: { id: "LAEKE-AP_L", code: "AP_L" }, unit: { unitGroupId: "LAEKE-AP_L" } };
  assert.equal(getReservationUnitGroupId(reservation), "LAEKE-AP_L");
});

test("getReservationUnitGroupId: falls back to unit.unitGroupId when unitGroup is absent", () => {
  const reservation = { unit: { id: "LAEKE-NEE", unitGroupId: "LAEKE-AP_L" } };
  assert.equal(getReservationUnitGroupId(reservation), "LAEKE-AP_L");
});

test("getReservationUnitGroupId: returns null when neither field is present", () => {
  assert.equal(getReservationUnitGroupId({}), null);
  assert.equal(getReservationUnitGroupId(null), null);
  assert.equal(getReservationUnitGroupId(undefined), null);
});

test("end-to-end: a restricted reservation with no unit-group data is blocked, same as an explicitly wrong type", () => {
  const allowedUnitGroupIds = ["LAEKE-L-GARDEN", "LAEKE-XL-GARDEN"];
  const reservationMissingData = {};
  const reservationWrongType = { unitGroup: { id: "LAEKE-AP_L" } };
  const reservationRightType = { unitGroup: { id: "LAEKE-L-GARDEN" } };

  assert.equal(isUnitGroupAllowed(allowedUnitGroupIds, getReservationUnitGroupId(reservationMissingData)), false);
  assert.equal(isUnitGroupAllowed(allowedUnitGroupIds, getReservationUnitGroupId(reservationWrongType)), false);
  assert.equal(isUnitGroupAllowed(allowedUnitGroupIds, getReservationUnitGroupId(reservationRightType)), true);
});
