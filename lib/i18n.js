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

  adultSingular: "Erwachsener",
  adultsPlural: "Erwachsene",
  childSingular: "Kind",
  childrenPlural: "Kinder",

  searchNumberLabel: "Buchungsnummer",
  searchNumberHelperText: "UNIQUE PLACES-, Booking.com- oder andere Buchungsnummer",
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
    "Einige Positionen konnten nicht gebucht werden – bitte wende Dich für diese an UNIQUE PLACES.",
  restartButton: "Neue Suche",

  pastStayMessage:
    "Diese Reservierung liegt bereits in der Vergangenheit. Über das Portal können daher keine weiteren Extras mehr gebucht werden – bitte wende Dich an UNIQUE PLACES.",
  noItemsMessage: "Für Deine Reservierung sind aktuell keine Extras verfügbar.",

  // Deliberately distinct from the generic "nicht verfügbar" wording — this
  // fires only when an extra is restricted to specific Apaleo unit groups
  // (apartment types) and the reservation's booked type isn't one of them.
  // The literal text is dog-specific per the current use case; every
  // catalog extra uses this same message when unitGroupRestricted is true
  // (see lib/unitGroupRestriction.js) — the restriction itself is never
  // inferred from a service's code/name, only from its configured
  // allowedUnitGroupIds.
  unitGroupRestrictedMessage: "In Deinem gebuchten Apartment sind Hunde leider nicht erlaubt.",

  // Booking-time re-check only (see lib/guest.js's placeGuestOrder) — the
  // catalog's quantity selector already caps at remaining capacity, so this
  // fires only when capacity changed between page load and submission
  // (requiresRemainingCapacity, e.g. "Extra person"/"Zusatzperson").
  capacityExceededError: "Für diese Buchung ist keine weitere Person mehr möglich.",

  // Shown inline (see components/guest/GuestApp.jsx) whenever an
  // actionType "increase_occupancy" item ("Extra person"/"Zusatzperson")
  // has a selected quantity > 0 — makes explicit, before submission, that
  // this amends the reservation itself rather than booking a regular extra.
  extraPersonAmendmentNotice: "Die zusätzliche Person wird Deiner Reservierung hinzugefügt.",

  // requiresVehicleRegistration items (e.g. parking) — see
  // lib/vehicleRegistration.js. licensePlateLabel is suffixed with a number
  // ("Kennzeichen 1", "Kennzeichen 2", ...) client-side once quantity > 1.
  licensePlateLabel: "Kennzeichen",
  licensePlatePlaceholder: "z. B. LI-UP 123",
  // Booking-time re-check only (see lib/guest.js's placeGuestOrder) — the
  // guest-facing quantity stepper already blocks submission with an
  // incomplete plate, so this fires only if that changed between page load
  // and submission.
  licensePlateRequiredError: "Bitte gib das Kennzeichen des Fahrzeugs an.",

  genericError: "Es ist ein Fehler aufgetreten.",
  lookupError:
    "Wir konnten keine passende Reservierung finden. Bitte überprüfe Deine Eingaben oder wende Dich an UNIQUE PLACES.",
  lookupAmbiguousError:
    "Deine Buchung konnte nicht eindeutig gefunden werden. Bitte wende Dich an UNIQUE PLACES.",
  tooManyAttemptsError: "Zu viele Versuche. Bitte versuche es später erneut.",
  searchUnavailableError:
    "Die Suche ist aktuell nicht möglich. Bitte versuche es später erneut oder wende Dich an UNIQUE PLACES.",
  catalogLoadError: "Der Extras-Katalog konnte nicht geladen werden. Bitte versuche es später erneut.",
  selectAtLeastOneError: "Bitte wähle mindestens eine Zusatzleistung aus.",
  bookingFailedError:
    "Die Buchung konnte nicht durchgeführt werden. Bitte versuche es erneut oder wende Dich an UNIQUE PLACES.",
  selectRequestItemError: "Bitte wähle eine Zusatzleistung aus, für die Du eine Anfrage senden möchtest.",
  requestFailedError:
    "Deine Anfrage konnte nicht gesendet werden. Bitte versuche es erneut oder wende Dich an UNIQUE PLACES.",

  // "Stay one more night" upsell — never an Apaleo service, it extends the
  // reservation's actual departure date (see lib/stayExtension.js /
  // lib/guest.js). Rendered as its own distinct card, never mixed into the
  // regular extras cart.
  stayExtensionTitle: "Eine Nacht länger bleiben",
  stayExtensionSubtitle: "Verlängere Deinen Aufenthalt ganz unkompliziert um eine Nacht.",
  stayExtensionNewDepartureLabel: "Neue Abreise",
  // One compact badge, concatenated in components/guest/GuestApp.jsx as
  // `{discountPercent}{discountSuffix} · {savingsPrefix}{amount}{savingsSuffix}`
  // -> "15 % günstiger · 25,05 € sparen". Shown directly under the
  // accommodation line only — never implies the discount applies to
  // extras/city tax below it.
  stayExtensionDiscountSuffix: " % günstiger",
  stayExtensionAccommodationLabel: "Verlängerungsnacht",
  // German puts the amount before the verb ("25,05 € sparen"), so the
  // prefix is empty and the suffix carries the word.
  stayExtensionSavingsPrefix: "",
  stayExtensionSavingsSuffix: " sparen",
  stayExtensionCityTaxLabel: "Gästetaxe",
  stayExtensionTotalLabel: "Gesamt",
  stayExtensionButton: "AUFENTHALT VERLÄNGERN",
  stayExtensionButtonLoading: "Wird verlängert…",
  stayExtensionSuccessMessage: "Dein Aufenthalt wurde erfolgreich verlängert.",
  // Real-time revalidation only (see lib/guest.js's confirmStayExtension) —
  // the offer was valid when the page loaded but is re-checked fresh
  // immediately before confirming.
  stayExtensionUnavailableError: "Die Verlängerungsnacht ist inzwischen leider nicht mehr verfügbar.",
  stayExtensionFailedError:
    "Die Verlängerung konnte nicht durchgeführt werden. Bitte versuche es erneut oder wende Dich an UNIQUE PLACES.",
};

