// Dependency-free (same reasoning as lib/stayExtension.js/
// lib/reservationSummary.js — directly unit-testable with plain
// `node --test`, no live Apaleo access, no Next bundler needed) — the
// presentation-layer logic behind the Admin "Verlängerungsnächte" view
// (app/api/admin/stay-extensions/route.js /
// components/admin/StayExtensionsManager.jsx). Never mutates anything;
// only reads/shapes lib/store.js's existing stay-extension audit records
// (see lib/guest.js's confirmStayExtension for how those are written).
//
// Every function here is deliberately tolerant of missing/legacy fields —
// an audit record written before this Admin view existed (e.g. reservation
// HVQSVNWL-1, which predates propertyId/phase/gap/totalAdditionalAmount)
// must still render safely, with "-" wherever a value genuinely isn't
// recoverable, never a crash and never an invented number.

import { computeExtensionAdditionalTotal } from "./stayExtension.js";

// The only status values lib/guest.js's confirmStayExtension has ever
// written are "confirmed" and "confirmed_with_issues" — "partial" and
// "failed" aren't produced today (a hard failure before the accommodation
// amend succeeds throws before any record is ever written), but are
// normalized here too since the spec calls for them and a future code path
// or manually-corrected record could use them. Anything else collapses to
// "unknown" rather than crashing the Admin view.
export function normalizeExtensionStatus(rawStatus) {
  switch (rawStatus) {
    case "confirmed":
      return "confirmed";
    case "confirmed_with_issues":
    case "partial":
      return "partial";
    case "failed":
      return "failed";
    default:
      return "unknown";
  }
}

export const EXTENSION_STATUS_LABELS_DE = {
  confirmed: "Gebucht",
  partial: "Teilweise abgeschlossen",
  failed: "Fehlgeschlagen",
  unknown: "Unbekannt",
};

export function getExtensionStatusLabel(rawStatus) {
  return EXTENSION_STATUS_LABELS_DE[normalizeExtensionStatus(rawStatus)];
}

/**
 * The total additional amount to display for a record. Future records
 * already carry a stored, authoritative `totalAdditionalAmount` — used
 * as-is. Older records (e.g. HVQSVNWL-1) never stored it, so it's
 * reconstructed with the exact same rule confirmStayExtension itself uses
 * (see lib/stayExtension.js's computeExtensionAdditionalTotal): for a
 * record with no extras and no applicable city tax (HVQSVNWL-1's shape),
 * this cleanly resolves to just the extension price. Returns null — never
 * a guessed number — whenever the stored data can't support a complete
 * total (e.g. an extended extra missing its amount).
 */
export function computeDisplayTotal(record) {
  if (record?.totalAdditionalAmount) {
    const amount = Number(record.totalAdditionalAmount.amount);
    if (Number.isFinite(amount)) {
      return { amount, currency: record.totalAdditionalAmount.currency || "EUR" };
    }
  }
  return computeExtensionAdditionalTotal({
    extensionPrice: record?.extensionPrice,
    extras: record?.extras,
    cityTax: record?.cityTax,
  });
}

/**
 * Combines one raw stay-extension audit record with its (best-effort,
 * possibly partial) Apaleo enrichment into the flat shape the Admin list
 * and detail view render — every field either a real value or an explicit
 * "-"/null, never `undefined` reaching a template. `enrichment` is
 * whatever app/api/admin/stay-extensions/route.js already resolved from
 * Apaleo (guestName/propertyName/unitName/propertyId); pass `{}` (or
 * omit it) when no reservation could be looked up at all — every field
 * still renders as "-" instead of throwing.
 */
export function buildStayExtensionAdminRow(record, enrichment = {}) {
  const status = normalizeExtensionStatus(record?.status);
  return {
    id: record?.id || null,
    reservationId: record?.reservationId || null,
    // A future record already carries its own propertyId; an older one
    // falls back to whatever the Apaleo enrichment lookup found (used for
    // the property filter — see filterStayExtensionRows below — so old
    // records aren't invisible to it just because they predate this
    // field).
    propertyId: record?.propertyId || enrichment.propertyId || null,
    source: "audit",
    guestName: enrichment.guestName || "-",
    propertyName: enrichment.propertyName || "-",
    unitName: enrichment.unitName || "-",
    oldDeparture: record?.oldDeparture || null,
    newDeparture: record?.newDeparture || null,
    createdAt: record?.createdAt || null,
    discountPercent: Number.isFinite(Number(record?.discountPercent)) ? Number(record.discountPercent) : null,
    originalAverageNightlyRate: record?.originalAverageNightlyRate || null,
    extensionPrice: record?.extensionPrice || null,
    totalAdditionalAmount: computeDisplayTotal(record),
    extras: Array.isArray(record?.extras) ? record.extras : [],
    lateCheckoutMoves: Array.isArray(record?.lateCheckoutMoves) ? record.lateCheckoutMoves : [],
    cityTax: record?.cityTax || null,
    newDepartureConfirmed: record?.newDepartureConfirmed ?? null,
    mandatoryServicesIntact: record?.mandatoryServicesIntact ?? null,
    // Additive fields (see lib/guest.js's confirmStayExtension) — null on
    // every record written before they existed.
    phase: record?.phase ?? null,
    gap: Number.isFinite(Number(record?.gap)) ? Number(record.gap) : null,
    statusRaw: record?.status ?? null,
    status,
    statusLabel: EXTENSION_STATUS_LABELS_DE[status],
  };
}

/** Most recent first; records with a missing/invalid createdAt sort last. */
export function sortStayExtensionRows(rows) {
  return [...rows].sort((a, b) => {
    const aTime = new Date(a?.createdAt || 0).getTime() || 0;
    const bTime = new Date(b?.createdAt || 0).getTime() || 0;
    return bTime - aTime;
  });
}

/**
 * `propertyId`/`status` are both optional; either/both applied. `status`
 * matches against the NORMALIZED status (see normalizeExtensionStatus), so
 * filtering by "partial" also matches legacy "confirmed_with_issues"
 * records.
 */
export function filterStayExtensionRows(rows, { propertyId, status } = {}) {
  return rows.filter((row) => {
    if (propertyId && row.propertyId !== propertyId) return false;
    if (status && row.status !== status) return false;
    return true;
  });
}
