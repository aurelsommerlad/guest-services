import { NextResponse } from "next/server";
import { requireRole } from "@/lib/auth";
import { listOrders } from "@/lib/store";

export async function GET(request) {
  const { error } = await requireRole(["admin", "manager", "viewer"]);
  if (error) return error;

  const propertyId = request.nextUrl.searchParams.get("propertyId");
  const orders = await listOrders();
  const filtered = propertyId ? orders.filter((o) => o.propertyId === propertyId) : orders;
  return NextResponse.json({ orders: filtered });
}
