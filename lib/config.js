/**
 * Resolves the app's own public base URL for building absolute links (e.g.
 * in Slack notifications). Prefers an explicit override, then Vercel's own
 * env vars, then localhost for local dev — never hardcodes a deployment
 * hostname.
 */
export function getAppBaseUrl() {
  const explicit = process.env.APP_BASE_URL;
  if (explicit) return explicit.trim().replace(/\/+$/, "");

  const vercelHost =
    process.env.VERCEL_PROJECT_PRODUCTION_URL || process.env.VERCEL_URL;
  if (vercelHost) return `https://${vercelHost}`;

  return "http://localhost:3000";
}
