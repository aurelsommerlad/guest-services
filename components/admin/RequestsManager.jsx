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
    <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm">
      <table className="w-full text-sm">
        <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
          <tr>
            <th className="px-4 py-2">Status</th>
            <th className="px-4 py-2">Extra</th>
            <th className="px-4 py-2">Gast</th>
            <th className="px-4 py-2">Reservierung</th>
            <th className="px-4 py-2">Property</th>
            <th className="px-4 py-2">Anreise / Abreise</th>
            <th className="px-4 py-2">Gewünschtes Datum</th>
            <th className="px-4 py-2">Menge</th>
            <th className="px-4 py-2">Preis</th>
            <th className="px-4 py-2">Erstellt</th>
            <th className="px-4 py-2">Aktionen</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {requests.map((req) => (
            <tr key={req.requestId}>
              <td className="px-4 py-2 whitespace-nowrap">
                <span
                  className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${
                    STATUS_STYLES[req.status] || "bg-slate-100 text-slate-500"
                  }`}
                >
                  {STATUS_LABELS[req.status] || req.status}
                </span>
              </td>
              <td className="px-4 py-2 font-medium text-slate-800">{req.serviceName}</td>
              <td className="px-4 py-2">
                <div>{req.guestName}</div>
                {req.guestEmail && <div className="text-xs text-slate-400">{req.guestEmail}</div>}
              </td>
              <td className="px-4 py-2 text-slate-600">{req.reservationId}</td>
              <td className="px-4 py-2 text-slate-600">{req.propertyName || req.propertyId}</td>
              <td className="px-4 py-2 whitespace-nowrap text-slate-600">
                {req.arrivalDate ? formatDate(req.arrivalDate) : "–"} –{" "}
                {req.departureDate ? formatDate(req.departureDate) : "–"}
              </td>
              <td className="px-4 py-2 whitespace-nowrap text-slate-600">
                {req.requestedServiceDate ? formatDate(req.requestedServiceDate) : "–"}
              </td>
              <td className="px-4 py-2">{req.requestedQuantity}</td>
              <td className="px-4 py-2">
                {formatPrice({ amount: req.displayedPrice, currency: req.currency })}
              </td>
              <td className="px-4 py-2 whitespace-nowrap text-slate-500">
                {formatDateTime(req.createdAt)}
              </td>
              <td className="px-4 py-2">
                {req.status === "pending" ? (
                  <div className="flex flex-col gap-1">
                    <div className="flex gap-2">
                      <button
                        onClick={() => handleAction(req.requestId, "approve")}
                        disabled={actioningId === req.requestId}
                        className="rounded-md bg-brand-600 px-3 py-1 text-xs font-medium text-white hover:bg-brand-700 disabled:opacity-60"
                      >
                        Bestätigen
                      </button>
                      <button
                        onClick={() => handleAction(req.requestId, "reject")}
                        disabled={actioningId === req.requestId}
                        className="rounded-md border border-slate-300 px-3 py-1 text-xs font-medium text-slate-600 hover:bg-slate-100 disabled:opacity-60"
                      >
                        Ablehnen
                      </button>
                    </div>
                    {rowErrors[req.requestId] && (
                      <p className="max-w-xs text-xs text-red-600">{rowErrors[req.requestId]}</p>
                    )}
                  </div>
                ) : (
                  <span className="text-xs text-slate-400">–</span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
