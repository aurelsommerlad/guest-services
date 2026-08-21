export function formatPrice(value) {
  if (value === null || value === undefined) return "–";
  const amount = typeof value === "number" ? value : value.amount;
  const currency = typeof value === "number" ? "EUR" : value.currency || "EUR";
  if (amount === undefined || amount === null || Number.isNaN(amount)) return "–";
  return new Intl.NumberFormat("de-DE", { style: "currency", currency }).format(amount);
}

export function formatDate(dateStr) {
  if (!dateStr) return "";
  const date = new Date(dateStr);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat("de-DE", { dateStyle: "medium" }).format(date);
}

export function formatDateTime(date) {
  const value = date instanceof Date ? date : new Date(date);
  if (Number.isNaN(value.getTime())) return "";
  return new Intl.DateTimeFormat("de-DE", {
    dateStyle: "short",
    timeStyle: "short",
  }).format(value);
}
