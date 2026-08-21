import { NextResponse } from "next/server";
import { requireRole, ROLES, hashPassword } from "@/lib/auth";
import { listUsers, updateUser, deleteUser } from "@/lib/store";

function sanitize(user) {
  const { passwordHash, ...rest } = user;
  return rest;
}

function isLastAdmin(users, id) {
  const admins = users.filter((u) => u.role === "admin");
  return admins.length === 1 && admins[0].id === id;
}

export async function PATCH(request, { params }) {
  const { error } = await requireRole(["admin"]);
  if (error) return error;

  const { id } = await params;
  const users = await listUsers();
  const target = users.find((u) => u.id === id);
  if (!target) {
    return NextResponse.json({ error: "Benutzer nicht gefunden." }, { status: 404 });
  }

  const body = await request.json().catch(() => null);
  const updates = {};

  if (body?.role) {
    if (!ROLES.includes(body.role)) {
      return NextResponse.json({ error: "Ungültige Rolle." }, { status: 400 });
    }
    if (body.role !== "admin" && isLastAdmin(users, target.id)) {
      return NextResponse.json(
        { error: "Der letzte Admin-Account kann nicht herabgestuft werden." },
        { status: 400 }
      );
    }
    updates.role = body.role;
  }

  if (body?.password) {
    if (String(body.password).length < 8) {
      return NextResponse.json({ error: "Passwort muss mindestens 8 Zeichen haben." }, { status: 400 });
    }
    updates.passwordHash = await hashPassword(body.password);
  }

  const updated = await updateUser(target.id, updates);
  return NextResponse.json({ user: sanitize(updated) });
}

export async function DELETE(request, { params }) {
  const { error } = await requireRole(["admin"]);
  if (error) return error;

  const { id } = await params;
  const users = await listUsers();
  const target = users.find((u) => u.id === id);
  if (!target) {
    return NextResponse.json({ error: "Benutzer nicht gefunden." }, { status: 404 });
  }
  if (isLastAdmin(users, target.id)) {
    return NextResponse.json(
      { error: "Der letzte Admin-Account kann nicht gelöscht werden." },
      { status: 400 }
    );
  }

  await deleteUser(target.id);
  return NextResponse.json({ ok: true });
}
