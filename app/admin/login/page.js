import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { listUsers } from "@/lib/store";
import LoginForm from "@/components/admin/LoginForm";

export default async function LoginPage() {
  const users = await listUsers();
  if (users.length === 0) {
    redirect("/admin/setup");
  }

  const session = await getSession();
  if (session) {
    redirect("/admin/orders");
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center px-4 py-12">
      <h1 className="mb-2 text-2xl font-bold text-slate-800">Admin-Login</h1>
      <p className="mb-6 text-sm text-slate-500">Melden Sie sich mit Ihrem Konto an.</p>
      <LoginForm />
    </main>
  );
}
