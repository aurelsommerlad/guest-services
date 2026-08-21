"use client";

import { useEffect, useState } from "react";

function emptyRow(service) {
  return {
    serviceId: service.id,
    code: service.code,
    name: service.name,
    displayName: service.name,
    description: service.description || "",
    category: "",
    imageUrl: "",
    active: false,
  };
}

export default function CatalogManager() {
  const [properties, setProperties] = useState([]);
  const [propertyId, setPropertyId] = useState("");
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [savingId, setSavingId] = useState(null);
  const [savedId, setSavedId] = useState(null);

  useEffect(() => {
    fetch("/api/admin/properties")
      .then(async (r) => {
        const data = await r.json().catch(() => ({}));
        if (!r.ok) {
          throw new Error(data.error || "Properties konnten nicht geladen werden.");
        }
        return data;
      })
      .then((data) => {
        setProperties(data.properties || []);
        if (data.properties?.length) setPropertyId(data.properties[0].id);
      })
      .catch((err) => setError(err.message));
  }, []);

  useEffect(() => {
    if (!propertyId) return;
    setLoading(true);
    setError("");
    Promise.all([
      fetch(`/api/admin/services?propertyId=${encodeURIComponent(propertyId)}`).then((r) => r.json()),
      fetch(`/api/admin/catalog?propertyId=${encodeURIComponent(propertyId)}`).then((r) => r.json()),
    ])
      .then(([servicesData, catalogData]) => {
        const curated = new Map((catalogData.items || []).map((i) => [i.serviceId, i]));
        const merged = (servicesData.services || []).map((s) =>
          curated.has(s.id) ? { ...emptyRow(s), ...curated.get(s.id) } : emptyRow(s)
        );
        setRows(merged);
      })
      .catch(() => setError("Katalog konnte nicht geladen werden."))
      .finally(() => setLoading(false));
  }, [propertyId]);

  function updateRow(serviceId, patch) {
    setRows((prev) => prev.map((r) => (r.serviceId === serviceId ? { ...r, ...patch } : r)));
  }

  async function handleImageUpload(serviceId, file) {
    const formData = new FormData();
    formData.append("file", file);
    const res = await fetch("/api/admin/upload", { method: "POST", body: formData });
    const data = await res.json();
    if (!res.ok) {
      setError(data.error || "Bild-Upload fehlgeschlagen.");
      return;
    }
    updateRow(serviceId, { imageUrl: data.imageUrl });
  }

  async function saveRow(row) {
    setSavingId(row.serviceId);
    setError("");
    try {
      const res = await fetch("/api/admin/catalog", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ propertyId, item: row }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Speichern fehlgeschlagen.");
      setSavedId(row.serviceId);
      setTimeout(() => setSavedId(null), 1500);
    } catch (err) {
      setError(err.message);
    } finally {
      setSavingId(null);
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <label className="block text-sm font-medium text-slate-700">Property</label>
        <select
          value={propertyId}
          onChange={(e) => setPropertyId(e.target.value)}
          className="mt-1 w-full max-w-sm rounded-lg border border-slate-300 px-3 py-2"
        >
          {properties.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
      </div>

      {error && <p className="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">{error}</p>}
      {loading && <p className="text-sm text-slate-500">Wird geladen…</p>}

      <div className="space-y-4">
        {rows.map((row) => (
          <div key={row.serviceId} className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div>
                <p className="text-xs uppercase tracking-wide text-slate-400">{row.code}</p>
                <p className="font-semibold text-slate-800">{row.name}</p>
              </div>
              <label className="flex items-center gap-2 text-sm font-medium text-slate-700">
                <input
                  type="checkbox"
                  checked={row.active}
                  onChange={(e) => updateRow(row.serviceId, { active: e.target.checked })}
                />
                Im Gäste-Portal anzeigen
              </label>
            </div>

            <div className="mt-4 grid gap-4 sm:grid-cols-2">
              <div>
                <label className="block text-xs font-medium text-slate-500">Anzeigename</label>
                <input
                  type="text"
                  value={row.displayName}
                  onChange={(e) => updateRow(row.serviceId, { displayName: e.target.value })}
                  className="mt-1 w-full rounded-md border border-slate-300 px-3 py-1.5 text-sm"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-500">Kategorie</label>
                <input
                  type="text"
                  value={row.category}
                  onChange={(e) => updateRow(row.serviceId, { category: e.target.value })}
                  className="mt-1 w-full rounded-md border border-slate-300 px-3 py-1.5 text-sm"
                />
              </div>
              <div className="sm:col-span-2">
                <label className="block text-xs font-medium text-slate-500">Beschreibung</label>
                <textarea
                  value={row.description}
                  onChange={(e) => updateRow(row.serviceId, { description: e.target.value })}
                  rows={2}
                  className="mt-1 w-full rounded-md border border-slate-300 px-3 py-1.5 text-sm"
                />
              </div>
              <div className="flex items-center gap-4 sm:col-span-2">
                {row.imageUrl && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={row.imageUrl} alt="" className="h-16 w-16 rounded-lg object-cover" />
                )}
                <input
                  type="file"
                  accept="image/*"
                  onChange={(e) => e.target.files[0] && handleImageUpload(row.serviceId, e.target.files[0])}
                  className="text-sm"
                />
              </div>
            </div>

            <div className="mt-4 flex items-center gap-3">
              <button
                onClick={() => saveRow(row)}
                disabled={savingId === row.serviceId}
                className="rounded-md bg-brand-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-60"
              >
                {savingId === row.serviceId ? "Speichert…" : "Speichern"}
              </button>
              {savedId === row.serviceId && <span className="text-sm text-green-700">Gespeichert.</span>}
            </div>
          </div>
        ))}
        {!loading && !rows.length && propertyId && (
          <p className="text-sm text-slate-500">
            Keine als Extra verkäuflichen Services für dieses Hotel gefunden.
          </p>
        )}
      </div>
    </div>
  );
}
