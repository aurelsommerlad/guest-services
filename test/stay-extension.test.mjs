// Tests for the "Stay one more night" upsell ("Eine Nacht länger bleiben"):
// never an Apaleo service — extends the reservation's actual departure via
// AmendReservation. Two layers:
//   1. Pure unit tests for lib/stayExtension.js (offer decision, average
//      nightly rate, extension price, EUR rounding, the AmendReservation
//      payload shape) — no I/O, no live Apaleo access needed.
//   2. Integration tests for lib/guest.js's getStayExtensionOffer/
//      confirmStayExtension/determineConsecutiveFreeNights, run fully
//      in-process against a mocked global.fetch (same technique as
//      test/book-service.test.mjs) — no live Apaleo access, no server
//      process needed, but exercises the real availability + amend
//      call sequence end to end, including the local JSON-fallback DB
//      for the concurrency claim and the audit record.
//
// Run with: npm test

import { test } from "node:test";
import assert from "node:assert/strict";
import { rm } from "node:fs/promises";
import path from "node:path";
import {
  decideExtensionOffer,
  computeAverageNightlyRate,
  buildExtensionOffer,
  buildStayExtensionAmendmentPayload,
  addOneDay,
} from "../lib/stayExtension.js";

// ---------------------------------------------------------------------
// 1. Pure unit tests
// ---------------------------------------------------------------------

const CONFIG = {
  minSellableStayNights: 2,
  extensionDiscountOneNightGap: 20,
  extensionDiscountStandard: 15,
};

test("decideExtensionOffer: gap 0 -> no offer", () => {
  const d = decideExtensionOffer({ gap: 0, ...configArgs(CONFIG) });
  assert.equal(d.offer, false);
});

test("decideExtensionOffer: gap 1 -> offer at the one-night-gap discount (closes the gap)", () => {
  const d = decideExtensionOffer({ gap: 1, ...configArgs(CONFIG) });
  assert.equal(d.offer, true);
  assert.equal(d.discountPercent, 20);
  assert.equal(d.reason, "closes_gap");
});

test("decideExtensionOffer: gap 2 -> no offer (would leave a new isolated 1-night gap)", () => {
  const d = decideExtensionOffer({ gap: 2, ...configArgs(CONFIG) });
  assert.equal(d.offer, false);
  assert.equal(d.reason, "would_leave_unsellable_gap");
});

test("decideExtensionOffer: gap 3 (remaining == minSellableStayNights, still 'at least' sellable) -> offer at the standard discount", () => {
  const d = decideExtensionOffer({ gap: 3, ...configArgs(CONFIG) });
  assert.equal(d.offer, true);
  assert.equal(d.discountPercent, 15);
});

test("decideExtensionOffer: gap 4 (> minSellableStayNights) -> offer at the standard discount", () => {
  const d = decideExtensionOffer({ gap: 4, ...configArgs(CONFIG) });
  assert.equal(d.offer, true);
  assert.equal(d.discountPercent, 15);
  assert.equal(d.reason, "remaining_gap_sellable");
});

test("decideExtensionOffer: longer gaps (10, 100) still offer exactly the standard discount", () => {
  for (const gap of [10, 100]) {
    const d = decideExtensionOffer({ gap, ...configArgs(CONFIG) });
    assert.equal(d.offer, true);
    assert.equal(d.discountPercent, 15);
  }
});

test("decideExtensionOffer: the no-offer zone widens correctly when minSellableStayNights changes", () => {
  const config = { ...CONFIG, minSellableStayNights: 3 };
  assert.equal(decideExtensionOffer({ gap: 1, ...configArgs(config) }).offer, true); // still closes the gap
  assert.equal(decideExtensionOffer({ gap: 2, ...configArgs(config) }).offer, false);
  assert.equal(decideExtensionOffer({ gap: 3, ...configArgs(config) }).offer, false);
  assert.equal(decideExtensionOffer({ gap: 4, ...configArgs(config) }).offer, true); // remaining == 3, "at least" 3 is sellable
  assert.equal(decideExtensionOffer({ gap: 5, ...configArgs(config) }).offer, true);
});

