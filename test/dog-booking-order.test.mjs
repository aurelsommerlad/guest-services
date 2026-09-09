// Integration tests for the "maximum 1 dog per reservation" rule wired
// into lib/guest.js's placeGuestOrder (the instant-booking path) — run
// fully in-process against a mocked global.fetch (same technique as
// test/stay-extension.test.mjs), no live Apaleo access, no server process
// needed.
//
// Run with: npm test

import { test } from "node:test";
import assert from "node:assert/strict";
import { rm } from "node:fs/promises";
import path from "node:path";
import { placeGuestOrder } from "../lib/guest.js";
import { upsertCatalogItem } from "../lib/store.js";

const DATA_DIR = path.join(process.cwd(), ".data");

async function withCleanLocalDb(fn) {
  await rm(DATA_DIR, { recursive: true, force: true });
  try {
    await fn();
  } finally {
    await rm(DATA_DIR, { recursive: true, force: true });
  }
}

const PROPERTY_ID = "TESTPROP";
const DOG_SERVICE_ID = "TESTPROP-HUND";
const PARKING_SERVICE_ID = "TESTPROP-PARKPLATZ";

function reservationFixture(overrides = {}) {
  return {
    id: "TEST-DOG-1",
    property: { id: PROPERTY_ID },
    unitGroup: { id: "TESTPROP-UG1", code: "UG1" },
    unit: { id: "TESTPROP-UNIT1", unitGroupId: "TESTPROP-UG1" },
    arrival: "2026-10-10T14:00:00+01:00",
    departure: "2026-10-13T11:00:00+01:00", // 3 nights: 10th, 11th, 12th
    primaryGuest: {},
    ...overrides,
  };
}

async function seedDogCatalogItem(overrides = {}) {
  await upsertCatalogItem(PROPERTY_ID, {
    serviceId: DOG_SERVICE_ID,
    code: "HUND",
    name: "Hund",
    displayName: "Hund",
    description: "",
    category: "",
    imageUrl: "",
    active: true,
    bookingRule: "per_night",
    fulfillmentMode: "instant",
    actionType: "service",
    allowedUnitGroupIds: [],
    maxOnePerReservation: true,
    requiresVehicleRegistration: false,
    requiresRemainingCapacity: false,
    ...overrides,
  });
}

async function seedParkingCatalogItem() {
  await upsertCatalogItem(PROPERTY_ID, {
    serviceId: PARKING_SERVICE_ID,
    code: "PARKPLATZ",
    name: "Parkplatz",
    displayName: "Parkplatz",
    description: "",
    category: "",
    imageUrl: "",
    active: true,
    bookingRule: "per_stay",
    fulfillmentMode: "instant",
    actionType: "service",
    allowedUnitGroupIds: [],
    maxOnePerReservation: false,
    requiresVehicleRegistration: false,
    requiresRemainingCapacity: false,
  });
}

function nightsOffer(serviceId, dates, unitAmount = 15) {
  return {
    service: { id: serviceId },
    dates: dates.map((serviceDate, i) => ({
      serviceDate,
      isDefaultDate: i === 0,
      amount: { grossAmount: unitAmount, currency: "EUR" },
    })),
  };
}

/**
 * Stateful fetch mock covering exactly what getGuestCatalog/placeGuestOrder
 * touch: OAuth token, service-offers, reservation services (mutated by a
 * successful book-service call so a SECOND placeGuestOrder call in the same
 * test sees the real post-booking state), book-service itself, and the
 * localized-service-name lookup (best-effort, errors are swallowed by
 * getServiceLocalized itself).
 */
function installOrderFetchMock({ offers, initialServices = [] }) {
  process.env.APALEO_CLIENT_ID ||= "test-client-id";
  process.env.APALEO_CLIENT_SECRET ||= "test-client-secret";

  const calls = [];
  let currentServices = initialServices.map((s) => ({ ...s, dates: s.dates.map((d) => ({ ...d })) }));
  const originalFetch = globalThis.fetch;

  globalThis.fetch = async (url, options = {}) => {
    const urlObj = new URL(String(url));
    const pathname = urlObj.pathname;

    if (pathname.includes("/connect/token")) {
      return new Response(JSON.stringify({ access_token: "fake-token", expires_in: 3600 }), { status: 200 });
    }

    const body = options.body ? JSON.parse(options.body) : null;
    calls.push({ pathname, method: options.method || "GET", body });

    if (pathname.endsWith("/service-offers")) {
      return new Response(JSON.stringify({ services: offers }), { status: 200 });
    }

    if (pathname.endsWith("/services") && (!options.method || options.method === "GET")) {
      return new Response(JSON.stringify({ services: currentServices }), { status: 200 });
    }

    if (pathname.startsWith("/rateplan/v1/services/")) {
      return new Response(JSON.stringify({ name: { de: "Extra", en: "Extra" }, description: { de: "", en: "" } }), {
        status: 200,
      });
    }

    if (pathname.endsWith("/book-service")) {
      const serviceId = body.serviceId;
      const existingIndex = currentServices.findIndex((s) => s.service?.id === serviceId);
      const nextEntry = {
        service: { id: serviceId },
        dates: body.dates.map((d) => ({ serviceDate: d.serviceDate, count: d.count, amount: d.amount, isMandatory: false })),
      };
      if (existingIndex === -1) {
        currentServices.push(nextEntry);
      } else {
        currentServices[existingIndex] = nextEntry;
      }
      return new Response(JSON.stringify({}), { status: 200 });
    }

    return new Response(JSON.stringify({}), { status: 200 });
  };

  return {
    calls,
    getCurrentServices: () => currentServices,
    restore: () => {
      globalThis.fetch = originalFetch;
    },
  };
}

