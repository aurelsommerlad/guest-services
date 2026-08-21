import { NextResponse } from "next/server";
import { findUserByUsername } from "@/lib/store";
import { verifyPassword, createSessionToken, setSessionCookie } from "@/lib/auth";

const INVALID_LOGIN_ERROR = "Benutzername oder Passwort ist falsch.";

export async function POST(request) {
  const body = await request.json().catch(() => null);
  const username = String(body?.username || "").trim();
  const password = String(body?.password || "");

  if (!username || !password) {
    return NextResponse.json({ error: INVALID_LOGIN_ERROR }, { status: 400 });
  }

  const user = await findUserByUsername(username);
  const valid = user ? await verifyPassword(password, user.passwordHash) : false;
  if (!valid) {
    return NextResponse.json({ error: INVALID_LOGIN_ERROR }, { status: 401 });
  }

  const token = await createSessionToken(user);
  const response = NextResponse.json({
    id: user.id,
    username: user.username,
    role: user.role,
  });
  setSessionCookie(response, token);
  return response;
}