function configArgs(config) {
  return {
    minSellableStayNights: config.minSellableStayNights,
    discountOneNightGap: config.extensionDiscountOneNightGap,
    discountStandard: config.extensionDiscountStandard,
  };
}

function slice(ratePlanId, amount, currency = "EUR") {
  return { ratePlan: { id: ratePlanId }, totalGrossAmount: { amount, currency } };
}

test("computeAverageNightlyRate: task's worked example (uniform 160 EUR/night)", () => {
  const rate = computeAverageNightlyRate([slice("RP1", 160), slice("RP1", 160), slice("RP1", 160)]);
  assert.equal(rate, 160);
});

test("computeAverageNightlyRate: varying nightly prices average correctly", () => {
  const rate = computeAverageNightlyRate([slice("RP1", 140), slice("RP1", 160), slice("RP1", 180)]);
  assert.equal(rate, 160);
});

test("computeAverageNightlyRate: rounds to EUR cents", () => {
  const rate = computeAverageNightlyRate([slice("RP1", 100), slice("RP1", 100), slice("RP1", 100.01)]);
  assert.equal(rate, 100);
});

test("computeAverageNightlyRate: refuses (null) on empty/missing timeSlices", () => {
  assert.equal(computeAverageNightlyRate([]), null);
  assert.equal(computeAverageNightlyRate(null), null);
});

test("computeAverageNightlyRate: refuses on a slice missing totalGrossAmount", () => {
  assert.equal(computeAverageNightlyRate([{ ratePlan: { id: "RP1" } }]), null);
});

test("addOneDay: plain date and full ISO timestamp both shift by exactly one calendar day", () => {
  assert.equal(addOneDay("2026-10-16"), "2026-10-17");
  assert.equal(addOneDay("2026-10-16T10:00:00+02:00"), "2026-10-17");
});

test("addOneDay: handles a month/year boundary", () => {
  assert.equal(addOneDay("2026-12-31"), "2027-01-01");
});

test("buildExtensionOffer: task's worked example end to end (160 EUR average, 1-night gap -> 20% off -> 128.00)", () => {
  const reservation = { departure: "2026-10-16T10:00:00+02:00" };
  const timeSlices = [slice("RP1", 160), slice("RP1", 160), slice("RP1", 160), slice("RP1", 160)];
  const offer = buildExtensionOffer({ reservation, timeSlices, gap: 1, config: CONFIG });
  assert.ok(offer);
  assert.deepEqual(offer.averageNightlyRate, { amount: 160, currency: "EUR" });
  assert.deepEqual(offer.extensionPrice, { amount: 128, currency: "EUR" });
  assert.equal(offer.discountPercent, 20);
  assert.equal(offer.currentDeparture, "2026-10-16");
  assert.equal(offer.newDeparture, "2026-10-17");
});

test("buildExtensionOffer: 4-night gap example (160 EUR average -> 15% off -> 136.00)", () => {
  const reservation = { departure: "2026-10-16T10:00:00+02:00" };
  const timeSlices = [slice("RP1", 160), slice("RP1", 160)];
  const offer = buildExtensionOffer({ reservation, timeSlices, gap: 4, config: CONFIG });
  assert.deepEqual(offer.extensionPrice, { amount: 136, currency: "EUR" });
  assert.equal(offer.discountPercent, 15);
});

test("buildExtensionOffer: returns null (no offer shown at all) when the gap doesn't qualify", () => {
  const reservation = { departure: "2026-10-16T10:00:00+02:00" };
  const timeSlices = [slice("RP1", 160)];
  assert.equal(buildExtensionOffer({ reservation, timeSlices, gap: 0, config: CONFIG }), null);
  assert.equal(buildExtensionOffer({ reservation, timeSlices, gap: 2, config: CONFIG }), null);
});

