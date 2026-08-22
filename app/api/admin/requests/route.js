import { NextResponse } from "next/server";
import { requireRole } from "@/lib/auth";
import { listRequests } from "@/lib/store";

export async function GET(request) {
  const { error } = await requireRole(["admin", "manager", "viewer"]);
  if (error) return error;

  const propertyId = request.nextUrl.searchParams.get("propertyId");
  const requests = await listRequests();
  const filtered = propertyId ? requests.filter((r) => r.propertyId === propertyId) : requests;
  filtered.sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
  return NextResponse.json({ requests: filtered });
}
