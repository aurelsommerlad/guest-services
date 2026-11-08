import crypto from "crypto";
import { hashGetAll, hashSetField } from "../db.js";

// Audit trail of every bridge call that passed authentication (and of
// rejected ones with a reason). Deliberately without guest names, e-mail
// addresses, licence plates or prices beyond what the booking itself needs:
// reservation id, property, action, outcome, the token id and the
// idempotency key are enough to reconstruct what happened.

const AUDIT_KEY = "stay-bridge:audit";

export async function appendBridgeAudit(entry) {
  const record = {
    id: crypto.randomUUID(),
    at: new Date().toISOString(),
    action: entry.action,
    outcome: entry.outcome,
    reservationId: entry.reservationId || null,
    propertyId: entry.propertyId || null,
    serviceId: entry.serviceId || null,
    jti: entry.jti || null,
    idempotencyKey: entry.idempotencyKey || null,
    detail: entry.detail || null,
  };
  try {
    await hashSetField(AUDIT_KEY, record.id, record);
  } catch (err) {
    // The audit trail must never turn a successful booking into an error.
    console.error("[stay-bridge] audit write failed:", err?.message);
  }
  console.log(`[stay-bridge] ${record.action} ${record.outcome} ${record.reservationId || "-"} ${record.serviceId || ""}`);
  return record;
}

export async function listBridgeAudit() {
  const map = await hashGetAll(AUDIT_KEY);
  return Object.values(map).sort((a, b) => (a.at < b.at ? 1 : -1));
}