test("buildStayExtensionAmendmentPayload: existing time slice prices are resent completely unchanged", () => {
  const reservation = {
    arrival: "2026-10-10T14:00:00+02:00",
    departure: "2026-10-16T10:00:00+02:00",
    adults: 2,
    childrenAges: [7],
  };
  const timeSlices = [slice("RP1", 150), slice("RP1", 160), slice("RP1", 170)];
  const payload = buildStayExtensionAmendmentPayload({ reservation, timeSlices, extensionPrice: 128 });

  assert.equal(payload.timeSlices.length, 4, "existing 3 nights + 1 new extension night");
  assert.deepEqual(
    payload.timeSlices.slice(0, 3).map((s) => s.totalGrossAmount.amount),
    [150, 160, 170],
    "existing nightly prices must be byte-identical to what was already booked"
  );
  assert.ok(payload.timeSlices.slice(0, 3).every((s) => s.ratePlanId === "RP1"));
});

test("buildStayExtensionAmendmentPayload: the new time slice uses ONLY the calculated extension price, never the average or a hard-coded number", () => {
  const reservation = {
    arrival: "2026-10-10T14:00:00+02:00",
    departure: "2026-10-16T10:00:00+02:00",
    adults: 2,
    childrenAges: null,
  };
  const timeSlices = [slice("RP1", 200), slice("RP1", 200)];
  const payload = buildStayExtensionAmendmentPayload({ reservation, timeSlices, extensionPrice: 128 });

  const newSlice = payload.timeSlices[payload.timeSlices.length - 1];
  assert.equal(newSlice.totalGrossAmount.amount, 128);
  assert.equal(newSlice.ratePlanId, "RP1", "reuses the reservation's own rate plan, never a different one");
});

test("buildStayExtensionAmendmentPayload: preserves arrival/adults/childrenAges, extends departure by exactly one night, and never reprices (requote:false)", () => {
  const reservation = {
    arrival: "2026-10-10T14:00:00+02:00",
    departure: "2026-10-16T10:00:00+02:00",
    adults: 3,
    childrenAges: [4, 9],
  };
  const timeSlices = [slice("RP1", 100)];
  const payload = buildStayExtensionAmendmentPayload({ reservation, timeSlices, extensionPrice: 80 });

  assert.equal(payload.arrival, reservation.arrival);
  assert.equal(payload.departure, "2026-10-17");
  assert.equal(payload.adults, 3);
  assert.deepEqual(payload.childrenAges, [4, 9]);
  assert.equal(payload.requote, false);
});

test("buildStayExtensionAmendmentPayload: never references channel/OTA fields — channel-neutral by construction", () => {
  const reservation = {
    arrival: "2026-10-10T14:00:00+02:00",
    departure: "2026-10-16T10:00:00+02:00",
    adults: 2,
    childrenAges: null,
    channelCode: "ChannelManager",
    source: "Booking.com",
    externalCode: "1234567890-1",
  };
  const timeSlices = [slice("RP1", 150)];
  const payload = buildStayExtensionAmendmentPayload({ reservation, timeSlices, extensionPrice: 120 });

  assert.deepEqual(Object.keys(payload).sort(), ["adults", "arrival", "childrenAges", "departure", "requote", "timeSlices"]);
});

test("buildStayExtensionAmendmentPayload: refuses (null) on a time slice missing ratePlan.id", () => {
  const reservation = { arrival: "2026-10-10T14:00:00+02:00", departure: "2026-10-16T10:00:00+02:00", adults: 2 };
  const payload = buildStayExtensionAmendmentPayload({
    reservation,
    timeSlices: [{ totalGrossAmount: { amount: 100, currency: "EUR" } }],
    extensionPrice: 80,
  });
  assert.equal(payload, null);
});

