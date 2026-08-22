"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";

const NAV_ITEMS = [
  { href: "/admin/orders", label: "Bestellungen", roles: ["admin", "manager", "viewer"] },
  { href: "/admin/requests", label: "Anfragen", roles: ["admin", "manager", "viewer"] },
  { href: "/admin/catalog", label: "Katalog", roles: ["admin", "manager"] },
  { href: "/admin/users", label: "Benutzer", roles: ["admin"] },
];

function ChangePasswordForm({ onClose }) {
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [error, setError] = useState("");
  const [ok, setOk] = useState(false);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/admin/users/me/password", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ currentPassword, newPassword }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Fehler beim Ändern des Passworts.");
      setOk(true);
      setCurrentPassword("");
      setNewPassword("");
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="absolute right-0 top-full z-20 mt-2 w-72 space-y-3 rounded-lg border border-slate-200 bg-white p-4 shadow-lg"
    >
      <p className="text-sm font-semibold text-slate-700">Passwort ändern</p>
      <input
        type="password"
        placeholder="Aktuelles Passwort"
        required
        value={currentPassword}
        onChange={(e) => setCurrentPassword(e.target.value)}
        className="w-full rounded-md border border-slate-300 px-3 py-1.5 text-sm"
      />
      <input
        type="password"
        placeholder="Neues Passwort (min. 8 Zeichen)"
        required
        minLength={8}
        value={newPassword}
        onChange={(e) => setNewPassword(e.target.value)}
        className="w-full rounded-md border border-slate-300 px-3 py-1.5 text-sm"
      />
      {error && <p className="text-xs text-red-600">{error}</p>}
      {ok && <p className="text-xs text-green-700">Passwort wurde geändert.</p>}
      <div className="flex justify-end gap-2">
        <button
          type="button"
          onClick={onClose}
          className="rounded-md px-3 py-1.5 text-sm text-slate-500 hover:bg-slate-100"
        >
          Schließen
        </button>
        <button
          type="submit"
          disabled={loading}
          className="rounded-md bg-brand-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-60"
        >
          Speichern
        </button>
      </div>
    </form>
  );
}

export default function DashboardNav({ session }) {
  const pathname = usePathname();
  const router = useRouter();
  const [showPasswordForm, setShowPasswordForm] = useState(false);
  const [pendingRequestCount, setPendingRequestCount] = useState(0);

  useEffect(() => {
    if (!["admin", "manager", "viewer"].includes(session.role)) return;
    let cancelled = false;
    fetch("/api/admin/requests")
      .then((r) => r.json())
      .then((data) => {
        if (cancelled) return;
        const pending = (data.requests || []).filter((r) => r.status === "pending").length;
        setPendingRequestCount(pending);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [session.role, pathname]);

  async function handleLogout() {
    await fetch("/api/admin/logout", { method: "POST" });
    router.push("/admin/login");
    router.refresh();
  }

  const items = NAV_ITEMS.filter((item) => item.roles.includes(session.role));

  return (
    <nav className="border-b border-slate-200 bg-white">
      <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-3 px-4 py-3">
        <div className="flex flex-wrap items-center gap-1">
          {items.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className={`rounded-md px-3 py-2 text-sm font-medium transition ${
                pathname === item.href
                  ? "bg-brand-100 text-brand-800"
                  : "text-slate-600 hover:bg-slate-100"
              }`}
            >
              {item.label}
              {item.href === "/admin/requests" && pendingRequestCount > 0
                ? ` (${pendingRequestCount})`
                : ""}
            </Link>
          ))}
        </div>
        <div className="relative flex items-center gap-3 text-sm">
          <button
            onClick={() => setShowPasswordForm((v) => !v)}
            className="text-slate-600 hover:text-brand-700"
          >
            {session.username} <span className="text-slate-400">({session.role})</span>
          </button>
          {showPasswordForm && (
            <ChangePasswordForm onClose={() => setShowPasswordForm(false)} />
          )}
          <button
            onClick={handleLogout}
            className="rounded-md border border-slate-300 px-3 py-1.5 font-medium text-slate-600 hover:bg-slate-100"
          >
            Abmelden
          </button>
        </div>
      </div>
    </nav>
  );
}
