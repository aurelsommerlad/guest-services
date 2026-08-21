/**
 * Extension point for notifying the front office about a new order.
 * Runs server-side inside a real Vercel function, so it can be wired up to
 * Resend, an n8n webhook, Slack, etc. without any client-side changes.
 * For now it just logs so orders are visible in the deployment logs.
 */
export async function notifyFrontOffice(order) {
  console.log("[notify] Neue Extras-Buchung übers Gäste-Portal:", JSON.stringify(order));
}
