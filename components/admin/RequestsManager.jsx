"use client";

import { useEffect, useState } from "react";
import { formatDateTime, formatDate, formatPrice } from "@/lib/format";

const STATUS_LABELS = {
  pending: "Offen",
  approved: "Bestätigt",
  rejected: "Abgelehnt",
};

const STATUS_STYLES = {
  pending: "bg-amber-50 text-amber-700",
  approved: "bg-green-50 text-green-700",
  rejected: "bg-slate-100 text-slate-500",
};

export default function RequestsManager() {
  const [requests, setRequests] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [actioningId, setActioningId] = useState(null);
  const [rowErrors, setRowErrors] = useState({});

  function load() {
    setLoading(true);
    setError("");
    return fetch("/api/admin/requests")
      .then((r) => r.json())
      .then((data) => setRequests(data.requests || []))
      .catch(() => setError("Anfragen konnten nicht geladen werden."))
      .finally(() => setLoading(false));
  }

  useEffect(() => {
    load();
  }, []);

  async function handleAction(requestId, action) {
    setActioningId(requestId);
    setRowErrors((prev) => ({ ...prev, [requestId]: "" }));
    try {
      const res = await fetch(`/api/admin/requests/${encodeURIComponent(requestId)}/${action}`, {
        method: "POST",
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Aktion fehlgeschlagen.");
      await load();
    } catch (err) {
      setRowErrors((prev) => ({ ...prev, [requestId]: err.message }));
    } finally {
      setActioningId(null);
    }
  }

  if (loading) return <p className="text-sm text-slate-500">Wird geladen…</p>;
  if (error) return <p className="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">{error}</p>;
  if (!requests.length) return <p className="text-sm text-slate-500">Noch keine Anfragen vorhanden.</p>;

  return (
    <div>
      <p className="mb-2 text-xs text-slate-400 lg:hidden">← Tabelle nach links wischen, um alle Spalten zu sehen →</p>
      <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm">
        {/*
          Aktionen is placed right after Status (not at the far right) so
          Bestätigen/Ablehnen are always the first thing visible at
          scrollLeft=0, regardless of how wide the later detail columns
          get with real production data (long guest/property names, etc).
          A `position: sticky` last column looked like the obvious fix, but
          it has a real, unavoidable flaw: whenever the table is wider than
          its container, a right-stuck column visually overlaps and hides
          whatever content naturally renders underneath it — verified while
          testing this fix, not just a theoretical concern. Columns are
          otherwise kept as tight as reasonably possible (related fields
          stacked into one cell, e.g. Reservierung/Property) so scrolling
          for the remaining detail columns is only needed on narrow screens.
        */}
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
            <tr>
              <th className="px-3 py-2">Status</th>
              <th className="px-3 py-2">Aktionen</th>
              <th className="px-3 py-2">Extra</th>
              <th className="px-3 py-2">Gast</th>
              <th className="px-3 py-2">Reservierung / Property</th>
              <th className="px-3 py-2">Zeitraum / Gewünscht</th>
              <th className="px-3 py-2">Menge</th>
              <th className="px-3 py-2">Preis</th>
              <th className="px-3 py-2">Erstellt</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {requests.map((req) => (
              <tr key={req.requestId}>
                <td className="whitespace-nowrap px-3 py-2">
                  <span
                    className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${
                      STATUS_STYLES[req.status] || "bg-slate-100 text-slate-500"
                    }`}
                  >
                    {STATUS_LABELS[req.status] || req.status}
                  </span>
                </td>
                <td className="px-3 py-2">
                  {req.status === "pending" ? (
                    <div className="flex flex-col gap-1">
                      <div className="flex gap-2">
                        <button
                          onClick={() => handleAction(req.requestId, "approve")}
                          disabled={actioningId === req.requestId}
                          className="whitespace-nowrap rounded-md bg-brand-600 px-3 py-1 text-xs font-medium text-white hover:bg-brand-700 disabled:opacity-60"
                        >
                          Bestätigen
                        </button>
                        <button
                          onClick={() => handleAction(req.requestId, "reject")}
                          disabled={actioningId === req.requestId}
                          className="whitespace-nowrap rounded-md border border-slate-300 px-3 py-1 text-xs font-medium text-slate-600 hover:bg-slate-100 disabled:opacity-60"
                        >
                          Ablehnen
                        </button>
                      </div>
                      {rowErrors[req.requestId] && (
                        <p className="max-w-[14rem] break-words text-xs text-red-600">{rowErrors[req.requestId]}</p>
                      )}
                    </div>
                  ) : (
                    <span className="text-xs text-slate-400">–</span>
                  )}
                </td>
                <td className="max-w-[8rem] break-words px-3 py-2 font-medium text-slate-800">
                  {req.serviceName}
                </td>
                <td className="max-w-[8rem] break-words px-3 py-2">
                  <div>{req.guestName}</div>
                  {req.guestEmail && <div className="text-xs text-slate-400">{req.guestEmail}</div>}
                </td>
                <td className="max-w-[8rem] break-words px-3 py-2 text-slate-600">
                  <div>{req.reservationId}</div>
                  <div className="text-xs text-slate-400">{req.propertyName || req.propertyId}</div>
                </td>
                <td className="max-w-[9rem] break-words px-3 py-2 text-slate-600">
                  <div>
                    {req.arrivalDate ? formatDate(req.arrivalDate) : "–"} –{" "}
                    {req.departureDate ? formatDate(req.departureDate) : "–"}
                  </div>
                  <div className="text-xs text-slate-400">
                    Gewünscht: {req.requestedServiceDate ? formatDate(req.requestedServiceDate) : "–"}
                  </div>
                </td>
                <td className="px-3 py-2">{req.requestedQuantity}</td>
                <td className="whitespace-nowrap px-3 py-2">
                  {formatPrice({ amount: req.displayedPrice, currency: req.currency })}
                </td>
                <td className="whitespace-nowrap px-3 py-2 text-slate-500">
                  {formatDateTime(req.createdAt)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
