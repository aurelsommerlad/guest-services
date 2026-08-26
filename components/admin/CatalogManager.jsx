"use client";

import { useEffect, useState } from "react";
import { DEFAULT_PRICE_UNIT_LABELS, DEFAULT_PRICE_UNIT_LABELS_EN } from "@/lib/priceDisplay";

const BOOKING_RULE_OPTIONS = [
  { value: "per_stay", label: "Einmal pro Aufenthalt" },
  { value: "per_night", label: "Pro Nacht" },
  { value: "arrival_day", label: "Am Anreisetag" },
  { value: "departure_day", label: "Am Abreisetag" },
];

const FULFILLMENT_MODE_OPTIONS = [
  { value: "instant", label: "Direkt buchbar" },
  { value: "request", label: "Auf Anfrage" },
];

// "increase_occupancy" (e.g. "Extra person"/"Zusatzperson") never books an
// Apaleo service — it amends the reservation's adult count and
// accommodation price directly (see lib/occupancyAmendment.js). Capacity
// gating and instant fulfillment are forced server-side for this type
// regardless of the checkbox/select values below (see
// app/api/admin/catalog/route.js), so the UI shows that as an
// informational note rather than an editable control.
const ACTION_TYPE_OPTIONS = [
  { value: "service", label: "Standard-Service" },
  { value: "increase_occupancy", label: "Personenanzahl erhöhen" },
];

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
    bookingRule: "per_stay",
    priceUnitLabel: "",
    fulfillmentMode: "instant",
    displayNameDe: "",
    displayNameEn: "",
    descriptionDe: "",
    descriptionEn: "",
    priceUnitLabelDe: "",
    priceUnitLabelEn: "",
    allowedUnitGroupIds: [],
    sortOrder: null,
    requiresRemainingCapacity: false,
    actionType: "service",
    extraPersonPricePerNight: null,
  };
}

