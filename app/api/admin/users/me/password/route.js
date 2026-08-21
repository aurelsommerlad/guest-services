import { NextResponse } from "next/server";
import { getSession, verifyPassword, hashPassword } from "@/lib/auth";
import { findUserById, updateUser } from "@/lib/store";

export async function PATCH(request) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Nicht angemeldet." }, { status: 401 });
  }

  const body = await request.json().catch(() => null);
  const currentPassword = String(body?.currentPassword || "");
  const newPassword = String(body?.newPassword || "");

  if (newPassword.length < 8) {
    return NextResponse.json({ error: "Neues Passwort muss mindestens 8 Zeichen haben." }, { status: 400 });
  }

  const user = await findUserById(session.id);
  const valid = user ? await verifyPassword(currentPassword, user.passwordHash) : false;
  if (!valid) {
    return NextResponse.json({ error: "Aktuelles Passwort ist falsch." }, { status: 401 });
  }

  await updateUser(user.id, { passwordHash: await hashPassword(newPassword) });
  return NextResponse.json({ ok: true });
}
