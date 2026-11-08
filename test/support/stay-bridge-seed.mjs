// Local Extras catalog for the Apaleo TEST property, used by the STAY bridge
// integration test and the local browser walkthrough. Mirrors how the team
// curates a property in Admin > Katalog; prices are NOT set here – they come
// from (simulated) Apaleo service offers, exactly as in production.

import { upsertCatalogItem, saveExtensionConfig } from "../../lib/store.js";

const base = {
  active: true,
  category: "",
  imageUrl: "",
  fulfillmentMode: "instant",
  actionType: "service",
  allowedUnitGroupIds: [],
  maxOnePerReservation: false,
  requiresVehicleRegistration: false,
  requiresRemainingCapacity: false,
};

export const TEST_CATALOG = [
  {
    ...base,
    serviceId: "TEST-ECI",
    code: "ECI",
    bookingRule: "arrival_day",
    sortOrder: 10,
    displayNameDe: "Früher Check-in",
    displayNameEn: "Early check-in",
    descriptionDe: "Anreise ab 12 Uhr statt ab 16 Uhr – nach Verfügbarkeit des Apartments.",
    descriptionEn: "Arrive from 12 noon instead of 4 pm – subject to apartment availability.",
  },
  {
    ...base,
    serviceId: "TEST-LCO",
    code: "LCO",
    bookingRule: "departure_day",
    sortOrder: 20,
    displayNameDe: "Später Check-out",
    displayNameEn: "Late check-out",
    descriptionDe: "Abreise bis 14 Uhr statt bis 10 Uhr.",
    descriptionEn: "Check out by 2 pm instead of 10 am.",
  },
  {
    ...base,
    serviceId: "TEST-HUND",
    code: "HUND",
    bookingRule: "per_night",
    sortOrder: 30,
    maxOnePerReservation: true,
    displayNameDe: "Hund",
    displayNameEn: "Dog",
    descriptionDe: "Ein Hund pro Apartment, pro Nacht berechnet.",
    descriptionEn: "One dog per apartment, charged per night.",
  },
  {
    ...base,
    serviceId: "TEST-PKW",
    code: "PKW",
    bookingRule: "per_night",
    sortOrder: 40,
    requiresVehicleRegistration: true,
    displayNameDe: "Parkplatz",
    displayNameEn: "Parking space",
    descriptionDe: "Ein Stellplatz direkt am Haus. Bitte Kennzeichen angeben.",
    descriptionEn: "A parking space right at the house. Please enter your licence plate.",
  },
  {
    ...base,
    serviceId: "TEST-BABY",
    code: "BABY",
    bookingRule: "per_night",
    sortOrder: 50,
    fulfillmentMode: "request",
    displayNameDe: "Babybett",
    displayNameEn: "Baby cot",
    descriptionDe: "Babybett mit Bettwäsche – wir prüfen und bestätigen persönlich.",
    descriptionEn: "Baby cot with bedding – we check and confirm personally.",
  },
  {
    ...base,
    serviceId: "TEST-EXTRPERSON",
    code: "EXTRPERSON",
    bookingRule: "per_night",
    sortOrder: 60,
    actionType: "increase_occupancy",
    requiresRemainingCapacity: true,
    extraPersonPricePerNight: 30,
    displayNameDe: "Zusätzliche Person",
    displayNameEn: "Additional guest",
    descriptionDe: "Eine weitere Person reist mit – pro Person und Nacht.",
    descriptionEn: "One more guest joins you – per person and night.",
  },
];

export async function seedTestCatalog() {
  for (const item of TEST_CATALOG) await upsertCatalogItem("TEST", item);
  await saveExtensionConfig("TEST", {
    extensionNightEnabled: true,
    extensionDiscountPreArrivalOneNightGap: 15,
    extensionDiscountPreArrivalStandard: 10,
    extensionDiscountInHouseOneNightGap: 20,
    extensionDiscountInHouseStandard: 15,
    minSellableStayNights: 2,
  });
}
