// Dependency-free (see lib/priceDisplay.js / lib/format.js for why) pure
// resolution logic for guest-facing bilingual catalog text — extracted out
// of lib/guest.js so the actual language-priority rules can be unit-tested
// directly with plain `node --test`, without needing lib/db.js's KV/Redis
// setup or live Apaleo access.
//
// Priority order (see the fix for the "Car park" localization bug):
//   1. curated per-language override (e.g. displayNameDe/displayNameEn)
//   2. localized Apaleo value in the requested language
//   3. localized Apaleo value in the OTHER language (better than nothing,
//      and better than trusting a possibly stale/never-translated generic
//      catalog field — see below)
//   4. the existing generic curated field (displayName/description) — this
//      is deliberately LAST: it's exactly the kind of field that caused the
//      original bug (an admin saved whatever single-language string Apaleo
//      happened to return once, with no per-language awareness)
//   5. (displayName only) an absolute last-resort fallback so the guest
//      never sees a blank title

function trim(value) {
  return typeof value === "string" ? value.trim() : "";
}

/**
 * Resolves one bilingual text field (displayName or description) for both
 * languages at once, so the guest-facing catalog payload can carry both
 * variants and the frontend can switch language without refetching.
 */
export function resolveBilingualText({ overrideDe, overrideEn, apaleoDe, apaleoEn, genericFallback, finalFallback }) {
  function pick(lang) {
    const override = trim(lang === "de" ? overrideDe : overrideEn);
    if (override) return override;

    const same = trim(lang === "de" ? apaleoDe : apaleoEn);
    if (same) return same;

    const other = trim(lang === "de" ? apaleoEn : apaleoDe);
    if (other) return other;

    const generic = trim(genericFallback);
    if (generic) return generic;

    return finalFallback || "";
  }

  return { de: pick("de"), en: pick("en") };
}

/**
 * Resolves the guest-facing price unit label for both languages. Unlike
 * displayName/description, this has nothing to do with Apaleo — it's pure
 * presentation text we own — so its fallback chain is simpler: a
 * per-language override, then the existing generic priceUnitLabel field
 * (whatever language it happens to be in), then a bookingRule-based
 * translated default. `resolvePriceUnitLabel` is injected (rather than
 * imported) so this module stays dependency-free.
 */
export function resolveBilingualPriceUnitLabel({
  overrideDe,
  overrideEn,
  genericPriceUnitLabel,
  bookingRule,
  resolvePriceUnitLabel,
}) {
  function pick(lang) {
    const specific = trim(lang === "de" ? overrideDe : overrideEn);
    if (specific) return specific;
    return resolvePriceUnitLabel(bookingRule, genericPriceUnitLabel, lang);
  }

  return { de: pick("de"), en: pick("en") };
}