test("placeGuestOrder: a reservation with 0 dogs booked can book 1", async () => {
  await withCleanLocalDb(async () => {
    await seedDogCatalogItem();
    const reservation = reservationFixture();
    const offers = [nightsOffer(DOG_SERVICE_ID, ["2026-10-10", "2026-10-11", "2026-10-12"])];
    const mock = installOrderFetchMock({ offers, initialServices: [] });
    try {
      const result = await placeGuestOrder({
        reservation,
        propertyId: PROPERTY_ID,
        lines: [{ serviceId: DOG_SERVICE_ID, count: 1 }],
        guestName: "Test Guest",
      });
      assert.equal(result.failed.length, 0);
      assert.equal(result.booked.length, 1);
      assert.equal(result.booked[0].serviceId, DOG_SERVICE_ID);

      const bookCalls = mock.calls.filter((c) => c.pathname.endsWith("/book-service"));
      assert.equal(bookCalls.length, 1, "exactly one book-service call");
      assert.equal(bookCalls[0].body.count, 1);
      assert.equal(bookCalls[0].body.dates.length, 3, "all 3 nights in ONE call");
    } finally {
      mock.restore();
    }
  });
});

test("placeGuestOrder: quantity 2 for a maxOnePerReservation item is rejected server-side, never books", async () => {
  await withCleanLocalDb(async () => {
    await seedDogCatalogItem();
    const reservation = reservationFixture();
    const offers = [nightsOffer(DOG_SERVICE_ID, ["2026-10-10", "2026-10-11", "2026-10-12"])];
    const mock = installOrderFetchMock({ offers, initialServices: [] });
    try {
      const result = await placeGuestOrder({
        reservation,
        propertyId: PROPERTY_ID,
        lines: [{ serviceId: DOG_SERVICE_ID, count: 2 }],
        guestName: "Test Guest",
      });
      assert.equal(result.booked.length, 0);
      assert.equal(result.failed.length, 1);
      assert.equal(result.failed[0].reason, "dog_limit_exceeded");
      assert.ok(!mock.calls.some((c) => c.pathname.endsWith("/book-service")), "never calls book-service");
    } finally {
      mock.restore();
    }
  });
});

test("placeGuestOrder: a reservation that already has a dog booked cannot book another", async () => {
  await withCleanLocalDb(async () => {
    await seedDogCatalogItem();
    const reservation = reservationFixture();
    const offers = [nightsOffer(DOG_SERVICE_ID, ["2026-10-10", "2026-10-11", "2026-10-12"])];
    const existingDog = {
      service: { id: DOG_SERVICE_ID },
      dates: [
        { serviceDate: "2026-10-10", count: 1, isMandatory: false },
        { serviceDate: "2026-10-11", count: 1, isMandatory: false },
      ],
    };
    const mock = installOrderFetchMock({ offers, initialServices: [existingDog] });
    try {
      const result = await placeGuestOrder({
        reservation,
        propertyId: PROPERTY_ID,
        lines: [{ serviceId: DOG_SERVICE_ID, count: 1 }],
        guestName: "Test Guest",
      });
      assert.equal(result.booked.length, 0);
      assert.equal(result.failed.length, 1);
      assert.equal(result.failed[0].reason, "dog_limit_exceeded");
      assert.ok(!mock.calls.some((c) => c.pathname.endsWith("/book-service")), "never calls book-service");
    } finally {
      mock.restore();
    }
  });
});

test("placeGuestOrder: an existing dog added via ANY source (Apaleo/OTA/Make/manual) is detected, not just this app's own bookings", async () => {
  await withCleanLocalDb(async () => {
    await seedDogCatalogItem();
    const reservation = reservationFixture();
    const offers = [nightsOffer(DOG_SERVICE_ID, ["2026-10-10", "2026-10-11", "2026-10-12"])];
    // Simulates a dog added directly in Apaleo (or via any other channel) —
    // this app never made this booking, it's purely live Apaleo state.
    const existingDog = { service: { id: DOG_SERVICE_ID }, dates: [{ serviceDate: "2026-10-10", count: 1 }] };
    const mock = installOrderFetchMock({ offers, initialServices: [existingDog] });
    try {
      const result = await placeGuestOrder({
        reservation,
        propertyId: PROPERTY_ID,
        lines: [{ serviceId: DOG_SERVICE_ID, count: 1 }],
        guestName: "Test Guest",
      });
      assert.equal(result.failed[0].reason, "dog_limit_exceeded");
    } finally {
      mock.restore();
    }
  });
});

