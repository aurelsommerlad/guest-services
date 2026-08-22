import { promises as fs } from "fs";
import path from "path";

const LOCAL_DB_PATH = path.join(process.cwd(), ".data", "db.json");

const hasKv = Boolean(
  process.env.KV_REST_API_URL && process.env.KV_REST_API_TOKEN
);

let kvClientPromise = null;

async function getKvClient() {
  if (!kvClientPromise) {
    kvClientPromise = import("@vercel/kv").then((mod) => mod.kv);
  }
  return kvClientPromise;
}

async function readLocalDb() {
  try {
    const raw = await fs.readFile(LOCAL_DB_PATH, "utf8");
    return JSON.parse(raw);
  } catch (err) {
    if (err.code === "ENOENT") return {};
    throw err;
  }
}

async function writeLocalDb(db) {
  await fs.mkdir(path.dirname(LOCAL_DB_PATH), { recursive: true });
  await fs.writeFile(LOCAL_DB_PATH, JSON.stringify(db, null, 2), "utf8");
}

// The local JSON fallback is a single file shared by every key. Without
// serialization, two concurrent read-modify-write sequences (e.g. two
// admin catalog saves landing at the same time) can interleave their
// fs.writeFile calls and corrupt the file, or silently lose one of the
// two updates. This only needs to hold within a single Node process —
// the local fallback is a single-process dev/no-KV mode by construction,
// unlike production, which can run many concurrent serverless instances
// against shared Redis (handled separately via atomic hash commands
// below, not via this in-process lock).
let localDbQueue = Promise.resolve();
function withLocalDbLock(fn) {
  const run = localDbQueue.then(fn, fn);
  localDbQueue = run.then(
    () => undefined,
    () => undefined
  );
  return run;
}

/**
 * Reads a value by key. Returns `fallback` when the key is missing.
 */
export async function getJSON(key, fallback = null) {
  if (hasKv) {
    const kv = await getKvClient();
    const value = await kv.get(key);
    return value === null || value === undefined ? fallback : value;
  }
  return withLocalDbLock(async () => {
    const db = await readLocalDb();
    return key in db ? db[key] : fallback;
  });
}

/**
 * Writes a value by key (JSON-serializable).
 */
export async function setJSON(key, value) {
  if (hasKv) {
    const kv = await getKvClient();
    await kv.set(key, value);
    return;
  }
  return withLocalDbLock(async () => {
    const db = await readLocalDb();
    db[key] = value;
    await writeLocalDb(db);
  });
}

export async function deleteKey(key) {
  if (hasKv) {
    const kv = await getKvClient();
    await kv.del(key);
    return;
  }
  return withLocalDbLock(async () => {
    const db = await readLocalDb();
    delete db[key];
    await writeLocalDb(db);
  });
}

/**
 * Reads every field of a hash. Returns {} when the key is missing.
 * Backed by a real Redis HASH in production — HGETALL — and by a plain
 * nested object under the same key in the local JSON fallback.
 */
export async function hashGetAll(key) {
  if (hasKv) {
    const kv = await getKvClient();
    const value = await kv.hgetall(key);
    return value || {};
  }
  return withLocalDbLock(async () => {
    const db = await readLocalDb();
    return db[key] || {};
  });
}

/**
 * Reads a single field of a hash. Returns null when missing.
 */
export async function hashGetField(key, field) {
  if (hasKv) {
    const kv = await getKvClient();
    const value = await kv.hget(key, field);
    return value ?? null;
  }
  return withLocalDbLock(async () => {
    const db = await readLocalDb();
    return db[key]?.[field] ?? null;
  });
}

/**
 * Atomically sets a single field of a hash without touching any other
 * field — this is what actually fixes the lost-update race: two
 * concurrent hashSetField calls for different fields of the same key can
 * never clobber each other, in production because Redis's HSET is a
 * single atomic command per call, and locally because writes are
 * serialized through withLocalDbLock.
 */
export async function hashSetField(key, field, value) {
  if (hasKv) {
    const kv = await getKvClient();
    await kv.hset(key, { [field]: value });
    return;
  }
  return withLocalDbLock(async () => {
    const db = await readLocalDb();
    db[key] = { ...(db[key] || {}), [field]: value };
    await writeLocalDb(db);
  });
}

export function isUsingKv() {
  return hasKv;
}
