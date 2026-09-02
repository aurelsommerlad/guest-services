"use client";

import { Fragment, useEffect, useState } from "react";
import { formatDate, formatDateTime, formatPrice } from "@/lib/format";

const STATUS_OPTIONS = [
  { value: "", label: "Alle Status" },
  { value: "confirmed", label: "Gebucht" },
  { value: "partial", label: "Teilweise abgeschlossen" },
  { value: "failed", label: "Fehlgeschlagen" },
];

const STATUS_BADGE_CLASS = {
  confirmed: "bg-emerald-50 text-emerald-700",
  partial: "bg-amber-50 text-amber-700",
  failed: "bg-red-50 text-red-700",
  unknown: "bg-slate-100 text-slate-600",
};

function StatusBadge({ status, statusLabel }) {
  return (
    <span
      className={`inline-flex whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium ${
        STATUS_BADGE_CLASS[status] || STATUS_BADGE_CLASS.unknown
      }`}
    >
      {statusLabel}
    </span>
  );
}

function Field({ label, value }) {
  return (
    <div>
      <dt className="text-xs text-slate-500">{label}</dt>
      <dd className="text-slate-900">{value ?? "-"}</dd>
    </div>
  );
}

function ExtrasList({ extras }) {
  if (!extras.length) return <p className="text-slate-500">Keine Extras verlängert.</p>;
  return (
    <ul className="space-y-1">
      {extras.map((extra, i) => (
        <li key={extra.serviceId || i} className="flex items-center justify-between gap-2">
          <span className="text-slate-700">
            {extra.name || extra.serviceId || "-"}
            {extra.alreadyDone && <span className="ml-1 text-xs text-slate-400">(bereits vorhanden)</span>}
            {extra.extended === false && <span className="ml-1 text-xs text-red-600">(fehlgeschlagen)</span>}
          </span>
          <span className="whitespace-nowrap text-slate-900">{extra.amount ? formatPrice(extra.amount) : "-"}</span>
        </li>
      ))}
    </ul>
  );
}

function LateCheckoutMovesList({ moves }) {
  if (!moves.length) return null;
  return (
    <ul className="mt-2 space-y-1">
      {moves.map((move, i) => (
        <li key={move.serviceId || i} className="flex items-center justify-between gap-2">
          <span className="text-slate-700">
            {move.name || move.serviceId || "-"} verschoben ({formatDate(move.oldDeparture) || "-"} →{" "}
            {formatDate(move.newDeparture) || "-"})
            {!move.verified && <span className="ml-1 text-xs text-red-600">(nicht verifiziert)</span>}
          </span>
          <span className="whitespace-nowrap text-slate-900">{move.amount ? formatPrice(move.amount) : "-"}</span>
        </li>
      ))}
    </ul>
  );
}

function StayExtensionDetail({ row }) {
  return (
    <div className="space-y-4 rounded-lg border border-slate-200 bg-slate-50 p-4 text-sm">
      <div>
        <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Reservierung</p>
        <dl className="mt-1 grid grid-cols-2 gap-x-6 gap-y-2 sm:grid-cols-3">
          <Field label="Gast" value={row.guestName} />
          <Field label="Property" value={row.propertyName} />
          <Field label="Unterkunft" value={row.unitName} />
          <Field label="Reservierungs-ID" value={row.reservationId} />
          <Field label="Alte Abreise" value={formatDate(row.oldDeparture) || "-"} />
          <Field label="Neue Abreise" value={formatDate(row.newDeparture) || "-"} />
          <Field label="Gebucht am" value={formatDateTime(row.createdAt) || "-"} />
        </dl>
      </div>

      <div>
        <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Unterkunftspreis</p>
        <dl className="mt-1 grid grid-cols-2 gap-x-6 gap-y-2 sm:grid-cols-3">
          <Field
            label="Regulärer Preis"
            value={row.originalAverageNightlyRate ? formatPrice(row.originalAverageNightlyRate) : "-"}
          />
          <Field label="Rabatt" value={row.discountPercent !== null ? `${row.discountPercent} %` : "-"} />
          <Field
            label="Verlängerungspreis"
            value={row.extensionPrice ? formatPrice(row.extensionPrice) : "-"}
          />
        </dl>
      </div>

      <div>
        <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Zusätzliche Leistungen</p>
        <div className="mt-1">
          <ExtrasList extras={row.extras} />
          <LateCheckoutMovesList moves={row.lateCheckoutMoves} />
          <p className="mt-2 text-slate-700">
            {row.cityTax?.applicable
              ? `Gästetaxe: ${row.cityTax.verified && row.cityTax.amount ? formatPrice(row.cityTax.amount) : "nicht verifiziert"}`
              : "Keine Gästetaxe."}
          </p>
        </div>
      </div>

      <div>
        <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Verifizierung</p>
        <dl className="mt-1 grid grid-cols-2 gap-x-6 gap-y-2 sm:grid-cols-3">
          <Field
            label="Neue Abreise bestätigt"
            value={row.newDepartureConfirmed === null ? "-" : row.newDepartureConfirmed ? "Ja" : "Nein"}
          />
          <Field
            label="Pflicht-Services intakt"
            value={row.mandatoryServicesIntact === null ? "-" : row.mandatoryServicesIntact ? "Ja" : "Nein"}
          />
          <Field label="Status" value={<StatusBadge status={row.status} statusLabel={row.statusLabel} />} />
        </dl>
      </div>

      <div className="flex items-center justify-between border-t border-slate-200 pt-3">
        <span className="font-semibold text-slate-800">Gesamt zusätzlich</span>
        <span className="text-lg font-semibold text-slate-900">
          {row.totalAdditionalAmount ? formatPrice(row.totalAdditionalAmount) : "-"}
        </span>
      </div>
    </div>
  );
}