export default function CatalogManager() {
  const [properties, setProperties] = useState([]);
  const [propertyId, setPropertyId] = useState("");
  const [rows, setRows] = useState([]);
  const [unitGroups, setUnitGroups] = useState([]);
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
      fetch(`/api/admin/unit-groups?propertyId=${encodeURIComponent(propertyId)}`).then((r) => r.json()),
    ])
      .then(([servicesData, catalogData, unitGroupsData]) => {
        const curated = new Map((catalogData.items || []).map((i) => [i.serviceId, i]));
        const merged = (servicesData.services || []).map((s) =>
          curated.has(s.id) ? { ...emptyRow(s), ...curated.get(s.id) } : emptyRow(s)
        );
        setRows(merged);
        setUnitGroups(unitGroupsData.unitGroups || []);
      })
      .catch(() => setError("Katalog konnte nicht geladen werden."))
      .finally(() => setLoading(false));
  }, [propertyId]);

  function updateRow(serviceId, patch) {
    setRows((prev) => prev.map((r) => (r.serviceId === serviceId ? { ...r, ...patch } : r)));
  }

  function toggleUnitGroup(row, unitGroupId) {
    const current = row.allowedUnitGroupIds || [];
    const next = current.includes(unitGroupId)
      ? current.filter((id) => id !== unitGroupId)
      : [...current, unitGroupId];
    updateRow(row.serviceId, { allowedUnitGroupIds: next });
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
              <div>
                <label className="block text-xs font-medium text-slate-500">Aktionstyp</label>
                <select
                  value={row.actionType || "service"}
                  onChange={(e) => updateRow(row.serviceId, { actionType: e.target.value })}
                  className="mt-1 w-full rounded-md border border-slate-300 px-3 py-1.5 text-sm"
                >
                  {ACTION_TYPE_OPTIONS.map((opt) => (
                    <option key={opt.value} value={opt.value}>
                      {opt.label}
                    </option>
                  ))}
                </select>
                <p className="mt-0.5 text-xs text-slate-400">
                  „Personenanzahl erhöhen“ bucht keinen Apaleo-Service, sondern erhöht die
                  Erwachsenenanzahl der Reservierung direkt (z. B. „Zusatzperson“).
                </p>
              </div>
              {row.actionType === "increase_occupancy" && (
                <div>
                  <label className="block text-xs font-medium text-slate-500">
                    Preis pro zusätzlicher Person / Nacht (€)
                  </label>
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    value={row.extraPersonPricePerNight ?? ""}
                    onChange={(e) =>
                      updateRow(row.serviceId, {
                        extraPersonPricePerNight: e.target.value === "" ? null : Number(e.target.value),
                      })
                    }
                    placeholder="z. B. 30.00"
                    className="mt-1 w-full rounded-md border border-slate-300 px-3 py-1.5 text-sm"
                  />
                </div>
              )}
              <div>
                <label className="block text-xs font-medium text-slate-500">Reihenfolge</label>
                <input
                  type="number"
                  value={row.sortOrder ?? ""}
                  onChange={(e) =>
                    updateRow(row.serviceId, { sortOrder: e.target.value === "" ? null : Number(e.target.value) })
                  }
                  placeholder="z. B. 10"
                  className="mt-1 w-full rounded-md border border-slate-300 px-3 py-1.5 text-sm"
                />
                <p className="mt-0.5 text-xs text-slate-400">
                  Steuert die Reihenfolge im Gäste-Portal (aufsteigend). Ohne Wert erscheint das Extra zuletzt.
                </p>
              </div>
              {row.actionType !== "increase_occupancy" && (
                <div>
                  <label className="block text-xs font-medium text-slate-500">Berechnung</label>
                  <select
                    value={row.bookingRule || "per_stay"}
                    onChange={(e) => updateRow(row.serviceId, { bookingRule: e.target.value })}
                    className="mt-1 w-full rounded-md border border-slate-300 px-3 py-1.5 text-sm"
                  >
                    {BOOKING_RULE_OPTIONS.map((opt) => (
                      <option key={opt.value} value={opt.value}>
                        {opt.label}
                      </option>
                    ))}
                  </select>
                </div>
              )}
              {row.actionType === "increase_occupancy" ? (
                <div>
                  <p className="block text-xs font-medium text-slate-500">Buchungsart</p>
                  <p className="mt-1 text-sm text-slate-500">
                    Immer direkt buchbar (Reservierungsänderung, keine Anfrage möglich).
                  </p>
                </div>
              ) : (
                <div>
                  <label className="block text-xs font-medium text-slate-500">Buchungsart</label>
                  <select
                    value={row.fulfillmentMode || "instant"}
                    onChange={(e) => updateRow(row.serviceId, { fulfillmentMode: e.target.value })}
                    className="mt-1 w-full rounded-md border border-slate-300 px-3 py-1.5 text-sm"
                  >
                    {FULFILLMENT_MODE_OPTIONS.map((opt) => (
                      <option key={opt.value} value={opt.value}>
                        {opt.label}
                      </option>
                    ))}
                  </select>
                </div>
              )}
              <div>
                <label className="block text-xs font-medium text-slate-500">Preiseinheit</label>
                <input
                  type="text"
                  value={row.priceUnitLabel || ""}
                  onChange={(e) => updateRow(row.serviceId, { priceUnitLabel: e.target.value })}
                  placeholder={DEFAULT_PRICE_UNIT_LABELS[row.bookingRule || "per_stay"] || ""}
                  className="mt-1 w-full rounded-md border border-slate-300 px-3 py-1.5 text-sm"
                />
              </div>
              <div className="sm:col-span-2">
                {row.actionType === "increase_occupancy" ? (
                  <p className="text-sm text-slate-500">
                    Kapazitätsprüfung ist für „Personenanzahl erhöhen“ immer aktiv — das Extra wird nur
                    angezeigt und ist nur so oft wählbar, wie in der gebuchten Apartmentkapazität noch Platz ist.
                  </p>
                ) : (
                  <>
                    <label className="flex items-center gap-2 text-sm text-slate-700">
                      <input
                        type="checkbox"
                        checked={Boolean(row.requiresRemainingCapacity)}
                        onChange={(e) => updateRow(row.serviceId, { requiresRemainingCapacity: e.target.checked })}
                      />
                      Nur bei freier Personenkapazität anzeigen
                    </label>
                    <p className="mt-0.5 text-xs text-slate-400">
                      Zeigt dieses Extra nur, solange die gebuchte Apartmentkapazität noch nicht durch
                      Erwachsene und Kinder ausgeschöpft ist.
                    </p>
                  </>
                )}
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

              <div className="sm:col-span-2">
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">
                  Sprachspezifische Überschreibung (optional)
                </p>
                <p className="mt-0.5 text-xs text-slate-400">
                  Wird nur verwendet, wenn ausgefüllt. Ohne Eintrag greift zuerst die passende Apaleo-Übersetzung,
                  dann die obigen allgemeinen Felder.
                </p>
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-500">Anzeigename (Deutsch)</label>
                <input
                  type="text"
                  value={row.displayNameDe || ""}
                  onChange={(e) => updateRow(row.serviceId, { displayNameDe: e.target.value })}
                  className="mt-1 w-full rounded-md border border-slate-300 px-3 py-1.5 text-sm"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-500">Anzeigename (Englisch)</label>
                <input
                  type="text"
                  value={row.displayNameEn || ""}
                  onChange={(e) => updateRow(row.serviceId, { displayNameEn: e.target.value })}
                  className="mt-1 w-full rounded-md border border-slate-300 px-3 py-1.5 text-sm"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-500">Beschreibung (Deutsch)</label>
                <textarea
                  value={row.descriptionDe || ""}
                  onChange={(e) => updateRow(row.serviceId, { descriptionDe: e.target.value })}
                  rows={2}
                  className="mt-1 w-full rounded-md border border-slate-300 px-3 py-1.5 text-sm"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-500">Beschreibung (Englisch)</label>
                <textarea
                  value={row.descriptionEn || ""}
                  onChange={(e) => updateRow(row.serviceId, { descriptionEn: e.target.value })}
                  rows={2}
                  className="mt-1 w-full rounded-md border border-slate-300 px-3 py-1.5 text-sm"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-500">Preiseinheit (Deutsch)</label>
                <input
                  type="text"
                  value={row.priceUnitLabelDe || ""}
                  onChange={(e) => updateRow(row.serviceId, { priceUnitLabelDe: e.target.value })}
                  placeholder={DEFAULT_PRICE_UNIT_LABELS[row.bookingRule || "per_stay"] || ""}
                  className="mt-1 w-full rounded-md border border-slate-300 px-3 py-1.5 text-sm"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-500">Preiseinheit (Englisch)</label>
                <input
                  type="text"
                  value={row.priceUnitLabelEn || ""}
                  onChange={(e) => updateRow(row.serviceId, { priceUnitLabelEn: e.target.value })}
                  placeholder={DEFAULT_PRICE_UNIT_LABELS_EN[row.bookingRule || "per_stay"] || ""}
                  className="mt-1 w-full rounded-md border border-slate-300 px-3 py-1.5 text-sm"
                />
              </div>

              <div className="sm:col-span-2">
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">
                  Verfügbar in Apartmenttypen
                </p>
                <p className="mt-0.5 text-xs text-slate-400">
                  Ohne Auswahl gilt: für alle Apartmenttypen verfügbar. Zum Einschränken (z. B. beim Extra
                  „Hund“) gezielt Apartmenttypen auswählen.
                </p>
                <label className="mt-2 flex items-center gap-2 text-sm text-slate-700">
                  <input
                    type="checkbox"
                    checked={!row.allowedUnitGroupIds?.length}
                    onChange={() => updateRow(row.serviceId, { allowedUnitGroupIds: [] })}
                  />
                  Alle Apartmenttypen
                </label>
                <div className="mt-2 grid gap-1.5 sm:grid-cols-2">
                  {unitGroups.map((g) => (
                    <label key={g.id} className="flex items-center gap-2 text-sm text-slate-700">
                      <input
                        type="checkbox"
                        checked={(row.allowedUnitGroupIds || []).includes(g.id)}
                        onChange={() => toggleUnitGroup(row, g.id)}
                      />
                      <span title={g.id}>
                        {g.name}
                        {g.code ? ` (${g.code})` : ""}
                      </span>
                    </label>
                  ))}
                  {!unitGroups.length && (
                    <p className="text-xs text-slate-400">Keine Apartmenttypen für dieses Hotel gefunden.</p>
                  )}
                </div>
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
