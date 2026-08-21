import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { listUsers } from "@/lib/store";

export default async function AdminIndexPage() {
  const users = await listUsers();
  if (users.length === 0) {
    redirect("/admin/setup");
  }

  const session = await getSession();
  if (!session) {
    redirect("/admin/login");
  }

  redirect("/admin/orders");
}
