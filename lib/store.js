import crypto from "crypto";
import {
  getJSON,
  setJSON,
  deleteKey,
  hashGetAll,
  hashGetField,
  hashSetField,
  setIfNotExists,
} from "./db";
import { hashPassword } from "./auth";

const MAX_ORDERS = 500;

// Controls which Apaleo service date(s) a curated catalog item resolves to
// for a guest's reservation — see lib/guest.js's resolveRequiredDates().
export const BOOKING_RULES = ["per_stay", "per_night", "arrival_day", "departure_day"];
export const DEFAULT_BOOKING_RULE = "per_stay";

// Controls whether a curated catalog item is booked immediately on Apaleo
// ("instant", the pre-existing behavior) or only recorded as a request for
// staff to review and approve later ("request"). Orthogonal to
// BOOKING_RULES, which only affects which service date(s) apply.
export const FULFILLMENT_MODES = ["instant", "request"];
export const DEFAULT_FULFILLMENT_MODE = "instant";

// "service" (default): the existing behavior — booked via Apaleo's
// book-service action. "increase_occupancy": e.g. "Extra person"/
// "Zusatzperson" — never booked as a service at all; instead amends the
// reservation's adult count and accommodation price directly. See
// lib/occupancyAmendment.js / lib/guest.js.
export const ACTION_TYPES = ["service", "increase_occupancy"];
export const DEFAULT_ACTION_TYPE = "service";

// Each property's curated catalog is stored as a Redis HASH, one field per
// serviceId (catalogHashKey), rather than a single JSON array under one
// key. A single-key array required a read-modify-write-whole-array cycle
// on every save, which raced under concurrent admin saves: two requests
// could both read the same "before" snapshot and the slower one to finish
// would overwrite the other's addition with no error at all. A hash field
// write (HSET) is atomic per field in Redis, so two concurrent saves for
// different services can never clobber each other.
function catalogHashKey(propertyId) {
  return `catalog:${propertyId}:items`;
}

// Pre-migration key: catalogs saved before this fix are a single JSON
// array under this key. Kept only so getCatalog() can migrate old data
// into the hash the first time it's read — see migrateLegacyCatalog().
function legacyCatalogKey(propertyId) {
  return `catalog:${propertyId}`;
}

async function migrateLegacyCatalog(propertyId) {
  const legacyItems = await getJSON(legacyCatalogKey(propertyId), []);
  if (!legacyItems.length) return {};
  const migrated = {};
  for (const item of legacyItems) {
    if (!item?.serviceId) continue;
    await hashSetField(catalogHashKey(propertyId), item.serviceId, item);
    migrated[item.serviceId] = item;
  }
  return migrated;
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
  let map = await hashGetAll(catalogHashKey(propertyId));
  if (Object.keys(map).length === 0) {
    // Nothing in the hash yet — lazily migrate a pre-fix array-format
    // catalog (if any) so existing curated items aren't lost. Idempotent:
    // once the hash is populated this branch is never hit again.
    map = await migrateLegacyCatalog(propertyId);
  }
  return Object.values(map);
}

