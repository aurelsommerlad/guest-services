import { NextResponse } from "next/server";
import { requireRole } from "@/lib/auth";
import { rejectRequest } from "@/lib/requests";

export async function POST(request, { params }) {
  const { error } = await requireRole(["admin", "manager"]);
  if (error) return error;

  const { id } = await params;
  const result = await rejectRequest(id);
  if (!result.success) {
    return NextResponse.json({ error: result.error }, { status: 409 });
  }
  return NextResponse.json({ request: result.request });
}
