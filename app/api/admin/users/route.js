import { NextResponse } from "next/server";
import { requireRole, ROLES } from "@/lib/auth";
import { listUsers, createUser } from "@/lib/store";

function sanitize(user) {
  const { passwordHash, ...rest } = user;
  return rest;
}

export async function GET() {
  const { error } = await requireRole(["admin"]);
  if (error) return error;

  const users = await listUsers();
  return NextResponse.json({ users: users.map(sanitize) });
}

export async function POST(request) {
  const { error } = await requireRole(["admin"]);
  if (error) return error;

  const body = await request.json().catch(() => null);
  const username = String(body?.username || "").trim();
  const password = String(body?.password || "");
  const role = String(body?.role || "");

  if (!username || password.length < 8 || !ROLES.includes(role)) {
    return NextResponse.json(
      { error: "Benutzername, Passwort (min. 8 Zeichen) und eine gültige Rolle sind erforderlich." },
      { status: 400 }
    );
  }

  try {
    const user = await createUser({ username, password, role });
    return NextResponse.json({ user: sanitize(user) });
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 409 });
  }
}
