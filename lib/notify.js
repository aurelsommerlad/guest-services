import { claimSlackNotification, releaseSlackNotificationClaim, updateRequestRecord } from "./store.js";
import { getAppBaseUrl } from "./config.js";

/**
 * Extension point for notifying the front office about a new order.
 * Runs server-side inside a real Vercel function, so it can be wired up to
 * Resend, an n8n webhook, Slack, etc. without any client-side changes.
 * For now it just logs so orders are visible in the deployment logs.
 */
export async function notifyFrontOffice(order) {
  console.log("[notify] Neue Extras-Buchung übers Gäste-Portal:", JSON.stringify(order));
}

function formatPrice(amount, currency) {
  if (amount === null || amount === undefined) return "unbekannt";
  return `${Number(amount).toFixed(2)} ${currency || "EUR"}`;
}

function buildSlackMessage(record) {
  const baseUrl = getAppBaseUrl();
  const lines = [
    "🔔 *Neue Extra-Anfrage*",
    `*Extra:* ${record.serviceName}`,
    `*Property:* ${record.propertyName || record.propertyId}`,
    `*Gast:* ${record.guestName}`,
    `*Reservierung:* ${record.reservationId}`,
  ];
  if (record.arrivalDate) lines.push(`*Anreise:* ${record.arrivalDate}`);
  if (record.departureDate) lines.push(`*Abreise:* ${record.departureDate}`);
  lines.push(`*Gewünschtes Datum:* ${record.requestedServiceDate}`);
  lines.push(`*Preis:* ${formatPrice(record.displayedPrice, record.currency)}`);
  lines.push("*Status:* Offen");

  return {
    text: `Neue Extra-Anfrage: ${record.serviceName} (${record.guestName})`,
    blocks: [
      {
        type: "section",
        text: { type: "mrkdwn", text: lines.join("\n") },
      },
      {
        type: "actions",
        elements: [
          {
            type: "button",
            text: { type: "plain_text", text: "Anfrage bearbeiten" },
            url: `${baseUrl}/admin/requests`,
          },
        ],
      },
    ],
  };
}

/**
 * Notifies the team in Slack about a newly created guest request. Must be
 * called only AFTER the request record is already persisted (see
 * lib/requests.js) — a Slack failure here must never fail the guest's
 * request submission, so every error path just logs and returns.
 *
 * Dedup: guarded by claimSlackNotification (an atomic Redis SETNX-style
 * claim keyed by requestId), so retries/duplicate invocations for the same
 * request can never send more than one notification.
 */
export async function notifyNewRequest(record) {
  const webhookUrl = process.env.SLACK_REQUEST_WEBHOOK_URL;
  console.log(`[Slack] webhook configured: ${Boolean(webhookUrl)}`);
  if (!webhookUrl) {
    console.log("SLACK_REQUEST_WEBHOOK_URL is not configured");
    return;
  }

  // Claimed only once we're actually about to attempt a send, and released
  // again if the send fails — so a genuine delivery failure (network error,
  // non-2xx from Slack) can still be retried on a later call for the same
  // requestId, instead of being permanently locked out by the dedup claim.
  const claimed = await claimSlackNotification(record.requestId);
  if (!claimed) {
    console.log(
      `[Slack] notification for requestId ${record.requestId} was already sent (or is in flight) - skipping duplicate.`
    );
    return;
  }

  console.log(`[Slack] sending notification for requestId: ${record.requestId}`);

  try {
    const res = await fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(buildSlackMessage(record)),
    });
    const text = await res.text().catch(() => "");
    console.log(`[Slack] response status: ${res.status}`);
    console.log(`[Slack] response body: ${text}`);

    if (!res.ok) {
      throw new Error(`Slack webhook responded with HTTP ${res.status}: ${text}`);
    }

    console.log("[Slack] notification sent successfully");
    await updateRequestRecord(record.requestId, {
      slackNotifiedAt: new Date().toISOString(),
    });
  } catch (err) {
    console.error(
      `[Slack] notification for requestId ${record.requestId} failed:`,
      err
    );
    // Release the claim so a genuine delivery failure isn't permanently
    // stuck as "already notified" — a later retry for the same requestId
    // (if the caller ever adds one) can still get through.
    await releaseSlackNotificationClaim(record.requestId).catch((releaseErr) => {
      console.error(
        `[Slack] failed to release notification claim for requestId ${record.requestId}:`,
        releaseErr
      );
    });
  }
}
