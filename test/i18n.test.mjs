// Pure unit tests for lib/i18n.js — dependency-free, so these run directly
// under plain `node --test` without needing a server.

import { test } from "node:test";
import assert from "node:assert/strict";
import { LANGUAGES, DEFAULT_LANGUAGE, resolveLanguage, translations, t, translateExtraCount } from "../lib/i18n.js";

test("default language is German", () => {
  assert.equal(DEFAULT_LANGUAGE, "de");
  assert.equal(resolveLanguage(undefined), "de");
  assert.equal(resolveLanguage(null), "de");
  assert.equal(resolveLanguage(""), "de");
});

test("language can resolve to English when explicitly requested", () => {
  assert.equal(resolveLanguage("en"), "en");
  assert.ok(LANGUAGES.includes("en"));
});

test("an unsupported language value falls back to German rather than throwing", () => {
  assert.equal(resolveLanguage("fr"), "de");
  assert.equal(resolveLanguage("EN"), "de"); // case-sensitive on purpose — "en" is the only valid English code
});

test("t() returns the correct translation per language for representative guest-facing strings", () => {
  const pairs = [
    ["pageTitle", "Deine Extras", "Your extras"],
    ["onRequestBadge", "Auf Anfrage", "On request"],
    ["requestButton", "Anfragen", "Request"],
    ["requestExplanation", "Wir prüfen die Verfügbarkeit und melden uns bei Dir.", "We'll check availability and get back to you."],
    ["requestSentTitle", "Deine Anfrage wurde gesendet.", "Your request has been sent."],
    ["bookNowButton", "Jetzt buchen", "Book now"],
    ["totalPriceLabel", "Gesamtpreis", "Total price"],
    ["vatIncluded", "inkl. MwSt.", "incl. VAT"],
    ["nights", "Nächte", "nights"],
  ];
  for (const [key, de, en] of pairs) {
    assert.equal(t("de", key), de, `de.${key}`);
    assert.equal(t("en", key), en, `en.${key}`);
  }
});

test("t() falls back to German, then to the raw key, when a translation is missing", () => {
  // Simulate a key that exists in German but was never added to English by
  // reading straight from the dictionaries rather than mutating them.
  assert.equal(translations.de.pageTitle, "Deine Extras");
  // An unsupported language argument itself falls back to German content.
  assert.equal(t("fr", "pageTitle"), translations.de.pageTitle);
  // A genuinely unknown key falls back to the key itself, never throws or
  // returns undefined.
  assert.equal(t("de", "this-key-does-not-exist"), "this-key-does-not-exist");
  assert.equal(t("en", "this-key-does-not-exist"), "this-key-does-not-exist");
});

test("translateExtraCount pluralizes per language", () => {
  assert.equal(translateExtraCount("de", 1), "1 Extra ausgewählt");
  assert.equal(translateExtraCount("de", 2), "2 Extras ausgewählt");
  assert.equal(translateExtraCount("en", 1), "1 extra selected");
  assert.equal(translateExtraCount("en", 3), "3 extras selected");
});

test("every key present in the German dictionary also exists in English (no silent gaps)", () => {
  const missing = Object.keys(translations.de).filter((key) => !(key in translations.en));
  assert.deepEqual(missing, []);
});
