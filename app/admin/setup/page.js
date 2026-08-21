import { redirect } from "next/navigation";
import { listUsers } from "@/lib/store";
import SetupForm from "@/components/admin/SetupForm";

export default async function SetupPage() {
  const users = await listUsers();
  if (users.length > 0) {
    redirect("/admin/login");
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center px-4 py-12">
      <h1 className="mb-2 text-2xl font-bold text-slate-800">Ersteinrichtung</h1>
      <p className="mb-6 text-sm text-slate-500">
        Legen Sie das erste Admin-Konto für die Verwaltung an.
      </p>
      <SetupForm />
    </main>
  );
}
