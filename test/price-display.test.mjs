// Pure unit tests for lib/priceDisplay.js — dependency-free, so these run
// directly under plain `node --test` without needing a server (unlike
// lib/guest.js / lib/store.js, which transitively import lib/db.js and
// can't be loaded outside Next's bundler in this environment).

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  resolvePriceUnitLabel,
  computePriceBreakdown,
  DEFAULT_PRICE_UNIT_LABELS,
  DEFAULT_PRICE_UNIT_LABELS_EN,
} from "../lib/priceDisplay.js";

test("resolvePriceUnitLabel: custom label wins over the bookingRule default", () => {
  assert.equal(resolvePriceUnitLabel("per_night", "pro Stellplatz / Nacht"), "pro Stellplatz / Nacht");
  assert.equal(resolvePriceUnitLabel("per_stay", "pro Person"), "pro Person");
});

test("resolvePriceUnitLabel: trims whitespace-only custom labels down to the default", () => {
  assert.equal(resolvePriceUnitLabel("per_night", "   "), DEFAULT_PRICE_UNIT_LABELS.per_night);
  assert.equal(resolvePriceUnitLabel("per_night", "  pro Nacht  "), "pro Nacht");
});

test("resolvePriceUnitLabel: fallback labels per bookingRule when unset", () => {
  assert.equal(resolvePriceUnitLabel("per_night", undefined), "pro Nacht");
  assert.equal(resolvePriceUnitLabel("per_stay", ""), "pro Aufenthalt");
  assert.equal(resolvePriceUnitLabel("arrival_day", null), "einmalig");
  assert.equal(resolvePriceUnitLabel("departure_day", ""), "einmalig");
});

test("resolvePriceUnitLabel: unknown bookingRule falls back to empty string, never throws", () => {
  assert.equal(resolvePriceUnitLabel("something_unexpected", ""), "");
});

test("resolvePriceUnitLabel: defaults to German when no language argument is given (backward compatible)", () => {
  assert.equal(resolvePriceUnitLabel("per_night", ""), DEFAULT_PRICE_UNIT_LABELS.per_night);
});

test("resolvePriceUnitLabel: English defaults per bookingRule when unset", () => {
  assert.equal(resolvePriceUnitLabel("per_night", undefined, "en"), "per night");
  assert.equal(resolvePriceUnitLabel("per_stay", "", "en"), "per stay");
  assert.equal(resolvePriceUnitLabel("arrival_day", null, "en"), "one-time");
  assert.equal(resolvePriceUnitLabel("departure_day", "", "en"), "one-time");
  assert.deepEqual(DEFAULT_PRICE_UNIT_LABELS_EN, {
    per_night: "per night",
    per_stay: "per stay",
    arrival_day: "one-time",
    departure_day: "one-time",
    per_person_per_night: "per person / night",
  });
});

test("resolvePriceUnitLabel: per_person_per_night default (actionType increase_occupancy, e.g. 'Extra person')", () => {
  assert.equal(resolvePriceUnitLabel("per_person_per_night", undefined), "pro Person / Nacht");
  assert.equal(resolvePriceUnitLabel("per_person_per_night", undefined, "en"), "per person / night");
});

test("resolvePriceUnitLabel: a custom label wins regardless of requested language", () => {
  assert.equal(resolvePriceUnitLabel("per_night", "pro Stellplatz / Nacht", "en"), "pro Stellplatz / Nacht");
});

test("computePriceBreakdown: quantity 0 shows nothing (no total before selection)", () => {
  const result = computePriceBreakdown({
    unitPrice: { amount: 15, currency: "EUR" },
    nights: 7,
    price: { amount: 105, currency: "EUR" },
    count: 0,
  });
  assert.equal(result, null);
});

test("computePriceBreakdown: single-night, single-unit item shows nothing (unit price already is the total)", () => {
  const result = computePriceBreakdown({
    unitPrice: { amount: 20, currency: "EUR" },
    nights: 1,
    price: { amount: 20, currency: "EUR" },
    count: 1,
  });
  assert.equal(result, null);
});

test("computePriceBreakdown: per-night item, quantity 1, 7-night stay -> unit x nights = total, no count segment", () => {
  const result = computePriceBreakdown({
    unitPrice: { amount: 15, currency: "EUR" },
    nights: 7,
    price: { amount: 105, currency: "EUR" }, // server-computed unit x nights
    count: 1,
  });
  assert.deepEqual(result, {
    unitPrice: { amount: 15, currency: "EUR" },
    nights: 7,
    count: null,
    total: { amount: 105, currency: "EUR" },
  });
});

test("computePriceBreakdown: per-night item, quantity 2, 7-night stay -> unit x nights x count = total", () => {
  const result = computePriceBreakdown({
    unitPrice: { amount: 15, currency: "EUR" },
    nights: 7,
    price: { amount: 105, currency: "EUR" },
    count: 2,
  });
  assert.deepEqual(result, {
    unitPrice: { amount: 15, currency: "EUR" },
    nights: 7,
    count: 2,
    total: { amount: 210, currency: "EUR" }, // 105 * 2, matching the spec's 15 x 7 x 2 = 210 example
  });
});

test("computePriceBreakdown: single-night item, quantity 2 -> unit x count = total, no nights segment", () => {
  const result = computePriceBreakdown({
    unitPrice: { amount: 20, currency: "EUR" },
    nights: 1,
    price: { amount: 20, currency: "EUR" },
    count: 2,
  });
  assert.deepEqual(result, {
    unitPrice: { amount: 20, currency: "EUR" },
    nights: null,
    count: 2,
    total: { amount: 40, currency: "EUR" },
  });
});

test("computePriceBreakdown: rounds to 2 decimals", () => {
  const result = computePriceBreakdown({
    unitPrice: { amount: 12.1, currency: "EUR" },
    nights: 3,
    price: { amount: 36.3, currency: "EUR" },
    count: 3,
  });
  assert.equal(result.total.amount, 108.9);
});

test("computePriceBreakdown: null price (e.g. Apaleo returned no price) yields no breakdown", () => {
  const result = computePriceBreakdown({ unitPrice: null, nights: 4, price: null, count: 2 });
  assert.equal(result, null);
});