export default function StayExtensionsManager() {
  const [properties, setProperties] = useState([]);
  const [propertyId, setPropertyId] = useState("");
  const [status, setStatus] = useState("");
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [expandedId, setExpandedId] = useState(null);

  useEffect(() => {
    fetch("/api/admin/properties")
      .then((r) => r.json())
      .then((data) => setProperties(data.properties || []))
      .catch(() => {});
  }, []);

  useEffect(() => {
    setLoading(true);
    setError("");
    const params = new URLSearchParams();
    if (propertyId) params.set("propertyId", propertyId);
    if (status) params.set("status", status);
    fetch(`/api/admin/stay-extensions?${params.toString()}`)
      .then(async (r) => {
        const data = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(data.error || "Verlängerungsnächte konnten nicht geladen werden.");
        return data;
      })
      .then((data) => setRows(data.records || []))
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, [propertyId, status]);

  function toggleExpanded(id) {
    setExpandedId((prev) => (prev === id ? null : id));
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-4">
        <div>
          <label className="block text-sm font-medium text-slate-700">Property</label>
          <select
            value={propertyId}
            onChange={(e) => setPropertyId(e.target.value)}
            className="mt-1 rounded-lg border border-slate-300 px-3 py-2 text-sm"
          >
            <option value="">Alle Properties</option>
            {properties.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-sm font-medium text-slate-700">Status</label>
          <select
            value={status}
            onChange={(e) => setStatus(e.target.value)}
            className="mt-1 rounded-lg border border-slate-300 px-3 py-2 text-sm"
          >
            {STATUS_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </div>
      </div>

      {error && <p className="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">{error}</p>}
      {loading && <p className="text-sm text-slate-500">Wird geladen…</p>}
      {!loading && !error && !rows.length && (
        <p className="text-sm text-slate-500">Noch keine Verlängerungsnächte vorhanden.</p>
      )}

      {/* Desktop: table. Mobile: stacked cards (see below) — never a wide
          table forced onto a narrow screen. */}
      {rows.length > 0 && (
        <div className="hidden overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm sm:block">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
              <tr>
                <th className="px-4 py-2">Gast</th>
                <th className="px-4 py-2">Unterkunft</th>
                <th className="px-4 py-2">Alte Abreise</th>
                <th className="px-4 py-2">Neue Abreise</th>
                <th className="px-4 py-2">Rabatt</th>
                <th className="px-4 py-2">Preis</th>
                <th className="px-4 py-2">Status</th>
                <th className="px-4 py-2">Gebucht am</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {rows.map((row) => (
                <Fragment key={row.id}>
                  <tr
                    onClick={() => toggleExpanded(row.id)}
                    className="cursor-pointer hover:bg-slate-50"
                  >
                    <td className="px-4 py-2 font-medium text-slate-800">{row.guestName}</td>
                    <td className="px-4 py-2 text-slate-700">
                      {row.propertyName}
                      {row.unitName && row.unitName !== "-" ? ` · ${row.unitName}` : ""}
                    </td>
                    <td className="whitespace-nowrap px-4 py-2 text-slate-700">{formatDate(row.oldDeparture) || "-"}</td>
                    <td className="whitespace-nowrap px-4 py-2 text-slate-700">{formatDate(row.newDeparture) || "-"}</td>
                    <td className="whitespace-nowrap px-4 py-2 text-slate-700">
                      {row.discountPercent !== null ? `${row.discountPercent} %` : "-"}
                    </td>
                    <td className="whitespace-nowrap px-4 py-2 font-medium text-slate-900">
                      {row.extensionPrice ? formatPrice(row.extensionPrice) : "-"}
                    </td>
                    <td className="whitespace-nowrap px-4 py-2">
                      <StatusBadge status={row.status} statusLabel={row.statusLabel} />
                    </td>
                    <td className="whitespace-nowrap px-4 py-2 text-slate-500">
                      {formatDateTime(row.createdAt) || "-"}
                    </td>
                  </tr>
                  {expandedId === row.id && (
                    <tr>
                      <td colSpan={8} className="bg-slate-50 px-4 py-4">
                        <StayExtensionDetail row={row} />
                      </td>
                    </tr>
                  )}
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="space-y-3 sm:hidden">
        {rows.map((row) => (
          <div key={row.id} className="rounded-xl border border-slate-200 bg-white shadow-sm">
            <button
              type="button"
              onClick={() => toggleExpanded(row.id)}
              className="flex w-full flex-col gap-2 p-4 text-left"
            >
              <div className="flex items-start justify-between gap-2">
                <div>
                  <p className="font-semibold text-slate-800">{row.guestName}</p>
                  <p className="text-sm text-slate-500">
                    {row.propertyName}
                    {row.unitName && row.unitName !== "-" ? ` · ${row.unitName}` : ""}
                  </p>
                </div>
                <StatusBadge status={row.status} statusLabel={row.statusLabel} />
              </div>
              <div className="flex items-center justify-between text-sm">
                <span className="text-slate-500">
                  {formatDate(row.oldDeparture) || "-"} → {formatDate(row.newDeparture) || "-"}
                </span>
                <span className="font-semibold text-slate-900">
                  {row.extensionPrice ? formatPrice(row.extensionPrice) : "-"}
                </span>
              </div>
              <div className="flex items-center justify-between text-xs text-slate-400">
                <span>{row.discountPercent !== null ? `${row.discountPercent} % Rabatt` : ""}</span>
                <span>{formatDateTime(row.createdAt) || "-"}</span>
              </div>
            </button>
            {expandedId === row.id && (
              <div className="border-t border-slate-100 p-3">
                <StayExtensionDetail row={row} />
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