export async function upsertCatalogItem(propertyId, item) {
  const key = catalogHashKey(propertyId);
  const existing = await hashGetField(key, item.serviceId);
  const next = {
    ...(existing || {}),
    ...item,
    updatedAt: new Date().toISOString(),
  };
  // Atomic per-field write — see the comment on catalogHashKey() above.
  await hashSetField(key, item.serviceId, next);
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

// --- Requests (fulfillmentMode: "request" extras) ----------------------
//
// Deliberately its own hash namespace, separate from both the catalog and
// from orders: request records track a staff-approval workflow (pending /
// approved / rejected) rather than a completed booking, and must never be
// mixed into normal instant-order data. Same atomic-per-field pattern as
// the catalog hash (see catalogHashKey() above) so concurrent writes to
// different requests — or to the same request's status vs. Slack fields —
// never clobber each other.
function requestsHashKey() {
  return "requests:items";
}

function requestClaimKey(requestId) {
  return `requests:claim:${requestId}`;
}

function requestSlackClaimKey(requestId) {
  return `requests:slack-notified:${requestId}`;
}

export async function listRequests() {
  const map = await hashGetAll(requestsHashKey());
  return Object.values(map);
}

export async function getRequestById(requestId) {
  return hashGetField(requestsHashKey(), requestId);
}

export async function createRequestRecord(record) {
  await hashSetField(requestsHashKey(), record.requestId, record);
  return record;
}

export async function updateRequestRecord(requestId, patch) {
  const key = requestsHashKey();
  const existing = await hashGetField(key, requestId);
  if (!existing) return null;
  const next = {
    ...existing,
    ...patch,
    updatedAt: new Date().toISOString(),
  };
  await hashSetField(key, requestId, next);
  return next;
}

/**
 * Claims exclusive processing rights for approving/rejecting a request, so
 * two concurrent admin actions (or a retried request) can never both act on
 * the same request — critical to avoid a duplicate Apaleo booking. Backed
 * by setIfNotExists, which is atomic even across concurrent serverless
 * instances. Callers must releaseRequestProcessing() in a `finally` block.
 */
export async function claimRequestProcessing(requestId) {
  return setIfNotExists(requestClaimKey(requestId), String(Date.now()));
}

export async function releaseRequestProcessing(requestId) {
  await deleteKey(requestClaimKey(requestId));
}

/**
 * Claims the right to send the "new request" Slack notification exactly
 * once per requestId, independent of retries/duplicate submissions. Backed
 * by the same atomic setIfNotExists primitive as claimRequestProcessing.
 */
export async function claimSlackNotification(requestId) {
  return setIfNotExists(requestSlackClaimKey(requestId), String(Date.now()));
}

/**
 * Releases a previously acquired Slack-notification claim — used when the
 * actual send fails (network error, non-2xx from Slack), so the failure
 * isn't permanently mistaken for "already notified" on a later retry.
 */
export async function releaseSlackNotificationClaim(requestId) {
  await deleteKey(requestSlackClaimKey(requestId));
}

// --- Occupancy amendments ("Extra person" / actionType increase_occupancy) --

function occupancyAmendClaimKey(reservationId, serviceId) {
  return `occupancy-amend:claim:${reservationId}:${serviceId}`;
}

/**
 * Claims exclusive rights to amend a reservation's occupancy for a given
 * catalog item, same atomic-across-instances primitive and purpose as
 * claimRequestProcessing above — prevents two concurrent submissions (a
 * double-click, two tabs) from both reading the same "before" capacity and
 * both succeeding, which together could push the reservation over the unit
 * group's allowed occupancy. Held only for the duration of a single
 * amendment attempt; callers must releaseOccupancyAmendment() in a
 * `finally` block.
 */
export async function claimOccupancyAmendment(reservationId, serviceId) {
  return setIfNotExists(occupancyAmendClaimKey(reservationId, serviceId), String(Date.now()));
}

export async function releaseOccupancyAmendment(reservationId, serviceId) {
  await deleteKey(occupancyAmendClaimKey(reservationId, serviceId));
}

// --- Vehicle-registration bookings (requiresVehicleRegistration, e.g. parking) --

function vehicleBookingClaimKey(reservationId, serviceId) {
  return `vehicle-booking:claim:${reservationId}:${serviceId}`;
}

/**
 * Claims exclusive rights to save the vehicle registration(s) and book a
 * requiresVehicleRegistration catalog item (e.g. parking) for a
 * reservation — same atomic-across-instances primitive and purpose as
 * claimOccupancyAmendment above: prevents two concurrent submissions
 * (double-click, two tabs) from both writing the plate and both booking the
 * service. Held only for the duration of a single booking attempt; callers
 * must releaseVehicleBooking() in a `finally` block.
 */
export async function claimVehicleBooking(reservationId, serviceId) {
  return setIfNotExists(vehicleBookingClaimKey(reservationId, serviceId), String(Date.now()));
}

export async function releaseVehicleBooking(reservationId, serviceId) {
  await deleteKey(vehicleBookingClaimKey(reservationId, serviceId));
}
