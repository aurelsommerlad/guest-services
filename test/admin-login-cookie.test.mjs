// Regression tests for the admin login flow's session cookie — written
// after a report that admin login worked on the *.vercel.app domain but
// failed on the extras.unique-places.com custom domain. Verifies the
// cookie itself is domain-agnostic (host-only, no hardcoded Domain
// attribute, correct Path/HttpOnly/SameSite) so it works on ANY host the
// app is served from, that the session actually persists across a
// subsequent request using that cookie, that logout clears it, and that a
// misconfigured deployment (missing JWT_SECRET) degrades to a clean JSON
// error instead of an unhandled exception (see app/api/admin/login/route.js).
//
// Runs against a real `next dev` server using the local JSON fallback DB —
// no Apaleo credentials needed, since none of these routes call Apaleo.
//
// Run with: npm test

import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { rm, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import bcrypt from "bcryptjs";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const PORT = 3923;
const PORT_NO_SECRET = 3924;
const BASE_URL = `http://localhost:${PORT}`;
const BASE_URL_NO_SECRET = `http://localhost:${PORT_NO_SECRET}`;
const READY_TIMEOUT_MS = 60_000;
const DATA_DIR = path.join(ROOT, ".data");

async function waitForServer(base, deadline) {
  while (Date.now() < deadline) {
    try {
      const res = await fetch(base);
      if (res.ok || res.status === 404) return;
    } catch {
      // not up yet
    }
    await new Promise((r) => setTimeout(r, 300));
  }
  throw new Error(`Server at ${base} did not become ready within ${READY_TIMEOUT_MS}ms`);
}

function startServer(port, extraEnv = {}) {
  const nextBin = path.join(ROOT, "node_modules", ".bin", "next");
  return spawn(nextBin, ["dev", "-p", String(port)], {
    cwd: ROOT,
    env: {
      ...process.env,
      KV_REST_API_URL: "",
      KV_REST_API_TOKEN: "",
      ...extraEnv,
    },
    stdio: "pipe",
  });
}

/** Parses a single Set-Cookie header into { value, attrs }. */
function parseSetCookie(setCookieHeader) {
  const parts = (setCookieHeader || "").split(";").map((p) => p.trim());
  const [nameValue, ...attrParts] = parts;
  const [name, value] = nameValue.split("=");
  const attrs = attrParts.map((a) => a.toLowerCase());
  return { name, value, attrs };
}

test("admin login: session cookie is host-only, correctly flagged, and the session persists", async () => {
  await rm(DATA_DIR, { recursive: true, force: true });

  const server = startServer(PORT, { JWT_SECRET: "test-secret-for-admin-login-cookie-test" });
  try {
    await waitForServer(BASE_URL, Date.now() + READY_TIMEOUT_MS);

    const setupRes = await fetch(`${BASE_URL}/api/admin/setup`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: "cookie-test-admin", password: "regression-test-password" }),
    });
    assert.equal(setupRes.status, 200, `setup failed: ${await setupRes.text()}`);

    // The actual login flow under test — a fresh POST with credentials,
    // exactly what the login form does.
    const loginRes = await fetch(`${BASE_URL}/api/admin/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: "cookie-test-admin", password: "regression-test-password" }),
    });
    assert.equal(loginRes.status, 200, `login failed: ${await loginRes.text()}`);

    const setCookieHeader = loginRes.headers.get("set-cookie");
    assert.ok(setCookieHeader, "login response must set a cookie");
    const { name, attrs } = parseSetCookie(setCookieHeader);

    assert.equal(name, "session");
    assert.ok(attrs.includes("path=/"), `expected Path=/, got: ${setCookieHeader}`);
    assert.ok(attrs.includes("httponly"), `expected HttpOnly, got: ${setCookieHeader}`);
    assert.ok(attrs.includes("samesite=lax"), `expected SameSite=Lax, got: ${setCookieHeader}`);
    // The critical assertion for the reported bug: no Domain attribute at
    // all (not vercel.app, not the custom domain, not anything) — a
    // host-only cookie works on whatever host actually served the
    // response, which is exactly what makes it domain-agnostic.
    assert.ok(
      !attrs.some((a) => a.startsWith("domain=")),
      `cookie must be host-only (no Domain attribute), got: ${setCookieHeader}`
    );
    // `next dev` always runs with NODE_ENV=development, so Secure is
    // correctly absent here; lib/auth.js sets secure: NODE_ENV==="production",
    // so this is only asserting dev behavior is intentionally non-Secure.
    assert.ok(!attrs.includes("secure"), "Secure must be absent outside production (next dev)");

    const cookie = `${name}=${parseSetCookie(setCookieHeader).value}`;

    // Session must persist: a subsequent request using only the cookie
    // (like a real page load / API call after redirect) must be
    // authenticated, not bounced back to "not logged in".
    const usersRes = await fetch(`${BASE_URL}/api/admin/users`, {
      headers: { Cookie: cookie },
    });
    assert.equal(usersRes.status, 200, "session must be recognized on the next request");
    const usersBody = await usersRes.json();
    assert.ok(
      usersBody.users?.some((u) => u.username === "cookie-test-admin"),
      "authenticated request must see the actual admin data"
    );

    // No cookie at all -> must be rejected (sanity check that the gate is real).
    const noCookieRes = await fetch(`${BASE_URL}/api/admin/users`);
    assert.equal(noCookieRes.status, 401);

    // Logout must instruct the browser to drop the cookie immediately
    // (Max-Age=0) — sessions here are stateless JWTs with no server-side
    // revocation list, so this is the actual, correct definition of
    // "cleared" for this app's design: the browser stops sending it, not
    // that the token itself becomes cryptographically invalid if replayed.
    const logoutRes = await fetch(`${BASE_URL}/api/admin/logout`, {
      method: "POST",
      headers: { Cookie: cookie },
    });
    assert.equal(logoutRes.status, 200);
    const logoutSetCookie = logoutRes.headers.get("set-cookie");
    const { attrs: logoutAttrs } = parseSetCookie(logoutSetCookie);
    assert.ok(
      logoutAttrs.some((a) => a.startsWith("max-age=0")),
      `logout must expire the cookie immediately, got: ${logoutSetCookie}`
    );
  } finally {
    server.kill("SIGTERM");
    await rm(DATA_DIR, { recursive: true, force: true });
  }
});

test("admin login: a misconfigured deployment (missing JWT_SECRET) fails cleanly instead of an unhandled exception", async () => {
  await rm(DATA_DIR, { recursive: true, force: true });

  // Seed a user directly in the local JSON DB (bypassing /api/admin/setup,
  // which itself also needs JWT_SECRET to sign the first-login token) so
  // login has real credentials to check before it reaches the JWT step.
  await mkdir(DATA_DIR, { recursive: true });
  const passwordHash = await bcrypt.hash("regression-test-password", 10);
  await writeFile(
    path.join(DATA_DIR, "db.json"),
    JSON.stringify({
      users: [
        {
          id: "seeded-admin-id",
          username: "no-secret-admin",
          passwordHash,
          role: "admin",
          createdAt: new Date(0).toISOString(),
        },
      ],
    }),
    "utf8"
  );

  // JWT_SECRET intentionally omitted entirely.
  const server = startServer(PORT_NO_SECRET, { JWT_SECRET: "" });
  try {
    await waitForServer(BASE_URL_NO_SECRET, Date.now() + READY_TIMEOUT_MS);

    const loginRes = await fetch(`${BASE_URL_NO_SECRET}/api/admin/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: "no-secret-admin", password: "regression-test-password" }),
    });

    // Must be a clean, parseable JSON error (not a raw 500 HTML error page
    // that would make the login form's `res.json()` call itself throw).
    assert.equal(loginRes.status, 500);
    const body = await loginRes.json();
    assert.ok(typeof body.error === "string" && body.error.length > 0);
    assert.ok(!loginRes.headers.get("set-cookie"), "no session cookie must be set on failure");
  } finally {
    server.kill("SIGTERM");
    await rm(DATA_DIR, { recursive: true, force: true });
  }
});
