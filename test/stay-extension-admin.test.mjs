// Tests for lib/stayExtensionAdmin.js — the presentation-layer logic
// behind the Admin "Verlängerungsnächte" view
// (app/api/admin/stay-extensions/route.js /
// components/admin/StayExtensionsManager.jsx). Pure/dependency-free, run
// directly with plain `node --test`, no live Apaleo/KV access needed.
//
// The HVQSVNWL-1 fixture below is the actual production audit record
// reported for that reservation (see lib/guest.js's confirmStayExtension —
// written before propertyId/phase/gap/totalAdditionalAmount existed), used
// throughout as the canonical "real legacy record" acceptance case.
//
// Run with: npm test

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  normalizeExtensionStatus,
  getExtensionStatusLabel,
  computeDisplayTotal,
  buildStayExtensionAdminRow,
  sortStayExtensionRows,
  filterStayExtensionRows,
} from "../lib/stayExtensionAdmin.js";

const HVQSVNWL_1_RECORD = {
  id: "e9bcfb84-5643-4895-b53f-bbd9cd3148da",
  reservationId: "HVQSVNWL-1",
  oldDeparture: "2026-09-02",
  newDeparture: "2026-09-03",
  newDepartureConfirmed: true,
  originalAverageNightlyRate: { amount: 174.23, currency: "EUR" },
  discountPercent: 15,
  extensionPrice: { amount: 148.1, currency: "EUR" },
  extras: [],
  lateCheckoutMoves: [],
  cityTax: { applicable: false, verified: null, amount: null },
  mandatoryServicesIntact: true,
  createdAt: "2026-09-01T13:43:47.117Z",
  status: "confirmed",
  // No propertyId/phase/gap/totalAdditionalAmount — this record predates
  // all four.
};

test("normalizeExtensionStatus / getExtensionStatusLabel: confirmed -> Gebucht", () => {
  assert.equal(normalizeExtensionStatus("confirmed"), "confirmed");
  assert.equal(getExtensionStatusLabel("confirmed"), "Gebucht");
});

test("normalizeExtensionStatus / getExtensionStatusLabel: the actual stored 'confirmed_with_issues' -> partial -> Teilweise abgeschlossen", () => {
  assert.equal(normalizeExtensionStatus("confirmed_with_issues"), "partial");
  assert.equal(getExtensionStatusLabel("confirmed_with_issues"), "Teilweise abgeschlossen");
});

test("normalizeExtensionStatus / getExtensionStatusLabel: 'partial' -> Teilweise abgeschlossen", () => {
  assert.equal(normalizeExtensionStatus("partial"), "partial");
  assert.equal(getExtensionStatusLabel("partial"), "Teilweise abgeschlossen");
});

test("normalizeExtensionStatus / getExtensionStatusLabel: 'failed' -> Fehlgeschlagen", () => {
  assert.equal(normalizeExtensionStatus("failed"), "failed");
  assert.equal(getExtensionStatusLabel("failed"), "Fehlgeschlagen");
});

test("normalizeExtensionStatus: an unrecognized/unexpected stored value renders safely rather than crashing", () => {
  assert.equal(normalizeExtensionStatus("some-future-status-nobody-invented-yet"), "unknown");
  assert.equal(normalizeExtensionStatus(undefined), "unknown");
  assert.equal(normalizeExtensionStatus(null), "unknown");
  assert.equal(getExtensionStatusLabel(undefined), "Unbekannt");
});

test("computeDisplayTotal: HVQSVNWL-1's exact shape (empty extras, cityTax.applicable=false, no stored totalAdditionalAmount) -> 148.10 €", () => {
  const total = computeDisplayTotal(HVQSVNWL_1_RECORD);
  assert.deepEqual(total, { amount: 148.1, currency: "EUR" });
});

test("computeDisplayTotal: a future record's own stored totalAdditionalAmount is used as-is, not recomputed", () => {
  const total = computeDisplayTotal({
    extensionPrice: { amount: 100, currency: "EUR" },
    extras: [],
    cityTax: null,
    totalAdditionalAmount: { amount: 999, currency: "EUR" },
  });
  assert.deepEqual(total, { amount: 999, currency: "EUR" });
});

test("computeDisplayTotal: incomplete legacy data (an extended extra with no amount, no stored total) -> null, not a guess", () => {
  const total = computeDisplayTotal({
    extensionPrice: { amount: 100, currency: "EUR" },
    extras: [{ serviceId: "DOG", extended: true }],
    cityTax: null,
  });
  assert.equal(total, null);
});

test("buildStayExtensionAdminRow: HVQSVNWL-1 renders safely with all recoverable fields present and legacy fields as null/'-' ", () => {
  const row = buildStayExtensionAdminRow(HVQSVNWL_1_RECORD, {
    guestName: "Björn Heng",
    propertyName: "HØV by UNIQUE PLACES",
    propertyId: "ALTUS",
    unitName: "FUX No. 6",
  });
  assert.equal(row.reservationId, "HVQSVNWL-1");
  assert.equal(row.guestName, "Björn Heng");
  assert.equal(row.propertyName, "HØV by UNIQUE PLACES");
  assert.equal(row.unitName, "FUX No. 6");
  // propertyId isn't on the stored record itself -> falls back to the
  // Apaleo-enriched value rather than being lost.
  assert.equal(row.propertyId, "ALTUS");
  assert.equal(row.oldDeparture, "2026-09-02");
  assert.equal(row.newDeparture, "2026-09-03");
  assert.equal(row.discountPercent, 15);
  assert.deepEqual(row.extensionPrice, { amount: 148.1, currency: "EUR" });
  assert.deepEqual(row.totalAdditionalAmount, { amount: 148.1, currency: "EUR" });
  assert.equal(row.status, "confirmed");
  assert.equal(row.statusLabel, "Gebucht");
  assert.deepEqual(row.extras, []);
  assert.equal(row.cityTax.applicable, false);
  // Fields this record genuinely predates — must be explicit null, never
  // invented or crashing the row assembly.
  assert.equal(row.phase, null);
  assert.equal(row.gap, null);
  assert.equal(row.source, "audit");
});

