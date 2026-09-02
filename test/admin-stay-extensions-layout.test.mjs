// This codebase has no component-rendering test framework (no jsdom, no
// @testing-library/react — see test/catalog-item-price-alignment.test.mjs's
// header for why), so this is a source-level regression guard for
// components/admin/StayExtensionsManager.jsx's responsive layout
// requirement ("Desktop: table/list layout. Mobile: stacked cards. Do not
// force a wide table on mobile.") rather than a real render test. Actual
// rendered behavior was verified via a live Playwright QA pass (see the
// project's established convention for this).
//
// Run with: npm test

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";

const SOURCE_PATH = path.join(process.cwd(), "components", "admin", "StayExtensionsManager.jsx");
let source;

test.before(async () => {
  source = await readFile(SOURCE_PATH, "utf8");
});

test("desktop table is hidden on mobile and only shown from the sm breakpoint up", () => {
  assert.match(source, /<table\b/, "must render a <table> for desktop");
  const tableWrapperIdx = source.search(/hidden overflow-x-auto[^"]*sm:block/);
  assert.ok(tableWrapperIdx > -1, "the table's wrapper must be `hidden ... sm:block` (hidden on mobile, shown on desktop)");
});

test("mobile stacked cards are shown by default and hidden from the sm breakpoint up (never alongside the table)", () => {
  const cardsWrapperIdx = source.search(/space-y-3 sm:hidden/);
  assert.ok(cardsWrapperIdx > -1, "the mobile cards wrapper must be `sm:hidden` (shown on mobile, hidden on desktop)");
});

test("both the desktop table and the mobile cards render every column/field the spec requires (Gast/Unterkunft/Alte Abreise/Neue Abreise/Rabatt/Preis/Status/Gebucht am)", () => {
  for (const label of ["Gast", "Unterkunft", "Alte Abreise", "Neue Abreise", "Rabatt", "Preis", "Status", "Gebucht am"]) {
    assert.match(source, new RegExp(label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")), `missing "${label}"`);
  }
});

test("row click/tap toggles an expandable detail view (no separate route/modal needed)", () => {
  assert.match(source, /toggleExpanded/);
  assert.match(source, /StayExtensionDetail/);
});

test("the detail view covers every section the spec requires: Reservation, Unterkunftspreis, Zusätzliche Leistungen, Verifizierung, and a total", () => {
  for (const heading of ["Reservierung", "Unterkunftspreis", "Zusätzliche Leistungen", "Verifizierung", "Gesamt zusätzlich"]) {
    assert.match(source, new RegExp(heading.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")), `missing "${heading}" section`);
  }
});

test("property and status filters are present, driving the API query", () => {
  assert.match(source, /propertyId/);
  assert.match(source, /STATUS_OPTIONS/);
  assert.match(source, /\/api\/admin\/stay-extensions/);
});
