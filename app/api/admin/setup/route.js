import { NextResponse } from "next/server";
import { listUsers, createUser } from "@/lib/store";
import { createSessionToken, setSessionCookie } from "@/lib/auth";

export async function GET() {
  const users = await listUsers();
  return NextResponse.json({ needsSetup: users.length === 0 });
}

export async function POST(request) {
  const users = await listUsers();
  if (users.length > 0) {
    return NextResponse.json(
      { error: "Die Ersteinrichtung wurde bereits abgeschlossen." },
      { status: 403 }
    );
  }

  const body = await request.json().catch(() => null);
  const username = String(body?.username || "").trim();
  const password = String(body?.password || "");

  if (!username || password.length < 8) {
    return NextResponse.json(
      { error: "Benutzername erforderlich, Passwort mindestens 8 Zeichen." },
      { status: 400 }
    );
  }

  const user = await createUser({ username, password, role: "admin" });
  const token = await createSessionToken(user);
  const response = NextResponse.json({
    id: user.id,
    username: user.username,
    role: user.role,
  });
  setSessionCookie(response, token);
  return response;
}
