import { handleBridgeRequest } from "@/lib/stayBridge/guard";
import { bridgeOrder } from "@/lib/stayBridge/service";

// Internal STAY bridge – server-to-server only (see lib/stayBridge/guard.js).
export const dynamic = "force-dynamic";

export async function POST(request) {
  return handleBridgeRequest(request, { action: "order", scope: "write", handler: bridgeOrder });
}
