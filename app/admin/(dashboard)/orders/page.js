import OrdersView from "@/components/admin/OrdersView";

export default function OrdersPage() {
  return (
    <div>
      <h1 className="mb-6 text-xl font-bold text-slate-800">Bestellungen</h1>
      <OrdersView />
    </div>
  );
}
