// Tests for the stay-extension config's phase-specific discount fields
// (lib/store.js's getExtensionConfig/saveExtensionConfig) and the
// backward-compatible migration fallback for properties whose Redis record
// predates this change (only ever had the flat extensionDiscountOneNightGap/
// extensionDiscountStandard fields). Run with: npm test

import { test } from "node:test";
import assert from "node:assert/strict";
import { rm } from "node:fs/promises";
import path from "node:path";
import { getExtensionConfig, saveExtensionConfig } from "../lib/store.js";
import { setJSON } from "../lib/db.js";

const DATA_DIR = path.join(process.cwd(), ".data");

async function withCleanLocalDb(fn) {
  await rm(DATA_DIR, { recursive: true, force: true });
  try {
    await fn();
  } finally {
    await rm(DATA_DIR, { recursive: true, force: true });
  }
}

test("getExtensionConfig: a property with nothing stored at all gets the documented example defaults for both phases", async () => {
  await withCleanLocalDb(async () => {
    const config = await getExtensionConfig("NEWPROP");
    assert.equal(config.extensionNightEnabled, false);
    assert.equal(config.extensionDiscountPreArrivalOneNightGap, 15);
    assert.equal(config.extensionDiscountPreArrivalStandard, 10);
    assert.equal(config.extensionDiscountInHouseOneNightGap, 20);
    assert.equal(config.extensionDiscountInHouseStandard, 15);
    assert.equal(config.minSellableStayNights, 2);
  });
});

test("getExtensionConfig: old stored config (only the flat legacy fields, no phase-specific fields yet) still works via fallback for BOTH phases", async () => {
  await withCleanLocalDb(async () => {
    // Exactly the shape a pre-migration production property already has in
    // Redis — no extensionDiscountPreArrival*/extensionDiscountInHouse*
    // keys at all yet.
    await setJSON("extension-night:config:LEGACYPROP", {
      extensionNightEnabled: true,
      extensionDiscountOneNightGap: 25,
      extensionDiscountStandard: 12,
      minSellableStayNights: 3,
    });

    const config = await getExtensionConfig("LEGACYPROP");
    assert.equal(config.extensionNightEnabled, true);
    assert.equal(config.minSellableStayNights, 3);
    // Both phases fall back to the same legacy numbers until the property
    // explicitly saves the new phase-specific fields.
    assert.equal(config.extensionDiscountPreArrivalOneNightGap, 25);
    assert.equal(config.extensionDiscountPreArrivalStandard, 12);
    assert.equal(config.extensionDiscountInHouseOneNightGap, 25);
    assert.equal(config.extensionDiscountInHouseStandard, 12);
  });
});

test("getExtensionConfig: once the phase-specific fields are explicitly saved, they take priority over the legacy fields", async () => {
  await withCleanLocalDb(async () => {
    // A legacy-shaped record, as if a property had it stored before this
    // migration, that a later save only partially overrides (still leaves
    // the legacy fields sitting alongside, exactly like a real Redis hash
    // written before vs. after this change).
    await setJSON("extension-night:config:MIGRATEDPROP", {
      extensionNightEnabled: true,
      extensionDiscountOneNightGap: 25,
      extensionDiscountStandard: 12,
      extensionDiscountPreArrivalOneNightGap: 15,
      extensionDiscountPreArrivalStandard: 10,
      extensionDiscountInHouseOneNightGap: 20,
      extensionDiscountInHouseStandard: 15,
      minSellableStayNights: 2,
    });

    const config = await getExtensionConfig("MIGRATEDPROP");
    // New fields win, NOT the legacy 25/12 that's still sitting there.
    assert.equal(config.extensionDiscountPreArrivalOneNightGap, 15);
    assert.equal(config.extensionDiscountPreArrivalStandard, 10);
    assert.equal(config.extensionDiscountInHouseOneNightGap, 20);
    assert.equal(config.extensionDiscountInHouseStandard, 15);
  });
});

test("getExtensionConfig: a partially-migrated property (only pre-arrival explicitly saved) falls back to legacy for in-house only", async () => {
  await withCleanLocalDb(async () => {
    await setJSON("extension-night:config:PARTIALPROP", {
      extensionNightEnabled: true,
      extensionDiscountOneNightGap: 25,
      extensionDiscountStandard: 12,
      extensionDiscountPreArrivalOneNightGap: 15,
      extensionDiscountPreArrivalStandard: 10,
      minSellableStayNights: 2,
    });

    const config = await getExtensionConfig("PARTIALPROP");
    assert.equal(config.extensionDiscountPreArrivalOneNightGap, 15);
    assert.equal(config.extensionDiscountPreArrivalStandard, 10);
    // In-house fields were never explicitly saved -> still the legacy values.
    assert.equal(config.extensionDiscountInHouseOneNightGap, 25);
    assert.equal(config.extensionDiscountInHouseStandard, 12);
  });
});

test("saveExtensionConfig / getExtensionConfig: admin save-then-read round-trip for all four phase-specific discount fields", async () => {
  await withCleanLocalDb(async () => {
    const saved = await saveExtensionConfig("ROUNDTRIPPROP", {
      extensionNightEnabled: true,
      extensionDiscountPreArrivalOneNightGap: 18,
      extensionDiscountPreArrivalStandard: 9,
      extensionDiscountInHouseOneNightGap: 22,
      extensionDiscountInHouseStandard: 14,
      minSellableStayNights: 4,
    });
    assert.equal(saved.extensionDiscountPreArrivalOneNightGap, 18);
    assert.equal(saved.extensionDiscountPreArrivalStandard, 9);
    assert.equal(saved.extensionDiscountInHouseOneNightGap, 22);
    assert.equal(saved.extensionDiscountInHouseStandard, 14);

    const reloaded = await getExtensionConfig("ROUNDTRIPPROP");
    assert.equal(reloaded.extensionNightEnabled, true);
    assert.equal(reloaded.extensionDiscountPreArrivalOneNightGap, 18);
    assert.equal(reloaded.extensionDiscountPreArrivalStandard, 9);
    assert.equal(reloaded.extensionDiscountInHouseOneNightGap, 22);
    assert.equal(reloaded.extensionDiscountInHouseStandard, 14);
    assert.equal(reloaded.minSellableStayNights, 4);
  });
});

test("saveExtensionConfig: a save no longer needs (or writes) the legacy flat fields", async () => {
  await withCleanLocalDb(async () => {
    const saved = await saveExtensionConfig("FRESHSAVEPROP", {
      extensionNightEnabled: true,
      extensionDiscountPreArrivalOneNightGap: 15,
      extensionDiscountPreArrivalStandard: 10,
      extensionDiscountInHouseOneNightGap: 20,
      extensionDiscountInHouseStandard: 15,
      minSellableStayNights: 2,
    });
    assert.equal("extensionDiscountOneNightGap" in saved, false);
    assert.equal("extensionDiscountStandard" in saved, false);
  });
});