test("buildStayExtensionAmendmentPayload: refuses on a negative extension price", () => {
  const reservation = { arrival: "2026-10-10T14:00:00+02:00", departure: "2026-10-16T10:00:00+02:00", adults: 2 };
  const payload = buildStayExtensionAmendmentPayload({
    reservation,
    timeSlices: [slice("RP1", 100)],
    extensionPrice: -1,
  });
  assert.equal(payload, null);
});

// ---------------------------------------------------------------------
// 2. Integration tests: lib/guest.js against a mocked global.fetch
//    (same technique as test/book-service.test.mjs) + the real local
//    JSON-fallback DB (see lib/db.js) for the claim lock, extension
//    config, and audit record.
// ---------------------------------------------------------------------

import {
  getStayExtensionOffer,
  confirmStayExtension,
  determineConsecutiveFreeNights,
} from "../lib/guest.js";
import { saveExtensionConfig, listExtensionRecords, claimStayExtension } from "../lib/store.js";

const DATA_DIR = path.join(process.cwd(), ".data");

function reservationFixture(overrides = {}) {
  return {
    id: "TEST-EXT-1",
    property: { id: "TESTPROP" },
    unitGroup: { id: "TESTPROP-UG1", code: "UG1" },
    unit: { id: "TESTPROP-UNIT1", unitGroupId: "TESTPROP-UG1" },
    arrival: "2026-10-10T14:00:00+01:00",
    departure: "2026-10-13T11:00:00+01:00",
    adults: 2,
    childrenAges: null,
    channelCode: "Direct",
    source: "Direct",
    timeSlices: [slice("TESTPROP-RP1", 150), slice("TESTPROP-RP1", 160), slice("TESTPROP-RP1", 170)],
    actions: [{ action: "AmendDeparture", isAllowed: true }],
    ...overrides,
  };
}

// availableNights: array of booleans, one per night starting at the
// reservation's departure — true = that night is free (both the unit
// group and, when a unit is assigned, that exact unit).
function installExtensionFetchMock({ reservation, availableNights, physicalCount = 1 }) {
  process.env.APALEO_CLIENT_ID ||= "test-client-id";
  process.env.APALEO_CLIENT_SECRET ||= "test-client-secret";

  const calls = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, options = {}) => {
    const urlObj = new URL(String(url));
    const pathname = urlObj.pathname;

    if (pathname.includes("/connect/token")) {
      return new Response(JSON.stringify({ access_token: "fake-token", expires_in: 3600 }), { status: 200 });
    }

    calls.push({ pathname, search: urlObj.search, method: options.method || "GET", body: options.body ? JSON.parse(options.body) : null });

    if (pathname === `/booking/v1/reservations/${reservation.id}`) {
      return new Response(JSON.stringify(reservation), { status: 200 });
    }

    if (pathname === "/availability/v1/unit-groups") {
      // Real Apaleo only ever returns entries within the requested [from,
      // to) range — mirrored here so a test can prove the code never looks
      // further ahead than it actually asked for, instead of the mock
      // silently handing back more nights than were requested.
      const from = new Date(urlObj.searchParams.get("from"));
      const to = new Date(urlObj.searchParams.get("to"));
      const requestedNights = Math.round((to.getTime() - from.getTime()) / (24 * 60 * 60 * 1000));
      const nightCount = Math.min(availableNights.length, requestedNights);
      const timeSlices = availableNights.slice(0, nightCount).map((free, i) => {
        const nightFrom = new Date(from);
        nightFrom.setUTCDate(nightFrom.getUTCDate() + i);
        const nightTo = new Date(nightFrom);
        nightTo.setUTCDate(nightTo.getUTCDate() + 1);
        return {
          from: nightFrom.toISOString(),
          to: nightTo.toISOString(),
          unitGroups: [{ availableCount: free ? 1 : 0, physicalCount }],
        };
      });
      return new Response(JSON.stringify({ timeSlices }), { status: 200 });
    }

    if (pathname === "/availability/v1/units") {
      // Match the requested single-night window to its night index by
      // distance (in days) from the reservation's departure.
      const from = urlObj.searchParams.get("from");
      const departureMs = new Date(reservation.departure).getTime();
      const fromMs = new Date(from).getTime();
      const nightIndex = Math.round((fromMs - departureMs) / (24 * 60 * 60 * 1000));
      const free = availableNights[nightIndex];
      return new Response(
        JSON.stringify({ units: free ? [{ id: reservation.unit?.id }] : [] }),
        { status: 200 }
      );
    }

    if (pathname === `/booking/v1/reservation-actions/${reservation.id}/amend`) {
      return new Response(JSON.stringify({ id: reservation.id }), { status: 200 });
    }

    throw new Error(`Unexpected mocked fetch call: ${options.method || "GET"} ${pathname}`);
  };

  return { calls, restore: () => (globalThis.fetch = originalFetch) };
}

