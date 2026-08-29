// This codebase has no component-rendering test framework (no jsdom, no
// @testing-library/react — components/guest/GuestApp.jsx's JSX also isn't
// importable by plain `node --test` without a transform step), so actual
// pixel-level layout was verified via a live Playwright QA pass instead
// (real `next dev` + Chromium screenshots, temporary and fully reverted
// before commit — see project convention).
//
// These are still real regression guards, not a description of what the
// code does: each assertion reads the actual GuestApp.jsx source and fails
// if the specific structural guarantee it names regresses (e.g. someone
// reverting the price column back to an unfixed "auto" desktop width, or a
// card type stopping to share the one CatalogItemPriceBlock component).
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

test("CatalogItemPriceBlock: a single shared price-block component exists and is used by BOTH card types", () => {
  assert.match(source, /function CatalogItemPriceBlock\(/, "shared price-block component must exist");
  const instantUses = (source.match(/<CatalogItemPriceBlock/g) || []).length;
  // InstantCatalogItem (1 use) + RequestCatalogItem (2 uses: desktop-only
  // header occurrence + mobile-only trailing-column occurrence).
  assert.equal(instantUses, 3, "expected exactly 3 usages: Instant (1) + Request (desktop + mobile, 2)");
});

test("CatalogItemPriceBlock: default width is fixed on both mobile and desktop, never 'auto'", () => {
  const match = source.match(/widthClassName = "([^"]+)"/);
  assert.ok(match, "CatalogItemPriceBlock must declare a default widthClassName");
  assert.doesNotMatch(match[1], /w-auto/, "the default width must never be 'auto' — it must stay fixed so the column never reflows per-card");
  assert.match(match[1], /^w-\d/, "must set a concrete fixed width for the mobile breakpoint");
  assert.match(match[1], /sm:w-\d/, "must also set a concrete fixed width for the desktop breakpoint");
});

test("CatalogItemPriceBlock: amount is bold/semibold and the unit label renders directly underneath", () => {
  const block = source.slice(source.indexOf("function CatalogItemPriceBlock"), source.indexOf("function InstantCatalogItem"));
  assert.match(block, /font-semibold/, "amount must be bold (font-semibold)");
  // The unit-label <div> must be a sibling directly after the amount <div>,
  // i.e. rendered directly underneath it — not off to the side.
  const amountIdx = block.indexOf("text-lg font-semibold");
  const unitLabelIdx = block.indexOf("unitLabelLine &&");
  assert.ok(amountIdx > -1 && unitLabelIdx > amountIdx, "unit label must be rendered directly after (underneath) the amount");
});

test("InstantCatalogItem (Parkplatz/Zusatzperson/etc.): price sits in the title row via the shared price block, never a bespoke inline block", () => {
  const block = source.slice(source.indexOf("function InstantCatalogItem"), source.indexOf("function RequestCatalogItem"));
  assert.match(block, /<CatalogItemPriceBlock unitPrice=\{item\.unitPrice\} priceUnitLabel=\{priceUnitLabel\} language=\{language\} \/>/);
});

test("RequestCatalogItem (Hund/etc.): desktop shows the price in the title row (same position as InstantCatalogItem), hidden on mobile", () => {
  const block = source.slice(source.indexOf("function RequestCatalogItem"), source.indexOf('// "Stay one more night" upsell'));
  assert.match(block, /visibilityClassName="hidden sm:block"/, "the header-row (Instant-style) occurrence must be desktop-only");
});

test("RequestCatalogItem: mobile keeps its own original stacked price block (unchanged responsive layout), hidden on desktop", () => {
  const block = source.slice(source.indexOf("function RequestCatalogItem"), source.indexOf('// "Stay one more night" upsell'));
  assert.match(block, /visibilityClassName="sm:hidden"/, "the trailing-column occurrence must be mobile-only now that desktop shows it in the header row instead");
  assert.match(block, /widthClassName="min-w-0"/, "the mobile-only occurrence must keep its original full-width (min-w-0, not the fixed w-24/sm:w-28) shrink behavior");
});

test("min-w-0 is present on the shrinkable title/description containers next to a fixed-width price column (no overflow-causing rigid layout)", () => {
  assert.match(source, /min-w-0 flex-1[\s\S]{0,40}break-words text-base text-stone-900 sm:text-lg/);
});
