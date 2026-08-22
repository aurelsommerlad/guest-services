// Pure unit tests for lib/catalogLocalization.js — the exact priority logic
// behind the guest-facing bilingual catalog fields, and the fix for extras
// showing an English name/description to German guests (e.g. LAEKE-PKW's
// "Car park"). Dependency-free, so these run directly under plain
// `node --test` without needing a server or live Apaleo access.

import { test } from "node:test";
import assert from "node:assert/strict";
import { resolveBilingualText, resolveBilingualPriceUnitLabel } from "../lib/catalogLocalization.js";
import { resolvePriceUnitLabel } from "../lib/priceDisplay.js";

test("German Apaleo value is shown when available (the Car park / Parkplatz case)", () => {
  const result = resolveBilingualText({
    overrideDe: undefined,
    overrideEn: undefined,
    apaleoDe: "Parkplatz",
    apaleoEn: "Car park",
    genericFallback: "Car park", // the stale, never-translated catalog field that caused the bug
    finalFallback: "LAEKE-PKW",
  });
  assert.equal(result.de, "Parkplatz");
  assert.equal(result.en, "Car park");
});

test("English Apaleo value is shown when available", () => {
  const result = resolveBilingualText({
    apaleoDe: "Frühstück",
    apaleoEn: "Breakfast",
    genericFallback: "",
    finalFallback: "",
  });
  assert.equal(result.en, "Breakfast");
  assert.equal(result.de, "Frühstück");
});

test("a curated per-language override wins over Apaleo's own localized value", () => {
  const result = resolveBilingualText({
    overrideDe: "Unser Parkplatz",
    overrideEn: undefined,
    apaleoDe: "Parkplatz",
    apaleoEn: "Car park",
    genericFallback: "",
    finalFallback: "",
  });
  assert.equal(result.de, "Unser Parkplatz", "the DE override must win over the Apaleo DE value");
  assert.equal(result.en, "Car park", "no EN override was set, so Apaleo's EN value still applies");
});

test("fallback logic: missing translation in the requested language falls back to the other Apaleo language", () => {
  const result = resolveBilingualText({
    apaleoDe: undefined, // Apaleo has no German string for this service at all
    apaleoEn: "Late check-out",
    genericFallback: "",
    finalFallback: "",
  });
  assert.equal(result.de, "Late check-out", "falls back to the English Apaleo value rather than showing nothing");
  assert.equal(result.en, "Late check-out");
});

test("fallback logic: no Apaleo data at all falls back to the existing generic catalog field", () => {
  const result = resolveBilingualText({
    apaleoDe: undefined,
    apaleoEn: undefined,
    genericFallback: "Frühstücksbuffet",
    finalFallback: "BREAKFAST",
  });
  assert.equal(result.de, "Frühstücksbuffet");
  assert.equal(result.en, "Frühstücksbuffet");
});

test("existing catalog entries without any localized fields still work (nothing at all -> final fallback)", () => {
  const result = resolveBilingualText({
    overrideDe: undefined,
    overrideEn: undefined,
    apaleoDe: undefined,
    apaleoEn: undefined,
    genericFallback: undefined,
    finalFallback: "LAEKE-PKW",
  });
  assert.equal(result.de, "LAEKE-PKW");
  assert.equal(result.en, "LAEKE-PKW");
});

test("description has no final-fallback requirement — empty stays empty when nothing is available", () => {
  const result = resolveBilingualText({
    apaleoDe: undefined,
    apaleoEn: undefined,
    genericFallback: "",
    finalFallback: "",
  });
  assert.equal(result.de, "");
  assert.equal(result.en, "");
});

test("whitespace-only overrides/values are treated as absent, not used verbatim", () => {
  const result = resolveBilingualText({
    overrideDe: "   ",
    apaleoDe: "Parkplatz",
    apaleoEn: "Car park",
    genericFallback: "",
    finalFallback: "",
  });
  assert.equal(result.de, "Parkplatz", "a whitespace-only override must not win over a real Apaleo value");
});

test("price unit labels: a per-language override wins", () => {
  const result = resolveBilingualPriceUnitLabel({
    overrideDe: "pro Stellplatz / Nacht",
    overrideEn: "per parking space / night",
    genericPriceUnitLabel: "",
    bookingRule: "per_night",
    resolvePriceUnitLabel,
  });
  assert.equal(result.de, "pro Stellplatz / Nacht");
  assert.equal(result.en, "per parking space / night");
});

test("price unit labels: falls back to the existing generic priceUnitLabel field for both languages", () => {
  const result = resolveBilingualPriceUnitLabel({
    overrideDe: undefined,
    overrideEn: undefined,
    genericPriceUnitLabel: "pro Stellplatz / Nacht",
    bookingRule: "per_night",
    resolvePriceUnitLabel,
  });
  assert.equal(result.de, "pro Stellplatz / Nacht");
  assert.equal(result.en, "pro Stellplatz / Nacht", "the generic field is used verbatim regardless of language");
});

test("price unit labels: falls back to the bookingRule-based translated default per language", () => {
  const result = resolveBilingualPriceUnitLabel({
    overrideDe: undefined,
    overrideEn: undefined,
    genericPriceUnitLabel: "",
    bookingRule: "per_night",
    resolvePriceUnitLabel,
  });
  assert.equal(result.de, "pro Nacht");
  assert.equal(result.en, "per night");
});

test("price unit labels switch correctly across bookingRules and languages", () => {
  const cases = [
    ["per_stay", "pro Aufenthalt", "per stay"],
    ["arrival_day", "einmalig", "one-time"],
    ["departure_day", "einmalig", "one-time"],
  ];
  for (const [bookingRule, de, en] of cases) {
    const result = resolveBilingualPriceUnitLabel({
      genericPriceUnitLabel: "",
      bookingRule,
      resolvePriceUnitLabel,
    });
    assert.equal(result.de, de, `de default for ${bookingRule}`);
    assert.equal(result.en, en, `en default for ${bookingRule}`);
  }
});