test("buildStayExtensionAdminRow: a record with no reservation found at all (Apaleo lookup failed) still renders, enrichment falls back to '-'", () => {
  const row = buildStayExtensionAdminRow(HVQSVNWL_1_RECORD, {});
  assert.equal(row.guestName, "-");
  assert.equal(row.propertyName, "-");
  assert.equal(row.unitName, "-");
  assert.equal(row.propertyId, null);
  // The audit-sourced fields are completely unaffected by a missing
  // enrichment.
  assert.equal(row.reservationId, "HVQSVNWL-1");
  assert.deepEqual(row.extensionPrice, { amount: 148.1, currency: "EUR" });
});

test("buildStayExtensionAdminRow: a fully populated future record exposes propertyId/phase/gap directly from the record", () => {
  const row = buildStayExtensionAdminRow(
    {
      ...HVQSVNWL_1_RECORD,
      id: "future-record-1",
      reservationId: "FUTURE-1",
      propertyId: "ALTUS",
      phase: "in_house",
      gap: 3,
      totalAdditionalAmount: { amount: 148.1, currency: "EUR" },
      status: "confirmed",
    },
    { guestName: "Test Guest", propertyName: "ALTUS Property", propertyId: "ALTUS", unitName: "Unit 1" }
  );
  assert.equal(row.propertyId, "ALTUS");
  assert.equal(row.phase, "in_house");
  assert.equal(row.gap, 3);
});

test("buildStayExtensionAdminRow: an almost-empty record (only reservationId/status) never throws", () => {
  assert.doesNotThrow(() => buildStayExtensionAdminRow({ reservationId: "MINIMAL-1", status: "confirmed" }));
  const row = buildStayExtensionAdminRow({ reservationId: "MINIMAL-1", status: "confirmed" });
  assert.equal(row.oldDeparture, null);
  assert.equal(row.newDeparture, null);
  assert.equal(row.extensionPrice, null);
  assert.equal(row.totalAdditionalAmount, null);
  assert.equal(row.discountPercent, null);
});

test("buildStayExtensionAdminRow: called with no record at all never throws", () => {
  assert.doesNotThrow(() => buildStayExtensionAdminRow(undefined));
  assert.doesNotThrow(() => buildStayExtensionAdminRow(null));
});

test("sortStayExtensionRows: newest createdAt first", () => {
  const rows = [
    { id: "a", createdAt: "2026-01-01T00:00:00.000Z" },
    { id: "b", createdAt: "2026-09-01T13:43:47.117Z" },
    { id: "c", createdAt: "2026-05-01T00:00:00.000Z" },
  ];
  const sorted = sortStayExtensionRows(rows);
  assert.deepEqual(
    sorted.map((r) => r.id),
    ["b", "c", "a"]
  );
});

test("sortStayExtensionRows: a row with a missing/invalid createdAt sorts last, never throws", () => {
  const rows = [
    { id: "no-date" },
    { id: "valid", createdAt: "2026-09-01T13:43:47.117Z" },
    { id: "invalid-date", createdAt: "not-a-date" },
  ];
  assert.doesNotThrow(() => sortStayExtensionRows(rows));
  const sorted = sortStayExtensionRows(rows);
  assert.equal(sorted[0].id, "valid");
});

test("filterStayExtensionRows: filters by propertyId", () => {
  const rows = [
    { id: "a", propertyId: "ALTUS", status: "confirmed" },
    { id: "b", propertyId: "OTHERPROP", status: "confirmed" },
  ];
  const filtered = filterStayExtensionRows(rows, { propertyId: "ALTUS" });
  assert.deepEqual(
    filtered.map((r) => r.id),
    ["a"]
  );
});

test("filterStayExtensionRows: filters by status (matching the NORMALIZED status, e.g. legacy confirmed_with_issues rows match 'partial')", () => {
  const rows = [
    buildStayExtensionAdminRow({ reservationId: "A", status: "confirmed" }),
    buildStayExtensionAdminRow({ reservationId: "B", status: "confirmed_with_issues" }),
    buildStayExtensionAdminRow({ reservationId: "C", status: "failed" }),
  ];
  const partial = filterStayExtensionRows(rows, { status: "partial" });
  assert.deepEqual(
    partial.map((r) => r.reservationId),
    ["B"]
  );
});

test("filterStayExtensionRows: no filters returns everything unchanged", () => {
  const rows = [
    { id: "a", propertyId: "ALTUS", status: "confirmed" },
    { id: "b", propertyId: "OTHERPROP", status: "failed" },
  ];
  assert.deepEqual(filterStayExtensionRows(rows, {}), rows);
  assert.deepEqual(filterStayExtensionRows(rows), rows);
});

test("filterStayExtensionRows: both filters combined", () => {
  const rows = [
    { id: "a", propertyId: "ALTUS", status: "confirmed" },
    { id: "b", propertyId: "ALTUS", status: "failed" },
    { id: "c", propertyId: "OTHERPROP", status: "confirmed" },
  ];
  const filtered = filterStayExtensionRows(rows, { propertyId: "ALTUS", status: "confirmed" });
  assert.deepEqual(
    filtered.map((r) => r.id),
    ["a"]
  );
});
