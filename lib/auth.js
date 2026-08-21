import { SignJWT, jwtVerify } from "jose";
import bcrypt from "bcryptjs";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";

const COOKIE_NAME = "session";
const SESSION_DURATION_SECONDS = 60 * 60 * 24 * 30; // 30 days

export const ROLES = ["admin", "manager", "viewer"];

function getSecretKey() {
  const secret = process.env.JWT_SECRET;
  if (!secret) {
    throw new Error("JWT_SECRET ist nicht gesetzt.");
  }
  return new TextEncoder().encode(secret);
}

export async function hashPassword(password) {
  return bcrypt.hash(password, 10);
}

export async function verifyPassword(password, hash) {
  if (!hash) return false;
  return bcrypt.compare(password, hash);
}

export async function createSessionToken(user) {
  return new SignJWT({
    username: user.username,
    role: user.role,
  })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(user.id)
    .setIssuedAt()
    .setExpirationTime(`${SESSION_DURATION_SECONDS}s`)
    .sign(getSecretKey());
}

export async function verifySessionToken(token) {
  try {
    const { payload } = await jwtVerify(token, getSecretKey());
    return payload;
  } catch {
    return null;
  }
}

/**
 * Reads and verifies the session cookie for the current request.
 * Returns null when there is no valid session — callers decide how to
 * respond (this never throws for "not logged in").
 */
export async function getSession() {
  const cookieStore = await cookies();
  const token = cookieStore.get(COOKIE_NAME)?.value;
  if (!token) return null;
  const payload = await verifySessionToken(token);
  if (!payload) return null;
  return { id: payload.sub, username: payload.username, role: payload.role };
}

export function setSessionCookie(response, token) {
  response.cookies.set(COOKIE_NAME, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_DURATION_SECONDS,
  });
}

export function clearSessionCookie(response) {
  response.cookies.set(COOKIE_NAME, "", {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 0,
  });
}

/**
 * Server-side role gate for API route handlers. Every admin route must call
 * this itself — role checks are never left to the frontend alone.
 * Returns the session on success, or writes an error response and returns
 * null on failure (checked by the caller with `if (!session) return res`).
 */
export async function requireRole(allowedRoles) {
  const session = await getSession();
  if (!session) {
    return { session: null, error: NextResponse.json({ error: "Nicht angemeldet." }, { status: 401 }) };
  }
  if (!allowedRoles.includes(session.role)) {
    return {
      session: null,
      error: NextResponse.json({ error: "Keine Berechtigung für diese Aktion." }, { status: 403 }),
    };
  }
  return { session, error: null };
}
