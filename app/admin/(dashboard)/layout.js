import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import DashboardNav from "@/components/admin/DashboardNav";

export default async function DashboardLayout({ children }) {
  const session = await getSession();
  if (!session) {
    redirect("/admin/login");
  }

  return (
    <div className="min-h-screen bg-slate-50">
      <DashboardNav session={session} />
      <main className="mx-auto max-w-5xl px-4 py-8">{children}</main>
    </div>
  );
}
