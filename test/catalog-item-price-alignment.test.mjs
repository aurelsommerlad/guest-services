// This codebase has no component-rendering test framework (no jsdom, no
// @testing-library/react — components/guest/GuestApp.jsx's JSX also isn't
// importable by plain `node --test` without a transform step), so actual
// pixel-level layout was verified via a live Playwright QA pass instead
// (real `next dev` + Chromium screenshots, temporary and fully reverted
// before commit — see project convention).
//
// These are still real regression guards, not a description of what the
// code does: each assertion reads the actual GuestApp.jsx source and fails
// if the specific structural guarantee it names regresses. Current shape
// (see components/guest/GuestApp.jsx's InstantCatalogItem/
// RequestCatalogItem, and the git history around
// "Correct desktop layout: price anchored far right" for why): on desktop
// the price anchors to the card's FAR RIGHT, grouped with that card's own
// action area (quantity controls, or the request button/form) — never a
// separate column sitting between the content and the action area.
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

test("CatalogItemPriceBlock: a single shared price-block component exists and is used by both card types", () => {
  assert.match(source, /function CatalogItemPriceBlock\(/, "shared price-block component must exist");
  const uses = (source.match(/<CatalogItemPriceBlock/g) || []).length;
  // InstantCatalogItem: 2 (mobile-only title-row occurrence + desktop-only
  // trailing-column occurrence). RequestCatalogItem: 1 (single occurrence,
  // same position/shape at every breakpoint, exactly like before the
  // price-alignment work ever touched this component).
  assert.equal(uses, 3, "expected exactly 3 usages: Instant (2, one per breakpoint) + Request (1, shared)");
});

test("CatalogItemPriceBlock: amount is bold/semibold and the unit label renders directly underneath", () => {
  const block = section("CatalogItemPriceBlock", "InstantCatalogItem");
  assert.match(block, /font-semibold/, "amount must be bold (font-semibold)");
  const amountIdx = block.indexOf("text-lg font-semibold");
  const unitLabelIdx = block.indexOf("unitLabelLine &&");
  assert.ok(amountIdx > -1 && unitLabelIdx > amountIdx, "unit label must be rendered directly after (underneath) the amount");
});

test("InstantCatalogItem (Parkplatz/Zusatzperson/Hund/Babybett/etc.): desktop groups the price with the quantity controls in one right-anchored column, not a separate middle column", () => {
  const block = section("InstantCatalogItem", "RequestCatalogItem");
  // The mobile occurrence (inline with the title) must be hidden at sm+.
  assert.match(
    block,
    /visibilityClassName="sm:hidden"/,
    "the title-row price occurrence must be mobile-only — desktop shows it anchored to the right instead"
  );
  // The desktop occurrence must be hidden below sm, and must sit in the
  // SAME trailing container as the quantity stepper (i.e. after it in
  // source order comes the stepper's onChange handlers), never as its own
  // sibling column between the content block and the controls.
  assert.match(block, /visibilityClassName="hidden sm:block"/, "the far-right price occurrence must be desktop-only");
  const trailingIdx = block.indexOf('visibilityClassName="hidden sm:block"');
  const stepperIdx = block.indexOf("onChange(Math.max(0, count - 1))");
  assert.ok(trailingIdx > -1 && stepperIdx > trailingIdx, "the desktop price occurrence must come before the stepper, inside the same right-anchored container");
  // That shared container must stack price above controls on desktop
  // (sm:flex-col) while staying a plain row on mobile (no sm: prefix on
  // the base direction), and right-anchor both (sm:items-end).
  assert.match(block, /flex flex-shrink-0 items-center justify-end gap-3 sm:flex-col sm:items-end/);
});

test("RequestCatalogItem (Hund/Late Check-out/Early Check-in/etc.): price and the request action share ONE right-anchored column at every breakpoint", () => {
  const block = section("RequestCatalogItem", "// \"Stay one more night\" upsell");
  // Exactly one occurrence, unconditionally visible (no visibilityClassName
  // split) — same column, same shape, mobile and desktop alike.
  assert.doesNotMatch(block, /visibilityClassName/, "RequestCatalogItem must not split the price across breakpoints — one column, always shown");
  // Price must appear before the request button/form in source order,
  // i.e. inside the same trailing sm:w-64 column, above the action.
  const trailingColumnIdx = block.indexOf("sm:w-64 sm:flex-shrink-0");
  const priceIdx = block.indexOf("<CatalogItemPriceBlock");
  const requestButtonIdx = block.indexOf('t(language, "requestButton")');
  assert.ok(trailingColumnIdx > -1, "must have the sm:w-64 trailing action column");
  assert.ok(priceIdx > trailingColumnIdx && priceIdx < requestButtonIdx, "price must sit above the request action, inside the same trailing column");
  // No price block anywhere near the title row (that was the previous,
  // now-corrected "detached middle column" layout).
  const titleRowIdx = block.indexOf("onRequestBadge");
  assert.ok(priceIdx > titleRowIdx, "the price occurrence must not sit inside/immediately after the title row");
});

test("min-w-0 is present on the shrinkable title/description containers next to the price/action area (no overflow-causing rigid layout)", () => {
  assert.match(source, /min-w-0 flex-1[\s\S]{0,40}break-words text-base text-stone-900 sm:text-lg/);
});
