// Pure unit tests for lib/reservationMatching.js — the last-name matching
// and OTA-reference ambiguity rules behind the extended guest lookup.
// Dependency-free, so these run directly under plain `node --test` without
// needing a server or live Apaleo access.

import { test } from "node:test";
import assert from "node:assert/strict";
import { namesMatch, resolveExternalReferenceMatches } from "../lib/reservationMatching.js";

function reservation(lastName) {
  return { primaryGuest: { lastName } };
}

test("namesMatch: matches regardless of case and diacritics", () => {
  assert.equal(namesMatch(reservation("Müller"), "muller"), true);
  assert.equal(namesMatch(reservation("Müller"), "MÜLLER"), true);
  assert.equal(namesMatch(reservation("Kronenberger"), "kronenberger"), true);
});

test("namesMatch: a wrong surname never matches", () => {
  assert.equal(namesMatch(reservation("Kronenberger"), "Schmidt"), false);
});

test("namesMatch: an empty/missing surname never matches (no accidental wildcard)", () => {
  assert.equal(namesMatch(reservation("Kronenberger"), ""), false);
  assert.equal(namesMatch(reservation("Kronenberger"), undefined), false);
  assert.equal(namesMatch({}, "Kronenberger"), false);
});

test("resolveExternalReferenceMatches: a single reservation matching an OTA reference + surname resolves unambiguously", () => {
  const result = resolveExternalReferenceMatches([reservation("Thomas")], "Thomas");
  assert.equal(result.ambiguous, false);
  assert.equal(result.reservations.length, 1);
});

test("resolveExternalReferenceMatches: no match at all is not ambiguous, just empty (falls through to the generic lookup error)", () => {
  const result = resolveExternalReferenceMatches([reservation("Thomas")], "Schmidt");
  assert.equal(result.ambiguous, false);
  assert.deepEqual(result.reservations, []);
});

test("resolveExternalReferenceMatches: two different reservations matching the same reference AND surname are ambiguous", () => {
  const result = resolveExternalReferenceMatches(
    [reservation("Kronenberger"), reservation("Kronenberger")],
    "Kronenberger"
  );
  assert.equal(result.ambiguous, true);
  assert.deepEqual(result.reservations, [], "no reservation data is returned on the ambiguous path");
});

test("resolveExternalReferenceMatches: surname filtering happens before the ambiguity check — one wrong-name match never blocks the real one", () => {
  const result = resolveExternalReferenceMatches(
    [reservation("Kronenberger"), reservation("SomeoneElse")],
    "Kronenberger"
  );
  assert.equal(result.ambiguous, false);
  assert.equal(result.reservations.length, 1);
});

test("resolveExternalReferenceMatches: an empty candidate list is never ambiguous", () => {
  const result = resolveExternalReferenceMatches([], "Kronenberger");
  assert.equal(result.ambiguous, false);
  assert.deepEqual(result.reservations, []);
});

test("resolveExternalReferenceMatches: handles a null/undefined candidate list gracefully", () => {
  const result = resolveExternalReferenceMatches(undefined, "Kronenberger");
  assert.equal(result.ambiguous, false);
  assert.deepEqual(result.reservations, []);
});
