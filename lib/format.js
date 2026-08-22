// `language` is an optional last parameter, defaulting to "de" everywhere —
// every existing call site (admin pages, orders/requests views, server-side
// comment text) keeps behaving exactly as before. Only the guest-facing
// frontend passes "en" when that's the guest's selected language.
const LOCALES = { de: "de-DE", en: "en-GB" };

function resolveLocale(language) {
  return LOCALES[language] || LOCALES.de;
}

export function formatPrice(value, language = "de") {
  if (value === null || value === undefined) return "–";
  const amount = typeof value === "number" ? value : value.amount;
  const currency = typeof value === "number" ? "EUR" : value.currency || "EUR";
  if (amount === undefined || amount === null || Number.isNaN(amount)) return "–";
  return new Intl.NumberFormat(resolveLocale(language), { style: "currency", currency }).format(amount);
}

export function formatDate(dateStr, language = "de") {
  if (!dateStr) return "";
  const date = new Date(dateStr);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat(resolveLocale(language), { dateStyle: "medium" }).format(date);
}

export function formatDateTime(date, language = "de") {
  const value = date instanceof Date ? date : new Date(date);
  if (Number.isNaN(value.getTime())) return "";
  return new Intl.DateTimeFormat(resolveLocale(language), {
    dateStyle: "short",
    timeStyle: "short",
  }).format(value);
}