test("placeGuestOrder: a dog already booked across ALL nights of a long stay (many service dates) still counts as exactly 1 dog, correctly blocking a second", async () => {
  await withCleanLocalDb(async () => {
    await seedDogCatalogItem();
    const reservation = reservationFixture({ departure: "2026-10-20T11:00:00+01:00" }); // 10 nights
    const nights = Array.from({ length: 10 }, (_, i) => `2026-10-${10 + i}`);
    const offers = [nightsOffer(DOG_SERVICE_ID, nights)];
    const existingDog = {
      service: { id: DOG_SERVICE_ID },
      dates: nights.map((serviceDate) => ({ serviceDate, count: 1 })),
    };
    const mock = installOrderFetchMock({ offers, initialServices: [existingDog] });
    try {
      const result = await placeGuestOrder({
        reservation,
        propertyId: PROPERTY_ID,
        lines: [{ serviceId: DOG_SERVICE_ID, count: 1 }],
        guestName: "Test Guest",
      });
      assert.equal(result.booked.length, 0);
      assert.equal(result.failed[0].reason, "dog_limit_exceeded");
    } finally {
      mock.restore();
    }
  });
});

test("placeGuestOrder: concurrent requests for the same reservation cannot both book a dog — only one succeeds", async () => {
  await withCleanLocalDb(async () => {
    await seedDogCatalogItem();
    const reservation = reservationFixture();
    const offers = [nightsOffer(DOG_SERVICE_ID, ["2026-10-10", "2026-10-11", "2026-10-12"])];
    const mock = installOrderFetchMock({ offers, initialServices: [] });
    try {
      const [resultA, resultB] = await Promise.all([
        placeGuestOrder({
          reservation,
          propertyId: PROPERTY_ID,
          lines: [{ serviceId: DOG_SERVICE_ID, count: 1 }],
          guestName: "Guest A",
        }),
        placeGuestOrder({
          reservation,
          propertyId: PROPERTY_ID,
          lines: [{ serviceId: DOG_SERVICE_ID, count: 1 }],
          guestName: "Guest B",
        }),
      ]);

      const succeeded = [resultA, resultB].filter((r) => r.booked.length === 1);
      const failed = [resultA, resultB].filter((r) => r.failed.length === 1);
      assert.equal(succeeded.length, 1, "exactly one of the two concurrent requests must succeed");
      assert.equal(failed.length, 1, "exactly one of the two concurrent requests must fail");

      const bookCalls = mock.calls.filter((c) => c.pathname.endsWith("/book-service"));
      assert.equal(bookCalls.length, 1, "book-service must have been called exactly once total");
    } finally {
      mock.restore();
    }
  });
});

test("placeGuestOrder: other extras (a normal, non-maxOnePerReservation item) are completely unaffected — quantity 2 still works", async () => {
  await withCleanLocalDb(async () => {
    await seedParkingCatalogItem();
    const reservation = reservationFixture();
    const offers = [
      { service: { id: PARKING_SERVICE_ID }, dates: [{ serviceDate: "2026-10-10", isDefaultDate: true, amount: { grossAmount: 15, currency: "EUR" } }] },
    ];
    const mock = installOrderFetchMock({ offers, initialServices: [] });
    try {
      const result = await placeGuestOrder({
        reservation,
        propertyId: PROPERTY_ID,
        lines: [{ serviceId: PARKING_SERVICE_ID, count: 2 }],
        guestName: "Test Guest",
      });
      assert.equal(result.failed.length, 0);
      assert.equal(result.booked.length, 1);
      assert.equal(result.booked[0].count, 2);
    } finally {
      mock.restore();
    }
  });
});

test("placeGuestOrder: existing property-specific unit-group eligibility for the dog service is unaffected by the new max-1 rule", async () => {
  await withCleanLocalDb(async () => {
    // Restricted to a different unit group than the reservation is booked in.
    await seedDogCatalogItem({ allowedUnitGroupIds: ["SOME-OTHER-UNIT-GROUP"] });
    const reservation = reservationFixture(); // booked in TESTPROP-UG1
    const offers = [nightsOffer(DOG_SERVICE_ID, ["2026-10-10", "2026-10-11", "2026-10-12"])];
    const mock = installOrderFetchMock({ offers, initialServices: [] });
    try {
      const result = await placeGuestOrder({
        reservation,
        propertyId: PROPERTY_ID,
        lines: [{ serviceId: DOG_SERVICE_ID, count: 1 }],
        guestName: "Test Guest",
      });
      assert.equal(result.booked.length, 0);
      // Rejected for the pre-existing unit-group restriction reason, not
      // (only) the new dog-limit reason — the two gates are independent.
      assert.equal(result.failed[0].reason, "Apartmenttyp nicht erlaubt");
    } finally {
      mock.restore();
    }
  });
});
