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

/**
 * Reads a value by key. Returns `fallback` when the key is missing.
 */
export async function getJSON(key, fallback = null) {
  if (hasKv) {
    const kv = await getKvClient();
    const value = await kv.get(key);
    return value === null || value === undefined ? fallback : value;
  }
  const db = await readLocalDb();
  return key in db ? db[key] : fallback;
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
  const db = await readLocalDb();
  db[key] = value;
  await writeLocalDb(db);
}

export async function deleteKey(key) {
  if (hasKv) {
    const kv = await getKvClient();
    await kv.del(key);
    return;
  }
  const db = await readLocalDb();
  delete db[key];
  await writeLocalDb(db);
}

export function isUsingKv() {
  return hasKv;
}