async function withCleanLocalDb(fn) {
  await rm(DATA_DIR, { recursive: true, force: true });
  try {
    await fn();
  } finally {
    await rm(DATA_DIR, { recursive: true, force: true });
  }
}

test("determineConsecutiveFreeNights: gap 1 (free, then sold) — mirrors the real DCXHJNUE-1 case found during investigation", async () => {
  await withCleanLocalDb(async () => {
    const reservation = reservationFixture();
    const { restore } = installExtensionFetchMock({ reservation, availableNights: [true, false, false] });
    try {
      const gap = await determineConsecutiveFreeNights({
        propertyId: "TESTPROP",
        unitGroupId: "TESTPROP-UG1",
        assignedUnitId: "TESTPROP-UNIT1",
        departureDate: "2026-10-13",
        minSellableStayNights: 2,
      });
      assert.equal(gap, 1);
    } finally {
      restore();
    }
  });
});

test("determineConsecutiveFreeNights: no unit assigned + unit group has more than one physical unit -> gap stays 0 (apartment-move risk)", async () => {
  await withCleanLocalDb(async () => {
    const reservation = reservationFixture();
    const { restore } = installExtensionFetchMock({
      reservation,
      availableNights: [true, true, true, true],
      physicalCount: 3,
    });
    try {
      const gap = await determineConsecutiveFreeNights({
        propertyId: "TESTPROP",
        unitGroupId: "TESTPROP-UG1",
        assignedUnitId: null,
        departureDate: "2026-10-13",
        minSellableStayNights: 2,
      });
      assert.equal(gap, 0);
    } finally {
      restore();
    }
  });
});

test("determineConsecutiveFreeNights: no unit assigned + single-physical-unit group -> trusted, gap counted normally", async () => {
  await withCleanLocalDb(async () => {
    const reservation = reservationFixture();
    const { restore } = installExtensionFetchMock({
      reservation,
      availableNights: [true, true, true, true],
      physicalCount: 1,
    });
    try {
      const gap = await determineConsecutiveFreeNights({
        propertyId: "TESTPROP",
        unitGroupId: "TESTPROP-UG1",
        assignedUnitId: null,
        departureDate: "2026-10-13",
        minSellableStayNights: 2,
      });
      assert.equal(gap, 3, "only looks minSellableStayNights+1 nights ahead");
    } finally {
      restore();
    }
  });
});

test("getStayExtensionOffer: full happy path — 1-night gap on a direct reservation produces the correct offer", async () => {
  await withCleanLocalDb(async () => {
    await saveExtensionConfig("TESTPROP", {
      extensionNightEnabled: true,
      extensionDiscountOneNightGap: 20,
      extensionDiscountStandard: 15,
      minSellableStayNights: 2,
    });
    const reservation = reservationFixture();
    const { restore } = installExtensionFetchMock({ reservation, availableNights: [true, false] });
    try {
      const offer = await getStayExtensionOffer(reservation);
      assert.ok(offer);
      assert.equal(offer.discountPercent, 20);
      assert.deepEqual(offer.averageNightlyRate, { amount: 160, currency: "EUR" });
      assert.deepEqual(offer.extensionPrice, { amount: 128, currency: "EUR" });
      assert.equal(offer.newDeparture, "2026-10-14");
    } finally {
      restore();
    }
  });
});

