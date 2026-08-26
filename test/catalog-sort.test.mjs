// Pure unit tests for lib/catalogSort.js — the guest-facing extras sort
// order driven by the admin-configurable `sortOrder` field. Dependency-free,
// so these run directly under plain `node --test` without needing a server.

import { test } from "node:test";
import assert from "node:assert/strict";
import { compareBySortOrder } from "../lib/catalogSort.js";

function byName(items) {
  return [...items].sort(compareBySortOrder).map((i) => i.name);
}

test("sorts ascending by sortOrder", () => {
  const items = [
    { name: "Late Check-out", sortOrder: 40 },
    { name: "Car park", sortOrder: 10 },
    { name: "Dog", sortOrder: 20 },
    { name: "Early Check-in", sortOrder: 30 },
    { name: "Baby cot", sortOrder: 50 },
  ];
  assert.deepEqual(byName(items), ["Car park", "Dog", "Early Check-in", "Late Check-out", "Baby cot"]);
});

test("items without sortOrder appear after every item that has one", () => {
  const items = [
    { name: "No order A" },
    { name: "Car park", sortOrder: 10 },
    { name: "No order B" },
    { name: "Dog", sortOrder: 20 },
  ];
  assert.deepEqual(byName(items), ["Car park", "Dog", "No order A", "No order B"]);
});

test("items without sortOrder preserve their original relative order (stable fallback)", () => {
  const items = [{ name: "First" }, { name: "Second" }, { name: "Third" }];
  assert.deepEqual(byName(items), ["First", "Second", "Third"]);
});

test("a null or non-numeric sortOrder is treated the same as missing", () => {
  const items = [
    { name: "Null order", sortOrder: null },
    { name: "Car park", sortOrder: 10 },
    { name: "String order", sortOrder: "not-a-number" },
  ];
  assert.deepEqual(byName(items), ["Car park", "Null order", "String order"]);
});

test("ties on an explicit sortOrder preserve original relative order", () => {
  const items = [
    { name: "First at 10", sortOrder: 10 },
    { name: "Second at 10", sortOrder: 10 },
  ];
  assert.deepEqual(byName(items), ["First at 10", "Second at 10"]);
});
