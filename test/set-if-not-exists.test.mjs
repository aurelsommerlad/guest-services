// Pure unit test for lib/db.js's setIfNotExists — the atomic claim/dedup
// primitive that lib/store.js builds claimRequestProcessing() and
// claimSlackNotification() on top of. lib/db.js has no extensionless
// relative imports of its own (only "fs"/"path" and a dynamic import of
// "@vercel/kv" that never triggers without KV env vars), so unlike
// lib/store.js/lib/guest.js it can be imported directly by Node's test
// runner without spawning a real Next server.
//
// Run with: npm test

import { test } from "node:test";
import assert from "node:assert/strict";

// lib/db.js resolves its local-fallback file relative to process.cwd() at
// import time — match the existing integration tests' assumption that
// `npm test` runs from the project root.
const { getJSON, setIfNotExists, deleteKey } = await import("../lib/db.js");

test("setIfNotExists: claims a fresh key and returns true", async () => {
  const key = "test:claim:fresh";
  await deleteKey(key);
  try {
    const claimed = await setIfNotExists(key, "first");
    assert.equal(claimed, true);
    assert.equal(await getJSON(key), "first");
  } finally {
    await deleteKey(key);
  }
});

test("setIfNotExists: never overwrites an existing key, and reports false", async () => {
  const key = "test:claim:existing";
  await deleteKey(key);
  try {
    assert.equal(await setIfNotExists(key, "first"), true);
    const claimed = await setIfNotExists(key, "second");
    assert.equal(claimed, false, "a second claim on the same key must fail");
    assert.equal(await getJSON(key), "first", "the original value must survive the failed second claim");
  } finally {
    await deleteKey(key);
  }
});

test("setIfNotExists: concurrent claims on the same key — exactly one wins", async () => {
  const key = "test:claim:concurrent";
  await deleteKey(key);
  try {
    const results = await Promise.all(
      Array.from({ length: 10 }, (_, i) => setIfNotExists(key, `attempt-${i}`))
    );
    const wins = results.filter(Boolean).length;
    assert.equal(wins, 1, "exactly one concurrent claim must succeed — this is the guarantee approval/Slack dedup rely on");
  } finally {
    await deleteKey(key);
  }
});

test("setIfNotExists: independent keys never interfere with each other", async () => {
  const keyA = "test:claim:independent-a";
  const keyB = "test:claim:independent-b";
  await Promise.all([deleteKey(keyA), deleteKey(keyB)]);
  try {
    const [claimedA, claimedB] = await Promise.all([
      setIfNotExists(keyA, "a"),
      setIfNotExists(keyB, "b"),
    ]);
    assert.equal(claimedA, true);
    assert.equal(claimedB, true);
  } finally {
    await Promise.all([deleteKey(keyA), deleteKey(keyB)]);
  }
});
