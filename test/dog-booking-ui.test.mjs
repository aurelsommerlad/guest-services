// This codebase has no component-rendering test framework (no jsdom, no
// @testing-library/react — see test/catalog-item-price-alignment.test.mjs's
// header for why), so this is a source-level regression guard for the
// guest-facing "maximum 1 dog per reservation" UI requirement rather than a
// real render test: the "+" control must never offer quantity > 1 for a
// maxOnePerReservation item, and an already-booked one must show
// "Bereits gebucht" instead of an active control. Actual rendered behavior
// was verified via a live Playwright QA pass (see the project's established
// convention for this).
//
// Run with: npm test

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";

const SOURCE_PATH = path.join(process.cwd(), "components", "guest", "GuestApp.jsx");
let source;

test.before(async () => {
  source = await readFile(SOURCE_PATH, "utf8");
});

function section(name, nextName) {
  return source.slice(source.indexOf(`function ${name}`), source.indexOf(`function ${nextName}`));
}

test("InstantCatalogItem: reads item.alreadyBooked and never shows an active '+' control in that state", () => {
  const block = section("InstantCatalogItem", "RequestCatalogItem");
  assert.match(block, /const alreadyBooked = Boolean\(item\.alreadyBooked\)/);
  // The stepper (with its "+" button) must be gated on NOT alreadyBooked —
  // i.e. only rendered in the branch that excludes it.
  const badgeIdx = block.indexOf('t(language, "alreadyBookedBadge")');
  const plusButtonIdx = block.indexOf('t(language, "increaseQuantity")');
  assert.ok(badgeIdx > -1, "must render the already-booked badge somewhere");
  assert.ok(plusButtonIdx > badgeIdx, "the '+' control must be defined in a separate branch from the badge (alreadyBooked ? badge : stepper)");
});

test("InstantCatalogItem: the '+' button is disabled once quantity reaches item.maxQuantity (capped at 1 for a maxOnePerReservation item)", () => {
  const block = section("InstantCatalogItem", "RequestCatalogItem");
  assert.match(block, /atMaxQuantity = Number\.isFinite\(item\.maxQuantity\) && count >= item\.maxQuantity/);
  assert.match(block, /disabled=\{restricted \|\| atMaxQuantity\}/, "the '+' button must be disabled once atMaxQuantity");
});

test("InstantCatalogItem: shows the max-one-dog explanation text when already booked, distinct from the unit-group-restricted message", () => {
  const block = section("InstantCatalogItem", "RequestCatalogItem");
  assert.match(block, /alreadyBooked \? \(\s*<p[^>]*>\{t\(language, "maxOneDogExplanation"\)\}/);
});

test("RequestCatalogItem: also reads item.alreadyBooked and shows the badge instead of the request action", () => {
  const block = section("RequestCatalogItem", '// "Stay one more night" upsell');
  assert.match(block, /const alreadyBooked = Boolean\(item\.alreadyBooked\)/);
  assert.match(block, /alreadyBooked \? \(/, "must have a dedicated alreadyBooked branch");
  const badgeIdx = block.indexOf('t(language, "alreadyBookedBadge")');
  assert.ok(badgeIdx > -1, "must render the already-booked badge");
});

test("i18n: alreadyBookedBadge / maxOneDogExplanation / dogLimitExceededError exist in both de and en", async () => {
  const { t } = await import("../lib/i18n.js");
  assert.equal(t("de", "alreadyBookedBadge"), "Bereits gebucht");
  assert.equal(t("en", "alreadyBookedBadge"), "Already booked");
  assert.equal(t("de", "maxOneDogExplanation"), "Pro Apartment ist maximal ein Hund möglich.");
  assert.equal(t("en", "maxOneDogExplanation"), "Maximum one dog per apartment.");
  assert.equal(
    t("de", "dogLimitExceededError"),
    "Für dieses Apartment ist bereits ein Hund gebucht. Pro Apartment ist maximal ein Hund möglich."
  );
  assert.equal(
    t("en", "dogLimitExceededError"),
    "A dog is already booked for this apartment. A maximum of one dog is allowed per apartment."
  );
});
