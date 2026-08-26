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

  try {
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
  } catch (err) {
    // A misconfigured deployment (e.g. JWT_SECRET or KV_REST_API_URL/TOKEN
    // missing for whatever environment is actually serving this request)
    // must never surface as an unhandled exception — that returns an HTML
    // error page instead of JSON, which breaks the login form's `res.json()`
    // call and looks like "login doesn't work" with no diagnosable cause.
    // Logged with the real error so Vercel's function logs show exactly
    // what's missing; the guest-facing message stays generic.
    console.error("Admin-Login fehlgeschlagen (Konfigurationsfehler?):", err);
    return NextResponse.json({ error: INVALID_LOGIN_ERROR }, { status: 500 });
  }
}
