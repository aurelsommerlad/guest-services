import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import UsersManager from "@/components/admin/UsersManager";

export default async function UsersPage() {
  const session = await getSession();
  if (session.role !== "admin") {
    redirect("/admin/orders");
  }

  return (
    <div>
      <h1 className="mb-6 text-xl font-bold text-slate-800">Benutzerverwaltung</h1>
      <UsersManager currentUserId={session.id} />
    </div>
  );
}