test("getStayExtensionOffer: feature disabled for the property -> null, no offer shown at all", async () => {
  await withCleanLocalDb(async () => {
    await saveExtensionConfig("TESTPROP", {
      extensionNightEnabled: false,
      extensionDiscountOneNightGap: 20,
      extensionDiscountStandard: 15,
      minSellableStayNights: 2,
    });
    const reservation = reservationFixture();
    const { calls, restore } = installExtensionFetchMock({ reservation, availableNights: [true, false] });
    try {
      const offer = await getStayExtensionOffer(reservation);
      assert.equal(offer, null);
      assert.equal(calls.length, 0, "disabled property must never even call Apaleo");
    } finally {
      restore();
    }
  });
});

test("getStayExtensionOffer: Apaleo reports AmendDeparture not allowed -> null (e.g. wrong reservation state)", async () => {
  await withCleanLocalDb(async () => {
    await saveExtensionConfig("TESTPROP", {
      extensionNightEnabled: true,
      extensionDiscountOneNightGap: 20,
      extensionDiscountStandard: 15,
      minSellableStayNights: 2,
    });
    const reservation = reservationFixture({ actions: [{ action: "AmendDeparture", isAllowed: false }] });
    const { restore } = installExtensionFetchMock({ reservation, availableNights: [true, false] });
    try {
      const offer = await getStayExtensionOffer(reservation);
      assert.equal(offer, null);
    } finally {
      restore();
    }
  });
});

test("confirmStayExtension: happy path — exactly one amend call, existing nights unchanged, audit record stored", async () => {
  await withCleanLocalDb(async () => {
    await saveExtensionConfig("TESTPROP", {
      extensionNightEnabled: true,
      extensionDiscountOneNightGap: 20,
      extensionDiscountStandard: 15,
      minSellableStayNights: 2,
    });
    const reservation = reservationFixture();
    const { calls, restore } = installExtensionFetchMock({ reservation, availableNights: [true, false] });
    try {
      const result = await confirmStayExtension({
        reservationId: reservation.id,
        expectedCurrentDeparture: "2026-10-13",
      });
      assert.equal(result.newDeparture, "2026-10-14");
      assert.deepEqual(result.extensionPrice, { amount: 128, currency: "EUR" });

      const amendCalls = calls.filter((c) => c.pathname.endsWith("/amend"));
      assert.equal(amendCalls.length, 1, "exactly one AmendReservation call");
      const body = amendCalls[0].body;
      assert.deepEqual(
        body.timeSlices.slice(0, 3).map((s) => s.totalGrossAmount.amount),
        [150, 160, 170],
        "existing time slice prices must be untouched"
      );
      assert.equal(body.timeSlices[3].totalGrossAmount.amount, 128);
      assert.equal(body.requote, false);

      // No service-booking call was made — existing per-night services (or
      // any service) are never touched by a stay extension.
      assert.ok(!calls.some((c) => c.pathname.includes("/book-service")));

      const records = await listExtensionRecords();
      assert.equal(records.length, 1);
      assert.equal(records[0].reservationId, reservation.id);
      assert.equal(records[0].oldDeparture, "2026-10-13");
      assert.equal(records[0].newDeparture, "2026-10-14");
      assert.equal(records[0].discountPercent, 20);
    } finally {
      restore();
    }
  });
});

