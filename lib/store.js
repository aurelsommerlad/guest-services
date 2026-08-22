import crypto from "crypto";
import { getJSON, setJSON } from "./db";
import { hashPassword } from "./auth";

const MAX_ORDERS = 500;

// Controls which Apaleo service date(s) a curated catalog item resolves to
// for a guest's reservation — see lib/guest.js's resolveRequiredDates().
export const BOOKING_RULES = ["per_stay", "per_night", "arrival_day", "departure_day"];
export const DEFAULT_BOOKING_RULE = "per_stay";

function catalogKey(propertyId) {
  return `catalog:${propertyId}`;
}

// --- Users -----------------------------------------------------------

export async function listUsers() {
  return getJSON("users", []);
}

export async function findUserByUsername(username) {
  const users = await listUsers();
  const target = String(username || "").trim().toLowerCase();
  return users.find((u) => u.username.toLowerCase() === target) || null;
}

export async function findUserById(id) {
  const users = await listUsers();
  return users.find((u) => u.id === id) || null;
}

export async function createUser({ username, password, role }) {
  const users = await listUsers();
  const existing = users.find((u) => u.username.toLowerCase() === username.trim().toLowerCase());
  if (existing) {
    throw new Error("Ein Benutzer mit diesem Namen existiert bereits.");
  }
  const user = {
    id: crypto.randomUUID(),
    username: username.trim(),
    passwordHash: await hashPassword(password),
    role,
    createdAt: new Date().toISOString(),
  };
  users.push(user);
  await setJSON("users", users);
  return user;
}

export async function updateUser(id, updates) {
  const users = await listUsers();
  const index = users.findIndex((u) => u.id === id);
  if (index === -1) return null;
  const next = { ...users[index] };
  if (updates.role) next.role = updates.role;
  if (updates.passwordHash) next.passwordHash = updates.passwordHash;
  users[index] = next;
  await setJSON("users", users);
  return next;
}

export async function deleteUser(id) {
  const users = await listUsers();
  const next = users.filter((u) => u.id !== id);
  await setJSON("users", next);
  return next.length !== users.length;
}

// --- Catalog -----------------------------------------------------------

export async function getCatalog(propertyId) {
  return getJSON(catalogKey(propertyId), []);
}

export async function saveCatalog(propertyId, items) {
  await setJSON(catalogKey(propertyId), items);
  return items;
}

export async function upsertCatalogItem(propertyId, item) {
  const items = await getCatalog(propertyId);
  const index = items.findIndex((i) => i.serviceId === item.serviceId);
  const next = {
    ...(index === -1 ? {} : items[index]),
    ...item,
    updatedAt: new Date().toISOString(),
  };
  if (index === -1) {
    items.push(next);
  } else {
    items[index] = next;
  }
  await saveCatalog(propertyId, items);
  return next;
}

// --- Orders -----------------------------------------------------------

export async function listOrders() {
  return getJSON("orders", []);
}

export async function addOrder(order) {
  const orders = await listOrders();
  orders.unshift(order);
  await setJSON("orders", orders.slice(0, MAX_ORDERS));
  return order;
}