const en = {
  pageTitle: "Your extras",
  pageSubtitle: "Easily add additional services to your reservation.",

  adultSingular: "Adult",
  adultsPlural: "Adults",
  childSingular: "Child",
  childrenPlural: "Children",

  searchNumberLabel: "Booking number",
  searchNumberHelperText: "UNIQUE PLACES, Booking.com or other booking reference",
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
  confirmationPartialFailure: "Some items could not be booked – please contact UNIQUE PLACES for these.",
  restartButton: "New search",

  pastStayMessage:
    "This reservation is already in the past. No further extras can be booked through the portal – please contact UNIQUE PLACES.",
  noItemsMessage: "No extras are currently available for your reservation.",

  unitGroupRestrictedMessage: "Unfortunately, dogs are not allowed in your booked apartment.",

  capacityExceededError: "No additional guest can be added to this booking.",

  extraPersonAmendmentNotice: "The additional guest will be added to your reservation.",

  licensePlateLabel: "License plate",
  licensePlatePlaceholder: "e.g. LI-UP 123",
  licensePlateRequiredError: "Please enter the vehicle's license plate.",

  genericError: "Something went wrong.",
  lookupError: "We couldn't find a matching reservation. Please check your details or contact UNIQUE PLACES.",
  lookupAmbiguousError: "We couldn't uniquely identify your booking. Please contact UNIQUE PLACES.",
  tooManyAttemptsError: "Too many attempts. Please try again later.",
  searchUnavailableError: "Search is currently unavailable. Please try again later or contact UNIQUE PLACES.",
  catalogLoadError: "The extras catalog could not be loaded. Please try again later.",
  selectAtLeastOneError: "Please select at least one extra.",
  bookingFailedError: "The booking could not be completed. Please try again or contact UNIQUE PLACES.",
  selectRequestItemError: "Please select an extra you'd like to send a request for.",
  requestFailedError: "Your request could not be sent. Please try again or contact UNIQUE PLACES.",

  stayExtensionTitle: "Stay one more night",
  stayExtensionSubtitle: "Extend your stay by one more night.",
  stayExtensionNewDepartureLabel: "New departure",
  stayExtensionDiscountSuffix: "% less",
  stayExtensionAccommodationLabel: "Additional night",
  // English puts the verb before the amount ("Save €25.05"), so the prefix
  // carries the word and the suffix is empty.
  stayExtensionSavingsPrefix: "Save ",
  stayExtensionSavingsSuffix: "",
  stayExtensionCityTaxLabel: "City tax",
  stayExtensionTotalLabel: "Total",
  stayExtensionButton: "EXTEND STAY",
  stayExtensionButtonLoading: "Extending…",
  stayExtensionSuccessMessage: "Your stay has been successfully extended.",
  stayExtensionUnavailableError: "Unfortunately, the additional night is no longer available.",
  stayExtensionFailedError: "The extension could not be completed. Please try again or contact UNIQUE PLACES.",
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

/**
 * "2 Erwachsene" or "2 Erwachsene · 1 Kind" (and the English equivalents) —
 * used by the compact reservation summary. Children are omitted entirely
 * when there are none, never shown as "0 Kinder".
 */
export function translateGuestCounts(language, adults, children) {
  const adultsLabel = adults === 1 ? t(language, "adultSingular") : t(language, "adultsPlural");
  const adultsText = `${adults} ${adultsLabel}`;
  if (!children) return adultsText;
  const childrenLabel = children === 1 ? t(language, "childSingular") : t(language, "childrenPlural");
  return `${adultsText} · ${children} ${childrenLabel}`;
}
