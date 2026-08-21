"use client";

import { useEffect, useState } from "react";
import { formatDateTime, formatPrice } from "@/lib/format";

export default function OrdersView() {
  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    fetch("/api/admin/orders")
      .then((r) => r.json())
      .then((data) => setOrders(data.orders || []))
      .catch(() => setError("Bestellungen konnten nicht geladen werden."))
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <p className="text-sm text-slate-500">Wird geladen…</p>;
  if (error) return <p className="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">{error}</p>;
  if (!orders.length) return <p className="text-sm text-slate-500">Noch keine Bestellungen vorhanden.</p>;

  return (
    <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm">
      <table className="w-full text-sm">
        <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
          <tr>
            <th className="px-4 py-2">Datum</th>
            <th className="px-4 py-2">Reservierung</th>
            <th className="px-4 py-2">Gast</th>
            <th className="px-4 py-2">Extras</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {orders.map((order) => (
            <tr key={order.id}>
              <td className="px-4 py-2 whitespace-nowrap text-slate-500">
                {formatDateTime(order.createdAt)}
              </td>
              <td className="px-4 py-2 font-medium text-slate-800">{order.reservationId}</td>
              <td className="px-4 py-2">{order.guestName}</td>
              <td className="px-4 py-2">
                <ul className="space-y-0.5">
                  {order.items.map((item, i) => (
                    <li key={i}>
                      {item.count}x {item.displayName}{" "}
                      <span className="text-slate-400">({formatPrice(item.price)})</span>
                    </li>
                  ))}
                </ul>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
