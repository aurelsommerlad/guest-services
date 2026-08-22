// Central translation dictionary for the guest-facing frontend. Kept
// dependency-free (like lib/format.js / lib/priceDisplay.js) so it can be
// imported from both client components (components/guest/GuestApp.jsx) and
// server code (the guest API routes, for localized error messages) without
// pulling in lib/db.js's KV/Redis setup — and so it's unit-testable with
// plain `node --test`.
//
// The admin area is explicitly out of scope: it stays German-only.

export const LANGUAGES = ["de", "en"];
export const DEFAULT_LANGUAGE = "de";

/** Narrows an arbitrary value down to a supported language, defaulting to German. */
export function resolveLanguage(language) {
  return LANGUAGES.includes(language) ? language : DEFAULT_LANGUAGE;
}

const de = {
  pageTitle: "Deine Extras",
  pageSubtitle: "Füge ganz bequem Zusatzleistungen zu Deiner Reservierung hinzu.",

  searchNumberLabel: "Reservierungs- oder Buchungsnummer",
  searchNumberPlaceholder: "z. B. 1234567",
  searchLastNameLabel: "Nachname",
  searchLastNamePlaceholder: "Dein Nachname",
  searchButton: "Reservierung finden",
  searchButtonLoading: "Wird gesucht…",

  multipleReservationsHint: "Wir haben mehrere Reservierungen gefunden. Bitte wähle die passende aus:",
  reservationLabel: "Reservierung",

  decreaseQuantity: "Menge verringern",
  increaseQuantity: "Menge erhöhen",
  nights: "Nächte",

  onRequestBadge: "Auf Anfrage",
  requestButton: "Anfragen",
  requestExplanation: "Wir prüfen die Verfügbarkeit und melden uns bei Dir.",
  requestNamePlaceholder: "Dein Name",
  requestEmailPlaceholder: "E-Mail (optional)",
  requestSendButton: "Anfrage senden",
  requestSendingButton: "Wird gesendet…",
  requestSentTitle: "Deine Anfrage wurde gesendet.",
  ifConfirmed: "falls bestätigt",

  guestNamePlaceholder: "Dein Name (für die Buchung)",
  extraSelectedSingular: "Extra ausgewählt",
  extraSelectedPlural: "Extras ausgewählt",
  totalPriceLabel: "Gesamtpreis",
  vatIncluded: "inkl. MwSt.",
  bookNowButton: "Jetzt buchen",
  bookingButton: "Wird gebucht…",

  confirmationTitle: "Vielen Dank!",
  confirmationBody: "Deine Extras wurden erfolgreich zu Deiner Buchung hinzugefügt:",
  confirmationPartialFailure:
    "Einige Positionen konnten nicht gebucht werden – bitte wende Dich für diese an die Rezeption.",
  restartButton: "Neue Suche",

  pastStayMessage:
    "Diese Reservierung liegt bereits in der Vergangenheit. Über das Portal können daher keine weiteren Extras mehr gebucht werden – bitte wende Dich an die Rezeption.",
  noItemsMessage: "Für Deine Reservierung sind aktuell keine Extras verfügbar.",

  genericError: "Es ist ein Fehler aufgetreten.",
  lookupError:
    "Wir konnten keine passende Reservierung finden. Bitte überprüfe Deine Eingaben oder wende Dich an die Rezeption.",
  searchUnavailableError:
    "Die Suche ist aktuell nicht möglich. Bitte versuche es später erneut oder wende Dich an die Rezeption.",
  catalogLoadError: "Der Extras-Katalog konnte nicht geladen werden. Bitte versuche es später erneut.",
  selectAtLeastOneError: "Bitte wähle mindestens eine Zusatzleistung aus.",
  bookingFailedError:
    "Die Buchung konnte nicht durchgeführt werden. Bitte versuche es erneut oder wende Dich an die Rezeption.",
  selectRequestItemError: "Bitte wähle eine Zusatzleistung aus, für die Du eine Anfrage senden möchtest.",
  requestFailedError:
    "Deine Anfrage konnte nicht gesendet werden. Bitte versuche es erneut oder wende Dich an die Rezeption.",
};

const en = {
  pageTitle: "Your extras",
  pageSubtitle: "Easily add additional services to your reservation.",

  searchNumberLabel: "Reservation or booking number",
  searchNumberPlaceholder: "e.g. 1234567",
  searchLastNameLabel: "Last name",
  searchLastNamePlaceholder: "Your last name",
  searchButton: "Find reservation",
  searchButtonLoading: "Searching…",

  multipleReservationsHint: "We found several reservations. Please choose the right one:",
  reservationLabel: "Reservation",

  decreaseQuantity: "Decrease quantity",
  increaseQuantity: "Increase quantity",
  nights: "nights",

  onRequestBadge: "On request",
  requestButton: "Request",
  requestExplanation: "We'll check availability and get back to you.",
  requestNamePlaceholder: "Your name",
  requestEmailPlaceholder: "Email (optional)",
  requestSendButton: "Send request",
  requestSendingButton: "Sending…",
  requestSentTitle: "Your request has been sent.",
  ifConfirmed: "if confirmed",

  guestNamePlaceholder: "Your name (for the booking)",
  extraSelectedSingular: "extra selected",
  extraSelectedPlural: "extras selected",
  totalPriceLabel: "Total price",
  vatIncluded: "incl. VAT",
  bookNowButton: "Book now",
  bookingButton: "Booking…",

  confirmationTitle: "Thank you!",
  confirmationBody: "Your extras have been successfully added to your booking:",
  confirmationPartialFailure: "Some items could not be booked – please contact the front desk for these.",
  restartButton: "New search",

  pastStayMessage:
    "This reservation is already in the past. No further extras can be booked through the portal – please contact the front desk.",
  noItemsMessage: "No extras are currently available for your reservation.",

  genericError: "Something went wrong.",
  lookupError: "We couldn't find a matching reservation. Please check your details or contact the front desk.",
  searchUnavailableError: "Search is currently unavailable. Please try again later or contact the front desk.",
  catalogLoadError: "The extras catalog could not be loaded. Please try again later.",
  selectAtLeastOneError: "Please select at least one extra.",
  bookingFailedError: "The booking could not be completed. Please try again or contact the front desk.",
  selectRequestItemError: "Please select an extra you'd like to send a request for.",
  requestFailedError: "Your request could not be sent. Please try again or contact the front desk.",
};

export const translations = { de, en };

/** Translates `key` in `language`, falling back to German, then to the raw key. */
export function t(language, key) {
  const lang = resolveLanguage(language);
  return translations[lang][key] ?? translations[DEFAULT_LANGUAGE][key] ?? key;
}

/** "1 Extra ausgewählt" vs "2 Extras ausgewählt" (and the English equivalents). */
export function translateExtraCount(language, count) {
  const label = count === 1 ? t(language, "extraSelectedSingular") : t(language, "extraSelectedPlural");
  return `${count} ${label}`;
}
