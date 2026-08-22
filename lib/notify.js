import { claimSlackNotification, updateRequestRecord } from "./store";
import { getAppBaseUrl } from "./config";

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
  if (!webhookUrl) {
    console.log(
      `[notify] SLACK_REQUEST_WEBHOOK_URL nicht gesetzt - Slack-Benachrichtigung für Anfrage ${record.requestId} übersprungen.`
    );
    return;
  }

  const claimed = await claimSlackNotification(record.requestId);
  if (!claimed) {
    console.log(
      `[notify] Slack-Benachrichtigung für Anfrage ${record.requestId} wurde bereits gesendet - übersprungen.`
    );
    return;
  }

  try {
    const res = await fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(buildSlackMessage(record)),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`Slack-Webhook antwortete mit HTTP ${res.status}: ${text}`);
    }
    await updateRequestRecord(record.requestId, {
      slackNotifiedAt: new Date().toISOString(),
    });
  } catch (err) {
    console.error(
      `[notify] Slack-Benachrichtigung für Anfrage ${record.requestId} fehlgeschlagen:`,
      err
    );
  }
}
