import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import CatalogManager from "@/components/admin/CatalogManager";

export default async function CatalogPage() {
  const session = await getSession();
  if (!["admin", "manager"].includes(session.role)) {
    redirect("/admin/orders");
  }

  return (
    <div>
      <h1 className="mb-6 text-xl font-bold text-slate-800">Extras-Katalog</h1>
      <CatalogManager />
    </div>
  );
}