test("confirmStayExtension: works identically for a Booking.com/ChannelManager reservation", async () => {
  await withCleanLocalDb(async () => {
    await saveExtensionConfig("TESTPROP", {
      extensionNightEnabled: true,
      extensionDiscountOneNightGap: 20,
      extensionDiscountStandard: 15,
      minSellableStayNights: 2,
    });
    const reservation = reservationFixture({ channelCode: "ChannelManager", source: "Booking.com" });
    const { calls, restore } = installExtensionFetchMock({ reservation, availableNights: [true, false] });
    try {
      const result = await confirmStayExtension({
        reservationId: reservation.id,
        expectedCurrentDeparture: "2026-10-13",
      });
      assert.equal(result.newDeparture, "2026-10-14");
      const amendBody = calls.find((c) => c.pathname.endsWith("/amend")).body;
      assert.equal("channelCode" in amendBody, false);
      assert.equal("source" in amendBody, false);
      assert.equal("externalCode" in amendBody, false);
    } finally {
      restore();
    }
  });
});

test("confirmStayExtension: availability disappeared since the offer was shown -> refused, no amend call", async () => {
  await withCleanLocalDb(async () => {
    await saveExtensionConfig("TESTPROP", {
      extensionNightEnabled: true,
      extensionDiscountOneNightGap: 20,
      extensionDiscountStandard: 15,
      minSellableStayNights: 2,
    });
    const reservation = reservationFixture();
    // Guest saw an offer built from a 1-night gap, but by confirmation time
    // that single night is gone too (fully sold out in between).
    const { calls, restore } = installExtensionFetchMock({ reservation, availableNights: [false, false] });
    try {
      await assert.rejects(
        () => confirmStayExtension({ reservationId: reservation.id, expectedCurrentDeparture: "2026-10-13" }),
        (err) => err.reason === "stay_extension_unavailable"
      );
      assert.ok(!calls.some((c) => c.pathname.endsWith("/amend")), "must never amend when availability is gone");
    } finally {
      restore();
    }
  });
});

test("confirmStayExtension: reservation already extended (departure moved since the offer was shown) -> refused, never extends a second time", async () => {
  await withCleanLocalDb(async () => {
    await saveExtensionConfig("TESTPROP", {
      extensionNightEnabled: true,
      extensionDiscountOneNightGap: 20,
      extensionDiscountStandard: 15,
      minSellableStayNights: 2,
    });
    // The reservation's real current departure is already one night later
    // than what the guest's browser saw when the offer was built.
    const reservation = reservationFixture({ departure: "2026-10-14T11:00:00+01:00" });
    const { calls, restore } = installExtensionFetchMock({ reservation, availableNights: [true, false] });
    try {
      await assert.rejects(
        () => confirmStayExtension({ reservationId: reservation.id, expectedCurrentDeparture: "2026-10-13" }),
        (err) => err.reason === "stay_extension_unavailable"
      );
      assert.ok(!calls.some((c) => c.pathname.endsWith("/amend")));
    } finally {
      restore();
    }
  });
});

test("confirmStayExtension: duplicate/concurrent submission — the second call is refused by the claim lock, only one amend happens", async () => {
  await withCleanLocalDb(async () => {
    await saveExtensionConfig("TESTPROP", {
      extensionNightEnabled: true,
      extensionDiscountOneNightGap: 20,
      extensionDiscountStandard: 15,
      minSellableStayNights: 2,
    });
    const reservation = reservationFixture();
    const { calls, restore } = installExtensionFetchMock({ reservation, availableNights: [true, false] });
    try {
      // Simulate a concurrent second request arriving while the first is
      // already mid-flight: pre-claim the lock exactly as confirmStayExtension
      // itself would, before it gets the chance to.
      const claimed = await claimStayExtension(reservation.id);
      assert.equal(claimed, true, "pre-claim must succeed the first time");

      await assert.rejects(
        () => confirmStayExtension({ reservationId: reservation.id, expectedCurrentDeparture: "2026-10-13" }),
        (err) => err.reason === "stay_extension_unavailable"
      );
      assert.equal(calls.length, 0, "a claim-blocked call must never touch Apaleo at all");
    } finally {
      restore();
    }
  });
});
